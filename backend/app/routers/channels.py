"""04-API §5 채팅 (REST 보조). 전송·읽음·타이핑은 §4.1 /ws(realtime/chat.py)로 간다 — 여기는 목록·생성·과거 메시지.

멤버십 모델(README "설계와 어긋나는 것" 12): 공개 채널은 만들 때 활성 사용자 전원을 멤버로 넣는다(15명 사내,
초대·탈퇴 없음 — 새 계정은 admin 이 만들 때 모든 공개 채널에 들어간다). DM 은 두 사람짜리 채널이고 같은 두 사람의
DM 은 하나만 둔다. 멤버 아닌 채널은 없는 채널과 같은 403 + 감사(소켓과 같은 판정).
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator
from sqlalchemy import func, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import Channel, ChannelMember, Message, User, Workspace
from app.paging import decode_cursor, encode_cursor
from app.stubs import register_stubs

router = APIRouter(tags=["chat"], dependencies=[Depends(current_user)])

NonBlank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


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
    attachments: list | None
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


register_stubs(
    router,
    [
        # ponytail: FR-CHT-04(S) — MinIO 연결과 함께. compose 의 minio 는 아직 코드가 안 쓴다.
        # 구현할 때 _require_member 필수 — 남의 채널에 파일을 붙이면 안 된다.
        ("POST", "/channels/{id}/attachments", "multipart 업로드 → MinIO, {url, name, size}"),
    ],
)
