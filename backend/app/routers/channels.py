"""04-API §5 채팅 (REST 보조). 전송·읽음·타이핑은 §4.1 /ws(realtime/chat.py)로 간다 — 여기는 목록·생성·과거 메시지.

멤버십 모델(README "설계와 어긋나는 것" 12): 공개 채널은 만들 때 활성 사용자 전원을 멤버로 넣는다(15명 사내,
초대·탈퇴 없음 — 새 계정은 admin 이 만들 때 모든 공개 채널에 들어간다). DM 은 두 사람짜리 채널이고 같은 두 사람의
DM 은 하나만 둔다. 멤버 아닌 채널은 없는 채널과 같은 403 + 감사(소켓과 같은 판정).
"""

import re
import uuid
from datetime import datetime
from typing import Annotated
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import func, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit, storage
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import Channel, ChannelMember, Message, User, Workspace
from app.paging import decode_cursor, encode_cursor

router = APIRouter(tags=["chat"], dependencies=[Depends(current_user)])

NonBlank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]

# ── 첨부 (FR-CHT-04) ──────────────────────────────────────────────────────
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # FR-CHT-04 · TC-CHT-04
MAX_ATTACHMENTS = 10  # 메시지 하나에
# 브라우저가 인라인으로 그려도 스크립트가 돌지 않는 형식만 inline. SVG·HTML 은 같은 오리진에서 XSS 가 되므로 내려받기로.
INLINE_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})


class AttachmentOut(BaseModel):
    """업로드 응답이자 messages.attachments[] 항목(03 §2.3 JSONB)."""

    url: str = Field(
        max_length=2000
    )  # 한글 이름은 quote 로 글자당 9자 — 200자 이름이면 1900자 남짓
    name: str = Field(min_length=1, max_length=200)
    size: int = Field(ge=0, le=MAX_ATTACHMENT_BYTES)


def attachment_key(channel_id: uuid.UUID, file_id: uuid.UUID, name: str) -> str:
    return f"channels/{channel_id}/{file_id}/{name}"


def attachment_url(channel_id: uuid.UUID, file_id: uuid.UUID, name: str) -> str:
    return f"/api/channels/{channel_id}/attachments/{file_id}/{quote(name, safe='')}"


def parse_attachment_url(url: str, channel_id: uuid.UUID) -> str | None:
    """이 채널의 업로드 URL 이면 그 파일명, 아니면 None — 소켓 `msg` op 가 첨부를 끼울 때 대조한다.

    채널 id 가 경로에 있어 남의 채널 파일을 메시지에 끼울 수 없고, 파일명은 업로드 때 정해진 것과 같아야 한다."""
    prefix = f"/api/channels/{channel_id}/attachments/"
    if not url.startswith(prefix):
        return None
    rest = url[len(prefix) :].split("/")
    if len(rest) != 2 or not rest[1]:
        return None
    try:
        uuid.UUID(rest[0])
    except ValueError:
        return None
    return unquote(rest[1])


def _safe_name(filename: str | None) -> str:
    # 경로 구분자·제어문자를 벗기고 basename 만. 키와 Content-Disposition 에 그대로 쓴다.
    name = "".join(
        c if c.isprintable() and c not in "/\\" else "_" for c in (filename or "").strip()
    ).strip(". ")
    # MinIO 는 경로 조각 하나를 파일시스템 이름(255바이트)으로 쓴다 — 글자가 아니라 바이트로 자른다
    return name.encode()[:200].decode("utf-8", "ignore").strip(". ") or "file"


class Person(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class MessageOut(BaseModel):
    """§4.1 `msg` 이벤트의 message 와 같은 모양."""

    id: uuid.UUID
    channel_id: uuid.UUID
    author: Person
    body: str
    doc_ref: uuid.UUID | None
    attachments: list[AttachmentOut] | None
    created_at: datetime


class ChannelOut(BaseModel):
    id: uuid.UUID
    name: str  # DM 은 상대 이름
    is_dm: bool
    members: list[Person]
    unread: int
    last_message: MessageOut | None


class ChannelCreateIn(BaseModel):
    name: NonBlank | None = None
    dm_user_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _one_of(self) -> "ChannelCreateIn":
        if (self.name is None) == (self.dm_user_id is None):
            raise ValueError("name 또는 dm_user_id 중 하나만 보낸다.")
        return self


class Items[T](BaseModel):
    items: list[T]


class MessagePage(BaseModel):
    items: list[MessageOut]  # 오래된 순 — 화면에 그대로 붙인다
    next_cursor: str | None  # 더 과거가 있으면. 다음 요청의 ?cursor=


def _message_out(m: Message, author: User) -> MessageOut:
    return MessageOut(
        id=m.id,
        channel_id=m.channel_id,
        author=Person.model_validate(author),
        body=m.body,
        doc_ref=m.doc_ref,
        attachments=m.attachments,
        created_at=m.created_at,
    )


async def _require_member(
    db: AsyncSession, request: Request, user: User, channel_id: uuid.UUID
) -> None:
    """멤버가 아니면(없는 채널 포함) 403 + acl.denied — 소켓(realtime/chat.py)과 같은 판정."""
    row = await db.get(ChannelMember, (channel_id, user.id))
    if row is None:
        audit.record(
            db,
            "acl.denied",
            request=request,
            actor_id=user.id,
            target_id=channel_id,
            detail={"path": request.url.path},
        )
        await db.commit()
        raise ApiError(403, "FORBIDDEN", "권한이 부족합니다.")


async def _members_of(
    db: AsyncSession, channel_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[User]]:
    out: dict[uuid.UUID, list[User]] = {cid: [] for cid in channel_ids}
    if channel_ids:
        rows = await db.execute(
            select(ChannelMember.channel_id, User)
            .join(User, User.id == ChannelMember.user_id)
            .where(ChannelMember.channel_id.in_(channel_ids))
            .order_by(User.name)
        )
        for cid, u in rows:
            out[cid].append(u)
    return out


async def join_public_channels(db: AsyncSession, user_id: uuid.UUID) -> None:
    """사용자를 모든 공개 채널에 넣는다(이미 있으면 건너뜀) — admin.create_user 와 seed 가 부른다. commit 은 호출한 쪽이."""
    rows = [
        {"channel_id": cid, "user_id": user_id}
        for cid in (await db.execute(select(Channel.id).where(Channel.is_dm.is_(False)))).scalars()
    ]
    if rows:
        await db.execute(pg_insert(ChannelMember).values(rows).on_conflict_do_nothing())


@router.get(
    "/channels",
    response_model=Items[ChannelOut],
    summary="내 채널·DM 목록 + unread 카운트 + 마지막 메시지 — 최근 대화순",
)
async def list_channels(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Items[ChannelOut]:
    # 안 읽음은 홈(me.py)·소켓(chat.py)과 같은 기준: last_read_at 이후, 내 글 제외 (03 §2.3)
    unread = func.count(Message.id)
    rows = (
        await db.execute(
            select(Channel, unread)
            .join(ChannelMember, ChannelMember.channel_id == Channel.id)
            .outerjoin(
                Message,
                (Message.channel_id == Channel.id)
                & (Message.author_id != user.id)
                & (
                    (ChannelMember.last_read_at.is_(None))
                    | (Message.created_at > ChannelMember.last_read_at)
                ),
            )
            .where(ChannelMember.user_id == user.id)
            .group_by(Channel.id)
        )
    ).all()
    channel_ids = [c.id for c, _ in rows]
    members = await _members_of(db, channel_ids)
    # 채널마다 마지막 메시지 하나 — DISTINCT ON 으로 한 방에
    last: dict[uuid.UUID, MessageOut] = {}
    if channel_ids:
        last_rows = await db.execute(
            select(Message, User)
            .join(User, User.id == Message.author_id)
            .where(Message.channel_id.in_(channel_ids))
            .distinct(Message.channel_id)
            .order_by(Message.channel_id, Message.created_at.desc(), Message.id.desc())
        )
        for m, author in last_rows:
            last[m.channel_id] = _message_out(m, author)
    items = [
        ChannelOut(
            id=c.id,
            name=_display_name(c, members[c.id], user),
            is_dm=c.is_dm,
            members=[Person.model_validate(u) for u in members[c.id]],
            unread=count,
            last_message=last.get(c.id),
        )
        for c, count in rows
    ]
    # 최근 대화가 위로, 대화 없는 채널은 이름순으로 아래에
    items.sort(
        key=lambda i: (
            i.last_message is None,
            -(i.last_message.created_at.timestamp() if i.last_message else 0),
            i.name,
        )
    )
    return Items(items=items)


def _display_name(channel: Channel, members: list[User], viewer: User) -> str:
    if not channel.is_dm:
        return channel.name
    others = [u.name for u in members if u.id != viewer.id]
    return others[0] if others else viewer.name  # 상대가 지워졌으면 내 이름


@router.post(
    "/channels",
    status_code=201,
    response_model=ChannelOut,
    summary="{name} 공개 채널(활성 사용자 전원 멤버) 또는 {dm_user_id} DM(있으면 그것) 생성",
    responses={409: {"description": "CONFLICT — 같은 이름의 채널"}},
)
async def create_channel(
    body: ChannelCreateIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ChannelOut:
    ws_id = (await db.execute(select(Workspace.id).limit(1))).scalar()
    if ws_id is None:
        raise ApiError(
            409, "CONFLICT", "워크스페이스가 없습니다. scripts/seed.py 를 먼저 돌리세요."
        )
    if body.dm_user_id is not None:
        if body.dm_user_id == user.id:
            raise ApiError(422, "VALIDATION", "자기 자신과는 DM 을 만들 수 없습니다.")
        peer = await db.get(User, body.dm_user_id)
        if peer is None or not peer.active:
            raise ApiError(422, "VALIDATION", "없는 사용자입니다.")
        # 같은 두 사람이 동시에 서로에게 DM 을 걸어도 하나만 생기게 — 두 사람 짝으로 트랜잭션 자문 잠금
        a, b = sorted([str(user.id), str(peer.id)])
        await db.execute(select(func.pg_advisory_xact_lock(func.hashtextextended(f"{a}|{b}", 0))))
        # 같은 두 사람의 DM 이 이미 있으면 그것을 돌려준다 — 두 사람 다 멤버이고 **멤버가 딱 둘인** DM 채널
        mine = select(ChannelMember.channel_id).where(ChannelMember.user_id == user.id)
        theirs = select(ChannelMember.channel_id).where(ChannelMember.user_id == peer.id)
        size = select(func.count()).where(ChannelMember.channel_id == Channel.id).scalar_subquery()
        existing = (
            (
                await db.execute(
                    select(Channel)
                    .where(
                        Channel.is_dm.is_(True),
                        Channel.id.in_(mine),
                        Channel.id.in_(theirs),
                        size == 2,
                    )
                    .order_by(Channel.id)
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            channel = existing
        else:
            channel = Channel(ws_id=ws_id, name="", is_dm=True)
            db.add(channel)
            await db.flush()
            db.add_all(
                [ChannelMember(channel_id=channel.id, user_id=uid) for uid in (user.id, peer.id)]
            )
    else:
        assert body.name is not None
        # 친절한 409 — 경합은 uq_channels_public_name 이 막고 IntegrityError 핸들러가 409 로 돌려준다
        dup = await db.execute(
            select(Channel.id).where(Channel.is_dm.is_(False), Channel.name == body.name)
        )
        if dup.first():
            raise ApiError(409, "CONFLICT", "같은 이름의 채널이 있습니다.")
        channel = Channel(ws_id=ws_id, name=body.name, is_dm=False)
        db.add(channel)
        await db.flush()
        # 비활성 계정도 넣는다 — 복직하면 그 사이 생긴 채널도 보여야 한다(seed·admin 과 같은 규칙)
        # ponytail: 계정 생성과 채널 생성이 정확히 겹치면 서로의 미커밋 행을 못 봐 한 명이 빠질 수 있다 —
        # 15명 사내에서 admin 계정 생성과 채널 생성이 같은 순간일 일은 없다. 생기면 seed.py 재실행이 메운다.
        member_ids = list((await db.execute(select(User.id))).scalars())
        db.add_all([ChannelMember(channel_id=channel.id, user_id=uid) for uid in member_ids])
    await db.commit()
    members = (await _members_of(db, [channel.id]))[channel.id]
    return ChannelOut(
        id=channel.id,
        name=_display_name(channel, members, user),
        is_dm=channel.is_dm,
        members=[Person.model_validate(u) for u in members],
        unread=0,
        last_message=None,
    )


@router.get(
    "/channels/{id}/messages",
    response_model=MessagePage,
    summary="과거 메시지 — ?cursor= 이전 것 limit(기본 50)개, 오래된 순. next_cursor 로 더 과거",
)
async def list_messages(
    id: uuid.UUID,
    request: Request,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> MessagePage:
    await _require_member(db, request, user, id)
    stmt = (
        select(Message, User)
        .join(User, User.id == Message.author_id)
        .where(Message.channel_id == id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(limit + 1)
    )
    if cursor:
        at, mid = decode_cursor(cursor)
        stmt = stmt.where(tuple_(Message.created_at, Message.id) < (at, mid))
    rows = (await db.execute(stmt)).all()
    more = len(rows) > limit
    rows = rows[:limit]
    return MessagePage(
        items=[_message_out(m, a) for m, a in reversed(rows)],
        next_cursor=encode_cursor(rows[-1][0].created_at, rows[-1][0].id) if more else None,
    )


@router.post(
    "/channels/{id}/attachments",
    status_code=201,
    response_model=AttachmentOut,
    summary="multipart `file` 업로드 → MinIO. 10MB 초과·빈 파일 422. {url, name, size} 를 msg op 의 attachments[] 에 그대로 넣는다",
)
async def upload_attachment(
    id: uuid.UUID,
    file: UploadFile,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> AttachmentOut:
    await _require_member(db, request, user, id)
    # FastAPI 는 의존성(인증·CSRF)보다 먼저 multipart 를 다 받아 둔다(1MB 넘으면 임시 파일) — 거대한 본문은
    # main.py 의 body_limit 미들웨어가 Content-Length 로 먼저 끊는다. 여기서는 상한 + 1 바이트만 읽어 판정.
    # ponytail: 사용자별 쿼터·레이트리밋·메시지에 안 실린 오브젝트 정리가 없다 — 멤버가 10MB 를 반복 올리면
    # minio 볼륨이 찬다(15명 사내). 필요해지면 사용자별 일일 카운터 + 미참조 오브젝트 정리 배치.
    data = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ApiError(422, "VALIDATION", "10MB 이하 파일만 올릴 수 있습니다.")
    if not data:
        raise ApiError(422, "VALIDATION", "빈 파일입니다.")
    name = _safe_name(file.filename)
    file_id = uuid.uuid4()
    # multipart 헤더 값을 그대로 저장·반사하므로 토큰/토큰 모양만 받는다 — 나머지는 octet-stream
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if not re.fullmatch(r"[\w.+-]+/[\w.+-]+", content_type):
        content_type = "application/octet-stream"
    await storage.put(attachment_key(id, file_id, name), data, content_type)
    return AttachmentOut(url=attachment_url(id, file_id, name), name=name, size=len(data))


@router.get(
    "/channels/{id}/attachments/{file_id}/{name}",
    summary="첨부 내려받기 — 채널 멤버만. 이미지(png·jpeg·gif·webp)는 inline, 나머지는 attachment",
    response_class=Response,
    responses={200: {"content": {"application/octet-stream": {}}}},
)
async def download_attachment(
    id: uuid.UUID,
    file_id: uuid.UUID,
    name: str,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await _require_member(db, request, user, id)
    # 이름을 다시 정규화하지 않는다 — 서버가 발급한 URL 만 통하고(`..a.png` 같은 별칭 없음) 저장된 이름 그대로 내려간다
    found = await storage.get(attachment_key(id, file_id, name))
    if found is None:
        raise ApiError(404, "NOT_FOUND", "없는 첨부입니다.")
    data, content_type = found
    disposition = "inline" if content_type in INLINE_TYPES else "attachment"
    return Response(
        data,
        media_type=content_type,
        headers={
            # RFC 6266 — 한글 파일명은 filename* 로. 브라우저에서 스크립트가 돌 수 있는 형식은 내려받기만.
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name, safe='')}",
            "X-Content-Type-Options": "nosniff",
            # 키에 랜덤 file_id 가 있어 불변 — 인라인 이미지가 스크롤마다 MinIO 를 다시 타지 않게(main.py 의 no-store 는 setdefault)
            "Cache-Control": "private, max-age=86400",
        },
    )
