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

import logging
import re
import uuid
from datetime import datetime
from html import escape
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import acl
from app.ai import embed
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import (
    DOC_LIST_OPTS,
    ROLE_RANK,
    Board,
    Channel,
    ChannelMember,
    DocChunk,
    Document,
    Folder,
    Message,
    Post,
    User,
)

log = logging.getLogger("zenith.search")
router = APIRouter(tags=["search"], dependencies=[Depends(current_user)])

SearchType = Literal["doc", "chat", "post"]
ALL_TYPES: tuple[SearchType, ...] = ("doc", "chat", "post")
# 글자·숫자 덩어리만 토큰이다 — tsquery 연산자·구두점·제어문자(NUL 은 드라이버에서 터진다)가 쿼리 문법이 되지
# 않고, "foo-bar"·"foo,bar" 는 그냥 foo & bar 다. 예외 둘(라이브 테스트 2026-10-15): 숫자 사이의 `.`·`-`("09.30"·"1.2.3"·
# "2026-10-15")와 글자 사이의 `.`("v1.2.3"·"zenith.local")은 Postgres 파서가 한 lexeme(또는 구문)으로 두기 때문에
# 쪼개 보내면 "30:*" 같은 조각이 아무것도 못 찾아 AND 전체가 0건이 된다 — 같은 파서가 쿼리도 읽으니 통째로 넘긴다.
_TOKEN = re.compile(r"\d+(?:[.-]\d+)+|[^\W_]+(?:\.[^\W_]+)*")
HEADLINE_OPTS = "MaxWords=24, MinWords=10, MaxFragments=1, StartSel=**, StopSel=**"
RRF_K = 60  # 순위 융합 상수(Cormack 2009 의 기본값) — 작을수록 1등 쏠림
# ponytail: kNN 은 거리가 멀어도 limit 를 채운다 — 이 상한 밖은 「관련 없음」으로 버린다(무관한 문서가 근거로
# Claude API 에 나가지 않게, 보안 리뷰). bge-m3 코사인 거리 임시값 — 실제 규정 문서 질문 시험지로 다시 잰다(README 45 라)
MAX_COSINE_DIST = 0.5


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


async def find_hits(
    db: AsyncSession,
    user: User,
    q: str,
    wanted: set[str],
    limit: int,
    *,
    headline: str = HEADLINE_OPTS,
    post_roles: list[str] | None = None,
    docs_ai_source_only: bool = False,
    folder_id: uuid.UUID | None = None,
    vector: bool = False,
    exclude_doc: uuid.UUID
    | None = None,  # 팩트체크가 검사 대상 문서 자신을 근거로 들지 않게(이슈 #410)
) -> list[Hit]:
    """FTS + 최근성, 권한 필터는 SQL 안에서. ⌘K 와 AI 검색 도구(ai.py)가 같이 쓴다 — 스니펫은 ts_headline 원문
    (`**…**` 마커, 이스케이프 안 함). `post_roles` 는 내 등급 필터 위에 **더 좁히기만** 한다.
    `docs_ai_source_only` 는 「AI 근거로 쓰기」가 켜진 문서만(README 43), `folder_id` 는 그 폴더와
    하위 폴더(모든 깊이)의 문서만(README 44 — AI 질문 범위).
    `vector` 는 문서를 벡터(doc_chunks)로도 찾아 **RRF** 로 합친다(README 45, AI 만) — 임베딩이 꺼져 있거나
    실패하면 FTS 만으로 돈다. 벡터로만 잡힌 문서의 스니펫은 청크 원문(`**` 마커 없음)."""
    tsq_text = _tsquery(q)
    use_vector = vector and "doc" in wanted and embed.enabled()
    if tsq_text is None and not use_vector:
        return []
    tsq = func.to_tsquery("simple", tsq_text or "")  # None 이면 chat·post 는 0건(벡터만 돈다)
    hits: list[tuple[float, Hit]] = []
    vector_hits: list[Hit] = []

    if "doc" in wanted:
        # 폴더 열람 권한(README 57) — ⌘K·AI 검색 도구 둘 다 여기서 걸러진다
        doc_filters = [
            Document.deleted_at.is_(None),
            Document.folder_id.in_(acl.visible_folder_ids(user)),
        ]
        if exclude_doc is not None:
            doc_filters.append(Document.id != exclude_doc)
        if docs_ai_source_only:
            doc_filters.append(Document.ai_source.is_(True))
        if folder_id is not None:
            # 폴더 트리를 아래로 따라 내려간다 — 깊이 제한 없음. UNION(ALL 아님)이라 이미 나온 행을 버려서
            # 폴더 고리(동시 이동 경합으로 생길 수 있다, docs._assert_no_cycle 주석)가 있어도 끝난다 — 보안 리뷰
            subtree = select(Folder.id).where(Folder.id == folder_id).cte("subtree", recursive=True)
            subtree = subtree.union(
                select(Folder.id).join(subtree, Folder.parent_id == subtree.c.id)
            )
            doc_filters.append(Document.folder_id.in_(select(subtree.c.id)))
        if use_vector:
            vector_hits = await _vector_hits(db, q, doc_filters, limit)
        body_tsv = func.coalesce(Document.tsv, func.to_tsvector("simple", ""))
        tsv = body_tsv.op("||")(func.to_tsvector("simple", Document.title))
        score = _score(func.ts_rank(tsv, tsq), Document.updated_at).label("score")
        stmt = (
            select(
                Document,
                Folder.title,
                score,
                func.ts_headline("simple", func.coalesce(Document.text_cache, ""), tsq, headline),
            )
            .options(*DOC_LIST_OPTS)  # 평문·tsv 는 SQL 식에서만 쓴다. 행으로는 안 가져온다
            .join(Folder, Folder.id == Document.folder_id)
            .where(*doc_filters, tsv.op("@@")(tsq))
            .order_by(
                score.desc(), Document.updated_at.desc(), Document.id
            )  # limit 경계가 흔들리지 않게
            .limit(limit)
        )
        rows = await db.execute(stmt) if tsq_text is not None else []  # 토큰이 없으면 벡터만
        for doc, folder, score, snippet in rows:
            hits.append(
                (
                    score,
                    Hit(
                        type="doc",
                        id=doc.id,
                        title=doc.title,
                        sub=folder,
                        snippet=snippet or "",
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
                    func.ts_headline("simple", Message.body, tsq, headline),
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
                        snippet=snippet or "",
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
        if post_roles is not None:
            allowed = [
                r for r in allowed if r in post_roles
            ]  # 더 좁히기만 한다(AI 근거: 일반 게시판만)
        score = _score(func.ts_rank(Post.tsv, tsq), Post.created_at).label("score")
        rows = await db.execute(
            select(
                Post,
                Board.name,
                score,
                func.ts_headline("simple", Post.body, tsq, headline),
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
                        snippet=snippet or "",
                        to=f"/board/{post.board_id}/{post.id}",
                        at=post.created_at,
                    ),
                )
            )

    hits.sort(key=lambda h: (-h[0], -h[1].at.timestamp(), str(h[1].id)))  # 동점이면 최근 것이 위
    if use_vector:
        return _rrf([[hit for _, hit in hits], vector_hits], limit)
    return [hit for _, hit in hits[:limit]]


async def _vector_hits(
    db: AsyncSession, q: str, doc_filters: list[ColumnElement], limit: int
) -> list[Hit]:
    """질문을 임베딩 한 번 → doc_chunks 코사인 kNN, 같은 문서 필터(휴지통·ai_source·폴더)를 조인으로 건다.
    한 문서는 가장 가까운 청크 하나로 접는다. 임베딩 실패는 빈 목록(FTS 로 계속)."""
    try:
        qvec = (await embed.embed([q], timeout=embed.QUERY_TIMEOUT_S))[0]
    except Exception:  # noqa: BLE001 — Ollama 가 죽었거나 모델이 없다. 답은 FTS 로 낸다
        log.warning("질문 임베딩 실패 — 핵심어 검색만 씁니다", exc_info=True)
        return []
    dist = DocChunk.embedding.cosine_distance(qvec).label("dist")
    # ponytail: 문서당 청크가 여럿이라 limit 의 몇 배를 가져와 접는다. 긴 문서가 상위를 독차지하면 DISTINCT ON 으로.
    rows = await db.execute(
        select(DocChunk.chunk_text, Document, Folder.title, dist)
        .options(*DOC_LIST_OPTS)
        .join(Document, Document.id == DocChunk.doc_id)
        .join(Folder, Folder.id == Document.folder_id)
        .where(*doc_filters, DocChunk.embedding.is_not(None), dist < MAX_COSINE_DIST)
        .order_by(dist, DocChunk.id)
        .limit(limit * 4)
    )
    out: list[Hit] = []
    seen: set[uuid.UUID] = set()
    for chunk_text, doc, folder, _ in rows:
        if doc.id in seen:
            continue
        seen.add(doc.id)
        out.append(
            Hit(
                type="doc",
                id=doc.id,
                title=doc.title,
                sub=folder,
                snippet=chunk_text,
                to=f"/docs/{doc.id}",
                at=doc.updated_at,
            )
        )
        if len(out) == limit:
            break
    return out


def _rrf(ranked: list[list[Hit]], limit: int) -> list[Hit]:
    """Reciprocal Rank Fusion — 목록마다 1/(K+순위) 를 더해 합친다. 같은 자료(`to`)는 먼저 나온 목록의 스니펫
    (FTS 의 `**` 강조)을 쓴다."""
    fused: dict[str, tuple[float, Hit]] = {}
    for hits in ranked:
        for rank, hit in enumerate(hits, start=1):
            score, kept = fused.get(hit.to, (0.0, hit))
            fused[hit.to] = (score + 1.0 / (RRF_K + rank), kept)
    ordered = sorted(fused.values(), key=lambda h: (-h[0], -h[1].at.timestamp(), str(h[1].id)))
    return [hit for _, hit in ordered[:limit]]


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
    hits = await find_hits(db, user, q, wanted, limit)
    for hit in hits:
        hit.snippet = _snippet(hit.snippet)
    return hits
