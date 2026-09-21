"""04-API §7 ⌘K 통합검색 — `GET /search?q=&types=doc,chat,post` → `[{type, id, title, sub, snippet, to}]`.

FTS 는 Postgres 'simple' 설정(documents.tsv 와 같다 — 한국어 형태소 분석 없음). 조사가 붙은 한국어("로드맵을")를
"로드맵" 으로 찾으려고 토큰마다 접두 매칭(`로드맵:*`)을 건다. 랭킹은 ts_rank + 최근성(일주일 반감) 의 합.
**권한 필터는 SQL 에서** — 채팅은 내가 멤버인 채널만, 게시글은 내 등급 이상 게시판만(FR-SHL-02 · TC-CHT-06),
문서는 열람 등급이 없어 휴지통만 뺀다. 권한 밖은 마스킹이 아니라 **결과에서 빠진다**(검색은 존재도 새면 안 된다).
스니펫의 강조는 HTML 이 아니라 `**…**` 마커다. 본문에 든 태그는 ts_headline 이 **일부만** 버리므로(`<svg onload=` 같은
조각이 남는다) 서버가 `<>&` 를 이스케이프해 보낸다(TC-SEC-04) — 프론트는 스니펫을 textContent 로 그리고 `**` 만 파싱한다.

messages·posts 의 `tsv` 는 DB 가 본문에서 만들어 저장하는 생성 컬럼 + GIN 이다(2026-09-21, README "설계와 어긋나는 것" 13(d)).
그전에는 to_tsvector 를 즉석에서 만들어 순차 스캔했다 — 메시지 6만 건에서 ⌘K 한 번이 약 300ms 였다.
ponytail: 문서는 `tsv || to_tsvector(title)` 식이라 있는 GIN(idx_documents_tsv)을 못 탄다. 600건에 3~8ms 라 둔다 —
느려지면 같은 식의 표현식 GIN, 또는 제목을 tsv 에 넣고 PATCH 가 tsv 를 같이 고친다.
"""

import re
import uuid
from datetime import datetime
from html import escape
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import (
    DOC_LIST_OPTS,
    ROLE_RANK,
    Board,
    Channel,
    ChannelMember,
    Document,
    Folder,
    Message,
    Post,
    User,
)

router = APIRouter(tags=["search"], dependencies=[Depends(current_user)])

SearchType = Literal["doc", "chat", "post"]
ALL_TYPES: tuple[SearchType, ...] = ("doc", "chat", "post")
# 글자·숫자 덩어리만 토큰이다 — tsquery 연산자·구두점·제어문자(NUL 은 드라이버에서 터진다)가 쿼리 문법이 되지
# 않고, "foo-bar"·"foo,bar" 가 구문검색(<->)으로 접히지도 않는다(그냥 foo & bar).
_TOKEN = re.compile(r"[^\W_]+")
HEADLINE_OPTS = "MaxWords=24, MinWords=10, MaxFragments=1, StartSel=**, StopSel=**"


class Hit(BaseModel):
    type: SearchType
    id: uuid.UUID
    title: str
    sub: str  # 문서=폴더, 채팅=#채널 또는 DM, 게시글=게시판
    snippet: str  # 일치 부분을 **…** 로 감싼 평문
    to: str  # 프론트 라우트
    at: datetime  # 최근성 근거 — 프론트가 "3일 전" 을 그린다


def _tsquery(q: str) -> str | None:
    """공백으로 나눈 토큰마다 접두 매칭, AND 로 묶는다. 쓸 만한 토큰이 없으면 None."""
    tokens = _TOKEN.findall(q)
    return " & ".join(f"{t}:*" for t in tokens[:16]) or None  # 16개 넘는 AND 는 의미가 없다


def _snippet(raw: str | None) -> str:
    # ts_headline 이 남긴 태그 조각을 무해화한다. ** 마커는 이스케이프 대상이 아니라 그대로 살아남는다
    return escape(raw or "", quote=False)


def _score(rank: ColumnElement, at: ColumnElement) -> ColumnElement:
    # 최근성: 지금이면 1, 일주일 지나면 0.5, 한 달이면 0.2 — ts_rank(대개 0.01~1) 와 같은 자릿수로 더한다
    age_days = func.extract("epoch", func.now() - at) / 86400.0
    return rank + 1.0 / (1.0 + age_days / 7.0)


@router.get(
    "/search",
    response_model=list[Hit],
    summary="⌘K 통합검색 — FTS + 최근성, 권한 필터 서버 적용 (FR-SHL-02). 권한 밖은 결과에서 빠진다",
)
async def search(
    q: str = Query(min_length=1, max_length=200),
    types: str = Query("doc,chat,post", description="쉼표 구분 — doc, chat, post"),
    limit: int = Query(20, ge=1, le=50),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Hit]:
    wanted = {t.strip() for t in types.split(",") if t.strip()}
    if not wanted or not wanted <= set(ALL_TYPES):
        raise ApiError(422, "VALIDATION", "types 는 doc, chat, post 중에서.")
    tsq_text = _tsquery(q)
    if tsq_text is None:
        return []
    tsq = func.to_tsquery("simple", tsq_text)
    hits: list[tuple[float, Hit]] = []

    if "doc" in wanted:
        body_tsv = func.coalesce(Document.tsv, func.to_tsvector("simple", ""))
        tsv = body_tsv.op("||")(func.to_tsvector("simple", Document.title))
        score = _score(func.ts_rank(tsv, tsq), Document.updated_at).label("score")
        rows = await db.execute(
            select(
                Document,
                Folder.title,
                score,
                func.ts_headline(
                    "simple", func.coalesce(Document.text_cache, ""), tsq, HEADLINE_OPTS
                ),
            )
            .options(*DOC_LIST_OPTS)  # 평문·tsv 는 SQL 식에서만 쓴다. 행으로는 안 가져온다
            .join(Folder, Folder.id == Document.folder_id)
            .where(Document.deleted_at.is_(None), tsv.op("@@")(tsq))
            .order_by(
                score.desc(), Document.updated_at.desc(), Document.id
            )  # limit 경계가 흔들리지 않게
            .limit(limit)
        )
        for doc, folder, score, snippet in rows:
            hits.append(
                (
                    score,
                    Hit(
                        type="doc",
                        id=doc.id,
                        title=doc.title,
                        sub=folder,
                        snippet=_snippet(snippet),
                        to=f"/docs/{doc.id}",
                        at=doc.updated_at,
                    ),
                )
            )

    if "chat" in wanted:
        score = _score(func.ts_rank(Message.tsv, tsq), Message.created_at).label("score")
        # DM 이름은 상대 이름 — 채널당 한 번 뽑는다(아래)
        rows = (
            await db.execute(
                select(
                    Message,
                    User.name,
                    Channel,
                    score,
                    func.ts_headline("simple", Message.body, tsq, HEADLINE_OPTS),
                )
                .join(User, User.id == Message.author_id)
                .join(Channel, Channel.id == Message.channel_id)
                .join(  # 권한 필터: 내가 멤버인 채널만
                    ChannelMember,
                    (ChannelMember.channel_id == Message.channel_id)
                    & (ChannelMember.user_id == user.id),
                )
                .where(Message.tsv.op("@@")(tsq))
                .order_by(score.desc(), Message.created_at.desc(), Message.id)
                .limit(limit)
            )
        ).all()
        dm_ids = {c.id for _, _, c, _, _ in rows if c.is_dm}
        peers: dict[uuid.UUID, str] = {}
        if dm_ids:
            for cid, name in await db.execute(
                select(ChannelMember.channel_id, User.name)
                .join(User, User.id == ChannelMember.user_id)
                .where(ChannelMember.channel_id.in_(dm_ids), User.id != user.id)
                .order_by(ChannelMember.channel_id, User.name)
            ):
                peers.setdefault(cid, name)
        for msg, author, channel, score, snippet in rows:
            sub = (
                f"DM · {peers.get(channel.id, '')}".rstrip(" ·")
                if channel.is_dm
                else f"#{channel.name}"
            )
            hits.append(
                (
                    score,
                    Hit(
                        type="chat",
                        id=msg.id,
                        title=author,
                        sub=sub,
                        snippet=_snippet(snippet),
                        to=f"/chat/{channel.id}?m={msg.id}",
                        at=msg.created_at,
                    ),
                )
            )

    if "post" in wanted:
        my_rank = ROLE_RANK.get(user.role, 0)
        allowed = [
            role for role, r in ROLE_RANK.items() if r <= my_rank
        ]  # 권한 필터: 내 등급 이상 게시판만
        score = _score(func.ts_rank(Post.tsv, tsq), Post.created_at).label("score")
        rows = await db.execute(
            select(
                Post,
                Board.name,
                score,
                func.ts_headline("simple", Post.body, tsq, HEADLINE_OPTS),
            )
            .join(Board, Board.id == Post.board_id)
            .where(Board.min_role.in_(allowed), Post.tsv.op("@@")(tsq))  # 빈 목록이면 항상 거짓
            .order_by(score.desc(), Post.created_at.desc(), Post.id)
            .limit(limit)
        )
        for post, board, score, snippet in rows:
            hits.append(
                (
                    score,
                    Hit(
                        type="post",
                        id=post.id,
                        title=post.title,
                        sub=board,
                        snippet=_snippet(snippet),
                        to=f"/board/{post.board_id}/{post.id}",
                        at=post.created_at,
                    ),
                )
            )

    hits.sort(key=lambda h: (-h[0], -h[1].at.timestamp(), str(h[1].id)))  # 동점이면 최근 것이 위
    return [hit for _, hit in hits[:limit]]
