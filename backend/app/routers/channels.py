"""04-API §5 채팅 (REST 보조). 전송·읽음·타이핑은 §4.1 /ws(realtime/chat.py)로 간다 — 여기는 목록·생성·과거 메시지.

멤버십 모델(README "설계와 어긋나는 것" 12): 공개 채널은 만들 때 활성 사용자 전원을 멤버로 넣는다(15명 사내,
초대·탈퇴 없음 — 새 계정은 admin 이 만들 때 모든 공개 채널에 들어간다). DM 은 두 사람짜리 채널이고 같은 두 사람의
DM 은 하나만 둔다. **비공개 채널**(2026-10-02, 이슈 #221)은 만든 사람 + 고른 사람만 멤버이고, 멤버면 누구나
사람을 더하고 뺄 수 있다(`/channels/{id}/members`, 연 사람은 본인만 나간다 — #349). 멤버 아닌 채널은 없는 채널과 같은 403 + 감사(소켓과 같은 판정).
"""

import logging
import re
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StringConstraints,
    model_validator,
)
from sqlalchemy import delete, func, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app import audit, storage
from app.ai import chat_command
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import (
    Channel,
    ChannelMember,
    ChannelUpload,
    Message,
    Notification,
    User,
    Workspace,
)
from app.paging import decode_cursor, encode_cursor

log = logging.getLogger(__name__)

router = APIRouter(tags=["chat"], dependencies=[Depends(current_user)])


def _clean_name(value: str) -> str:
    """이름을 NFKC 로 정규화하고 제어·서식 문자를 거절한다(이슈 #283).

    `str.strip()` 은 앞뒤 공백만 벗겨서 `"공지\u200b"`(제로폭 공백)·전각 문자·RTL 제어문자가 눈으로는 같은
    이름으로 통과해 공개 채널 이름 유일성(`uq_channels_public_name`)을 피해 갔고, `"\x00"` 은 Postgres 가 거절해 500 이었다."""
    # 한글 호환 자모(U+3131~U+318E, 입력기가 넣는 「ㅇㅇ」)는 NFKC 가 조합용 자모로 바꿔 위에 작게 깨져 보인다(#439).
    # 그 구간만 건너뛰고 나머지는 접는다 — ㅇ(U+3147)과 ᄋ(U+110B)은 눈으로도 다른 글자라 #283 의 목적은 그대로.
    value = re.sub(r"[^ㄱ-ㆎ]+", lambda m: unicodedata.normalize("NFKC", m.group()), value).strip()
    # C*(제어·서식·대리·사용자 정의·미할당)와 줄·문단 구분자(Zl·Zp). ZWJ 이모지(👨‍👩‍👧)도 Cf 라 막힌다 —
    # 허용하면 `공지\u200d` 우회가 생긴다. 변형 선택자(Mn)·한글 채움(U+3164) 같은 잔여 우회는 README 26.
    if any(
        unicodedata.category(c)[0] == "C" or unicodedata.category(c) in ("Zl", "Zp") for c in value
    ):
        raise ValueError("이름에 쓸 수 없는 문자가 있습니다.")
    if not value:
        raise ValueError("이름을 적어 주세요.")
    if (
        len(value) > 100
    ):  # NFKC 는 합자(ﬃ→ffi)·호환 문자를 풀어 길이가 늘 수 있다 — 정규화 뒤에도 100자
        raise ValueError("이름은 100자 이하여야 합니다.")
    return value


NonBlank = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    AfterValidator(_clean_name),
]

# ── 첨부 (FR-CHT-04) ──────────────────────────────────────────────────────
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # FR-CHT-04 · TC-CHT-04
MAX_ATTACHMENTS = 10  # 메시지 하나에
# 브라우저가 인라인으로 그려도 스크립트가 돌지 않는 형식만 inline. SVG·HTML 은 같은 오리진에서 XSS 가 되므로 내려받기로.
INLINE_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})
# `type/subtype` 토큰만 — 업로드가 만드는 값(소문자·앞뒤 공백 없음)과 정확히 같은 모양이라야
# 되돌아온 값도 같다. 대소문자를 남기면 프론트 허용목록이 `IMAGE/PNG` 로 우회된다.
CONTENT_TYPE_RE = re.compile(r"[\w.+-]+/[\w.+-]+")
CONTENT_TYPE = Annotated[
    str,
    StringConstraints(
        to_lower=True,
        strip_whitespace=True,
        pattern=rf"^{CONTENT_TYPE_RE.pattern}$",
        max_length=100,
    ),
]


class AttachmentOut(BaseModel):
    """업로드 응답이자 messages.attachments[] 항목(03 §2.3 JSONB)."""

    url: str = Field(
        max_length=2000
    )  # 한글 이름은 quote 로 글자당 9자 — 200자 이름이면 1900자 남짓
    name: str = Field(min_length=1, max_length=200)
    size: int = Field(ge=0, le=MAX_ATTACHMENT_BYTES)
    # 아이콘·미리보기를 이름의 확장자로 짐작하지 않게. 표시용이지만 msg op 로 되돌아올 때 클라이언트 값은 버리고
    # 올릴 때 기록한 값(channel_uploads)으로 덮어쓴다(#324). 실제 내려받기는 MinIO 에 저장된 형식으로 판정한다.
    # 2026-09-18 이전 메시지는 저장된 JSONB 에 이 칸이 없어 응답에 null 로 나간다.
    content_type: CONTENT_TYPE | None = None


def _normalize_content_type(raw: str | None) -> str:
    """multipart 헤더 값을 그대로 저장·반사하므로 `type/subtype` 토큰만 받는다 — 나머지는 octet-stream."""
    value = (raw or "").split(";")[0].strip().lower()
    return value if CONTENT_TYPE_RE.fullmatch(value) else "application/octet-stream"


def attachment_key(channel_id: uuid.UUID, file_id: uuid.UUID, name: str) -> str:
    return f"channels/{channel_id}/{file_id}/{name}"


def attachment_url(channel_id: uuid.UUID, file_id: uuid.UUID, name: str) -> str:
    return f"/api/channels/{channel_id}/attachments/{file_id}/{quote(name, safe='')}"


def parse_attachment_url(url: str, channel_id: uuid.UUID) -> tuple[uuid.UUID, str] | None:
    """이 채널의 업로드 URL 이면 (file_id, 파일명), 아니면 None — 소켓 `msg` op 가 첨부를 끼울 때 대조한다.

    채널 id 가 경로에 있어 남의 채널 파일을 메시지에 끼울 수 없고, 파일명은 업로드 때 정해진 것과 같아야 한다."""
    prefix = f"/api/channels/{channel_id}/attachments/"
    if not url.startswith(prefix):
        return None
    rest = url[len(prefix) :].split("/")
    if len(rest) != 2 or not rest[1]:
        return None
    try:
        return uuid.UUID(rest[0]), unquote(rest[1])
    except ValueError:
        return None


class Person(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    is_bot: bool = False  # 「AI 어시스턴트」 봇 글(README 52) — 프론트는 이름이 아니라 이걸로 가린다(이슈 #403)


class MessageOut(BaseModel):
    """§4.1 `msg` 이벤트의 message 와 같은 모양."""

    id: uuid.UUID
    channel_id: uuid.UUID
    author: Person
    body: str
    doc_ref: uuid.UUID | None
    attachments: list[AttachmentOut] | None
    created_at: datetime
    edited_at: datetime | None  # 고친 적 없으면 null (#264)


class ChannelOut(BaseModel):
    id: uuid.UUID
    name: str  # DM 은 상대 이름
    is_dm: bool
    is_private: bool  # DM 은 false. 프론트는 이 칸이 있어야 「비공개로 만들기」를 그린다(#221)
    members: list[Person]
    unread: int
    last_message: MessageOut | None
    can_delete: bool  # 보는 사람이 지울 수 있나(#349) — 프론트는 이 값으로만 메뉴를 그린다
    created_by: (
        uuid.UUID | None
    )  # 연 사람(#349) — 멤버 명단에서 그 사람의 「빼기」를 숨기는 데 쓴다. 칸 전 채널은 null


MemberIds = Annotated[list[uuid.UUID], Field(max_length=200)]


class ChannelCreateIn(BaseModel):
    model_config = ConfigDict(
        extra="forbid"
    )  # `isPrivate` 처럼 칸 이름을 틀려도 조용한 공개가 되지 않게

    name: NonBlank | None = None
    dm_user_id: uuid.UUID | None = None
    # 비공개는 두 칸이 **같이** 와야 한다. 한쪽만 오면 422 — 모르는 칸을 버리고 조용히 공개 채널을 만들던 것이
    # 이슈 #221 의 사고였다. StrictBool: "true" 같은 문자열도 422.
    is_private: StrictBool | None = None
    member_ids: MemberIds | None = None

    @model_validator(mode="after")
    def _one_of(self) -> "ChannelCreateIn":
        if (self.name is None) == (self.dm_user_id is None):
            raise ValueError("name 또는 dm_user_id 중 하나만 보낸다.")
        if "is_private" in self.model_fields_set and self.is_private is None:
            raise ValueError("is_private 는 참·거짓이어야 한다.")
        if self.dm_user_id is not None and (
            self.is_private is not None or self.member_ids is not None
        ):
            raise ValueError("DM 에는 is_private·member_ids 를 보내지 않는다.")
        if (self.is_private is True) != (self.member_ids is not None):
            raise ValueError("비공개 채널은 is_private: true 와 member_ids 를 같이 보낸다.")
        return self


class ChannelPatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: NonBlank


class MembersIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_ids: MemberIds = Field(min_length=1)


class Items[T](BaseModel):
    items: list[T]


class MessagePage(BaseModel):
    items: list[MessageOut]  # 오래된 순 — 화면에 그대로 붙인다
    next_cursor: str | None  # 더 과거가 있으면. 다음 요청의 ?cursor=


def _message_out(m: Message, author: User) -> MessageOut:
    return MessageOut(
        id=m.id,
        channel_id=m.channel_id,
        author=Person(id=author.id, name=author.name, is_bot=chat_command.is_bot(author)),
        body=m.body,
        doc_ref=m.doc_ref,
        attachments=m.attachments,
        created_at=m.created_at,
        edited_at=m.edited_at,
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
    """사용자를 모든 공개 채널에 넣는다(이미 있으면 건너뜀) — admin.create_user 와 seed 가 부른다. commit 은 호출한 쪽이.

    이 정책(공개 채널 = 전원) 위에 `routers/people.py` 의 "사람 목록은 전사 공개" 가 서 있다 —
    비공개 채널은 건너뛰지만 공개 채널엔 여전히 전원이 들어간다. 공개 채널을 초대제로 바꾸면 거기도 같이 좁힌다."""
    rows = [
        {"channel_id": cid, "user_id": user_id}
        for cid in (
            await db.execute(
                select(Channel.id).where(Channel.is_dm.is_(False), Channel.is_private.is_(False))
            )
        ).scalars()
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
            .where(ChannelMember.user_id == user.id, ChannelMember.hidden_at.is_(None))
            .group_by(Channel.id)
        )
    ).all()
    channel_ids = [c.id for c, _ in rows]
    members = await _members_of(db, channel_ids)
    # 채널마다 마지막 메시지 하나 — 채널별로 인덱스(idx_messages_channel) 맨 앞 한 줄만 집는다.
    # DISTINCT ON 은 한 문장이긴 해도 내 채널의 메시지를 전부 훑는다(2026-09-21 측정: 메시지 6만·채널 38 에서 41ms → 1ms).
    last: dict[uuid.UUID, MessageOut] = {}
    if channel_ids:
        # 바깥도 messages 라 별칭을 준다. 없으면 안쪽이 바깥 messages 에 묶여 오류 없이 틀린 결과가 난다
        m = aliased(Message)
        newest = (
            select(m.id)
            .where(m.channel_id == Channel.id)
            .order_by(m.created_at.desc(), m.id.desc())
            .limit(1)
            .scalar_subquery()
        )
        last_rows = await db.execute(
            select(Message, User)
            .join(User, User.id == Message.author_id)
            .where(Message.id.in_(select(newest).where(Channel.id.in_(channel_ids))))
        )
        for m, author in last_rows:
            last[m.channel_id] = _message_out(m, author)
    items = [
        ChannelOut(
            id=c.id,
            name=_display_name(c, members[c.id], user),
            is_dm=c.is_dm,
            is_private=c.is_private,
            members=[Person.model_validate(u) for u in members[c.id]],
            unread=count,
            last_message=last.get(c.id),
            can_delete=_can_delete(c, members[c.id], user),
            created_by=c.created_by,
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


def _channel_out(channel: Channel, members: list[User], viewer: User) -> ChannelOut:
    """생성·멤버 변경 응답 — unread 0·last_message null(목록은 GET 으로, README 12)."""
    return ChannelOut(
        id=channel.id,
        name=_display_name(channel, members, viewer),
        is_dm=channel.is_dm,
        is_private=channel.is_private,
        members=[Person.model_validate(u) for u in members],
        unread=0,
        last_message=None,
        can_delete=_can_delete(channel, members, viewer),
        created_by=channel.created_by,
    )


def _can_delete(channel: Channel, members: list[User], viewer: User) -> bool:
    """#349: 공개 채널은 임원(전 직원이 멤버라 사원 한 명이 전사 대화를 지우면 안 된다), 비공개는 연 사람.
    연 사람 기록이 없거나(칸이 생기기 전 채널) 연 사람이 빠졌거나 비활성(퇴사)이면 멤버인 임원. DM 은 숨기기만."""
    if channel.is_dm:
        return False
    if not channel.is_private:
        return viewer.role == "exec"
    if channel.created_by == viewer.id:
        return True
    # 복직하면(active) 연 사람 권한이 돌아온다
    creator_present = any(u.id == channel.created_by and u.active for u in members)
    return viewer.role == "exec" and not creator_present


async def _active_users(db: AsyncSession, ids: list[uuid.UUID]) -> list[User]:
    """고른 사람 전부가 활성 계정이어야 한다 — 없거나 비활성이면 422(DM 상대와 같은 규칙)."""
    wanted = set(ids)
    users = list(
        (await db.execute(select(User).where(User.id.in_(wanted), User.active.is_(True)))).scalars()
    )
    if len(users) != len(wanted):
        raise ApiError(422, "VALIDATION", "없는 사용자입니다.")
    return users


async def _lock_channel(db: AsyncSession, channel_id: uuid.UUID) -> None:
    """멤버 변경은 채널마다 직렬화 — 권한 확인과 반영 사이에 요청한 사람이 빠지면, 늦게 반영된 요청이
    그 사람을 되살린다(#221 에서 릴레이로 재현). 트랜잭션 자문 잠금이라 commit·rollback 에 풀린다."""
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtextextended(str(channel_id), 0))))


async def _notify_channels(user_ids) -> None:
    """`{ev:"channels"}` — 「네 채널 목록이 바뀌었다, 다시 받아라」. 비공개 채널을 만들거나 멤버가 바뀔 때
    전·후 멤버 모두에게. commit 뒤에 부른다."""
    # realtime.chat 이 이 모듈을 import 하므로 함수 안에서 — 순환 import 회피
    from app.realtime import chat

    await chat.push(user_ids, {"ev": "channels"})


def _display_name(channel: Channel, members: list[User], viewer: User) -> str:
    if not channel.is_dm:
        return channel.name
    others = [u.name for u in members if u.id != viewer.id]
    return others[0] if others else viewer.name  # 상대가 지워졌으면 내 이름


@router.post(
    "/channels",
    status_code=201,
    response_model=ChannelOut,
    summary="{name} 공개 채널(전원 멤버) · {name, is_private:true, member_ids} 비공개 채널(만든 사람+고른 사람) · {dm_user_id} DM(있으면 그것)",
    responses={409: {"description": "CONFLICT — 같은 이름의 공개 채널(비공개는 중복 허용)"}},
)
async def create_channel(
    body: ChannelCreateIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ChannelOut:
    ws_id = (await db.execute(select(Workspace.id).limit(1))).scalar()
    notify: list[uuid.UUID] = []
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
            # 숨겨 둔 방을 다시 여는 길 — 상대 쪽은 건드리지 않는다(#268)
            unhidden = await db.execute(
                update(ChannelMember)
                .where(
                    ChannelMember.channel_id == channel.id,
                    ChannelMember.user_id == user.id,
                    ChannelMember.hidden_at.is_not(None),
                )
                .values(hidden_at=None)
            )
            if unhidden.rowcount:
                notify = [user.id]  # 다른 탭의 목록도 맞춘다
        else:
            channel = Channel(ws_id=ws_id, name="", is_dm=True, created_by=user.id)
            db.add(channel)
            await db.flush()
            db.add_all(
                [ChannelMember(channel_id=channel.id, user_id=uid) for uid in (user.id, peer.id)]
            )
    elif body.member_ids is not None:
        assert body.name is not None
        # 비공개: 이름 중복은 보지 않는다(409 가 안 보이는 채널의 존재를 샌다). 만든 사람은 명단에 없어도 들어간다.
        member_ids = {*body.member_ids, user.id}
        await _active_users(db, [uid for uid in member_ids if uid != user.id])
        channel = Channel(
            ws_id=ws_id, name=body.name, is_dm=False, is_private=True, created_by=user.id
        )
        db.add(channel)
        await db.flush()
        db.add_all([ChannelMember(channel_id=channel.id, user_id=uid) for uid in member_ids])
        audit.record(  # 이후 더하기·빼기와 같은 kind — 생성 시점 명단도 감사로 따라갈 수 있게
            db,
            "channels.members_changed",
            request=request,
            actor_id=user.id,
            target_id=channel.id,
            detail={"created": True, "added": sorted(str(uid) for uid in member_ids)},
        )
    else:
        assert body.name is not None
        # 친절한 409 — 경합은 uq_channels_public_name 이 막고 IntegrityError 핸들러가 409 로 돌려준다
        dup = await db.execute(
            select(Channel.id).where(
                Channel.is_dm.is_(False), Channel.is_private.is_(False), Channel.name == body.name
            )
        )
        if dup.first():
            raise ApiError(409, "CONFLICT", "같은 이름의 채널이 있습니다.")
        channel = Channel(ws_id=ws_id, name=body.name, is_dm=False, created_by=user.id)
        db.add(channel)
        await db.flush()
        # 비활성 계정도 넣는다 — 복직하면 그 사이 생긴 채널도 보여야 한다(seed·admin 과 같은 규칙)
        # ponytail: 계정 생성과 채널 생성이 정확히 겹치면 서로의 미커밋 행을 못 봐 한 명이 빠질 수 있다 —
        # 15명 사내에서 admin 계정 생성과 채널 생성이 같은 순간일 일은 없다. 생기면 seed.py 재실행이 메운다.
        member_ids = list((await db.execute(select(User.id))).scalars())
        db.add_all([ChannelMember(channel_id=channel.id, user_id=uid) for uid in member_ids])
    await db.commit()
    members = (await _members_of(db, [channel.id]))[channel.id]
    if channel.is_private:
        notify = [u.id for u in members]
    if notify:
        await _notify_channels(notify)
    return _channel_out(channel, members, user)


@router.patch(
    "/channels/{id}",
    response_model=ChannelOut,
    summary="채널 이름 바꾸기 {name} — 멤버면 누구나. DM 은 422, 같은 이름의 공개 채널은 409",
    responses={409: {"description": "CONFLICT — 같은 이름의 공개 채널(비공개는 중복 허용)"}},
)
async def rename_channel(
    id: uuid.UUID,
    body: ChannelPatchIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ChannelOut:
    await _lock_channel(
        db, id
    )  # 멤버 변경과 같은 이유 — 확인 뒤에 빠진 사람이 이름을 바꾸지 못하게
    await _require_member(db, request, user, id)
    channel = await db.get(Channel, id)
    assert channel is not None
    if channel.is_dm:
        raise ApiError(422, "VALIDATION", "DM 에는 이름이 없습니다.")
    members = (await _members_of(db, [id]))[id]
    if body.name == channel.name:
        return _channel_out(channel, members, user)  # 그대로면 감사도 이벤트도 없다
    if not channel.is_private:
        # 만들 때와 같은 친절한 409 — 경합은 uq_channels_public_name 이 막는다
        dup = await db.execute(
            select(Channel.id).where(
                Channel.is_dm.is_(False),
                Channel.is_private.is_(False),
                Channel.name == body.name,
                Channel.id != id,
            )
        )
        if dup.first():
            raise ApiError(409, "CONFLICT", "같은 이름의 채널이 있습니다.")
    audit.record(
        db,
        "channels.renamed",
        request=request,
        actor_id=user.id,
        target_id=id,
        detail={"from": channel.name, "to": body.name},
    )
    channel.name = body.name
    await db.commit()
    await _notify_channels([u.id for u in members])
    return _channel_out(channel, members, user)


@router.delete(
    "/channels/{id}",
    status_code=204,
    summary="채널 지우기 — 공개는 임원, 비공개는 연 사람(없으면 멤버인 임원). DM 은 422(숨기기로). 메시지·첨부·멘션 알림까지 지운다",
    response_class=Response,
)
async def delete_channel(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    # 멤버 변경·이름 바꾸기와 같은 이유 — 확인 뒤에 빠진 사람이 지우지 못하게
    await _lock_channel(db, id)
    await _require_member(db, request, user, id)  # 멤버 아님·없는 채널 → 같은 403(존재를 새지 않게)
    # 행 잠금 — 소켓 msg 는 채널 자문 잠금을 안 잡는다. 메시지를 지운 뒤 끼어든 INSERT 가 commit 되면 마지막
    # 채널 DELETE 가 FK 위반(500)이 된다. 행을 잠그면 그 INSERT 의 FK 확인이 여기 commit 까지 기다렸다가 실패한다
    channel = await db.get(Channel, id, with_for_update=True)
    assert channel is not None
    if channel.is_dm:
        raise ApiError(422, "VALIDATION", "DM 은 지우지 않고 숨깁니다.")
    members = (await _members_of(db, [id]))[id]
    if not _can_delete(channel, members, user):
        audit.record(  # 멤버지만 권한 없음 — 같은 403, 감사는 남긴다
            db,
            "acl.denied",
            request=request,
            actor_id=user.id,
            target_id=id,
            detail={"path": request.url.path, "reason": "delete"},
        )
        await db.commit()
        raise ApiError(403, "FORBIDDEN", "권한이 부족합니다.")
    message_count = await db.scalar(
        select(func.count()).select_from(Message).where(Message.channel_id == id)
    )
    # 행째 지운다(#349 — 되살리기 없음, 프론트 문구 「되돌릴 수 없습니다」). 멘션 알림도 같이(#284 와 같게 —
    # 남으면 눌러도 빈 화면). 첨부 오브젝트는 commit 뒤 best-effort.
    # ponytail: payload->>'channel_id' 조건이라 notifications 를 훑는다 — 쌓이면 식 인덱스(#284 와 같은 자리)
    await db.execute(
        delete(Notification).where(Notification.payload["channel_id"].astext == str(id))
    )
    await db.execute(delete(Message).where(Message.channel_id == id))
    await db.execute(delete(ChannelUpload).where(ChannelUpload.channel_id == id))
    await db.execute(delete(ChannelMember).where(ChannelMember.channel_id == id))
    audit.record(
        db,
        "channels.deleted",
        request=request,
        actor_id=user.id,
        target_id=id,
        detail={
            "name": channel.name,
            "is_private": channel.is_private,
            "members": sorted(str(u.id) for u in members),
            "messages": message_count,
        },
    )
    await db.delete(channel)
    await db.commit()
    await _notify_channels([u.id for u in members])  # 지우기 전 멤버 전원 — 사이드바에서 사라지게
    # commit 뒤의 정리 — 저장소가 죽어 있거나 설정이 깨져 있어도 지우기는 끝났다. 고아 오브젝트만 남는다(감사에 id).
    # ponytail: 오브젝트를 하나씩 지운다 — 첨부가 수천 개면 응답이 늦어진다. 느려지면 BackgroundTasks 로.
    try:
        await storage.remove_prefix(f"channels/{id}/")
    except Exception as e:  # noqa: BLE001
        log.warning("채널 %s 첨부 정리 실패: %s %s", id, type(e).__name__, e)
    return Response(status_code=204)


@router.post(
    "/channels/{id}/hide",
    status_code=204,
    summary="DM 을 내 목록에서 숨긴다 — 새 메시지가 오거나 같은 상대와 DM 을 다시 열면 돌아온다. 채널은 422",
    response_class=Response,
)
async def hide_channel(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await _require_member(db, request, user, id)
    channel = await db.get(Channel, id)
    assert channel is not None
    if not channel.is_dm:
        raise ApiError(422, "VALIDATION", "DM 만 숨길 수 있습니다.")
    # ponytail: 숨기기와 새 메시지가 정확히 겹치면(메시지 쪽이 먼저 커밋) 새 글이 있는데도 숨겨진 채 남는다 —
    # 다음 글이 오면 풀린다. 엄밀히 하려면 「last_read_at 이후 남의 글이 없을 때만」 조건을 건다.
    await db.execute(
        update(ChannelMember)
        .where(ChannelMember.channel_id == id, ChannelMember.user_id == user.id)
        .values(hidden_at=datetime.now(UTC))
    )
    await db.commit()
    await _notify_channels([user.id])  # 다른 탭의 목록도 맞춘다
    return Response(status_code=204)


async def _private_channel(
    db: AsyncSession, request: Request, user: User, channel_id: uuid.UUID
) -> Channel:
    """멤버 변경의 공통 앞부분: 채널 잠금 → 멤버 확인(403) → 비공개 채널만(422).

    잠금이 먼저다 — 확인 뒤에 잠그면 그 사이 빠진 사람의 요청이 통과한다(H1). 없는 채널 id 를 잠그는 것은
    무해하고, 403 경로의 commit 이 잠금도 풀어 준다."""
    await _lock_channel(db, channel_id)
    await _require_member(db, request, user, channel_id)
    channel = await db.get(Channel, channel_id)
    assert channel is not None  # 멤버 행이 있으면 채널도 있다(FK)
    if not channel.is_private:
        raise ApiError(422, "VALIDATION", "공개 채널은 전원, DM 은 두 사람으로 고정입니다.")
    return channel


@router.post(
    "/channels/{id}/members",
    response_model=ChannelOut,
    summary="비공개 채널에 사람 더하기 {user_ids} — 멤버면 누구나. 이미 멤버인 사람은 건너뛴다. 공개·DM 은 422",
)
async def add_members(
    id: uuid.UUID,
    body: MembersIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> ChannelOut:
    channel = await _private_channel(db, request, user, id)
    before = {u.id for u in (await _members_of(db, [id]))[id]}
    added = [u.id for u in await _active_users(db, list(set(body.user_ids))) if u.id not in before]
    if added:
        db.add_all([ChannelMember(channel_id=id, user_id=uid) for uid in added])
        audit.record(
            db,
            "channels.members_changed",
            request=request,
            actor_id=user.id,
            target_id=id,
            detail={"added": [str(uid) for uid in added]},
        )
    await db.commit()
    members = (await _members_of(db, [id]))[id]
    if added:
        await _notify_channels([u.id for u in members])
    return _channel_out(channel, members, user)


@router.delete(
    "/channels/{id}/members/{user_id}",
    status_code=204,
    summary="비공개 채널에서 사람 빼기 — 자기 자신이면 나가기. 연 사람은 본인만(남이 빼면 403). 멤버 아닌 사람 404, 공개·DM 은 422",
    response_class=Response,
)
async def remove_member(
    id: uuid.UUID,
    user_id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    channel = await _private_channel(db, request, user, id)
    row = await db.get(ChannelMember, (id, user_id))
    if row is None:
        raise ApiError(404, "NOT_FOUND", "이 채널의 멤버가 아닙니다.")
    if user_id == channel.created_by and user_id != user.id:
        # 연 사람은 본인만 나간다(#349 보안 리뷰) — 남이 빼면 「연 사람 우선」 지우기 판정이 임원 폴백으로 열린다.
        # 퇴사한 연 사람도 명단에서 못 뺀다(복직하면 권한이 돌아오게) — README 39
        raise ApiError(403, "FORBIDDEN", "채널을 연 사람은 본인만 나갈 수 있습니다.")
    before = [u.id for u in (await _members_of(db, [id]))[id]]
    await db.delete(row)
    # ponytail: 마지막 사람이 나가면 채널은 멤버 0 으로 남는다(아무에게도 안 보임, 메시지·첨부 보존) — 지우려면
    # 메시지·첨부까지 캐스케이드라 사람 확인이 먼저. 필요해지면 admin 정리 경로.
    audit.record(
        db,
        "channels.members_changed",
        request=request,
        actor_id=user.id,
        target_id=id,
        detail={"removed": [str(user_id)]},
    )
    await db.commit()
    await _notify_channels(before)  # 빠진 사람도 받아야 사이드바에서 채널이 사라진다
    return Response(status_code=204)


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
    summary="multipart `file` 업로드 → MinIO. 10MB 초과·빈 파일 422. {url, name, size, content_type} 을 msg op 의 attachments[] 에 그대로 넣는다",
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
    name = storage.safe_name(file.filename)
    file_id = uuid.uuid4()
    content_type = _normalize_content_type(file.content_type)
    await storage.put(attachment_key(id, file_id, name), data, content_type)
    db.add(  # 누가 올렸나 — 메시지에 싣는 url 은 올린 사람 본인 것만 받는다(#324, 게시글 #309 와 같다)
        ChannelUpload(
            file_id=file_id,
            channel_id=id,
            uploader_id=user.id,
            size=len(data),
            content_type=content_type,
        )
    )
    await db.commit()
    return AttachmentOut(
        url=attachment_url(id, file_id, name),
        name=name,
        size=len(data),
        content_type=content_type,
    )


@router.get(
    "/channels/{id}/attachments/{file_id}/{name}",
    summary="첨부 내려받기 — 채널 멤버만, 이 채널의 살아 있는 메시지에 실린 파일만(아니면 404). 이미지(png·jpeg·gif·webp)는 inline, 나머지는 attachment",
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
    # 이슈 #324: 지운 메시지의 파일은 주소를 알아도 못 받는다(게시글 #309 와 같다). 아직 안 보낸 파일도 404.
    # ponytail: idx_messages_channel 로 채널을 좁힌 뒤 JSONB @> 순차 — 느려지면 GIN(attachments jsonb_path_ops)
    carried = await db.scalar(
        select(Message.id)
        .where(
            Message.channel_id == id,
            Message.attachments.contains([{"url": attachment_url(id, file_id, name)}]),
        )
        .order_by(
            Message.created_at.desc()
        )  # 화면의 이미지는 대개 최근 것 — 인덱스를 최신부터 읽다 멈추게
        .limit(1)
    )
    found = await storage.get(attachment_key(id, file_id, name)) if carried else None
    if found is None:
        raise ApiError(404, "NOT_FOUND", "없는 첨부입니다.")
    return attachment_response(*found, name)


def attachment_response(data: bytes, content_type: str, name: str) -> Response:
    """첨부 내려받기 응답 — 채팅 첨부와 결재 첨부(approvals.py)가 같은 헤더로 내려간다."""
    disposition = "inline" if content_type in INLINE_TYPES else "attachment"
    return Response(
        data,
        media_type=content_type,
        headers={
            # RFC 6266 — 한글 파일명은 filename* 로. 브라우저에서 스크립트가 돌 수 있는 형식은 내려받기만.
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name, safe='')}",
            "X-Content-Type-Options": "nosniff",
            # 주소창에 직접 열어도 실행 없음 — files.py 와 같은 헤더. 첨부는 형식 제한도 매직바이트 검사도
            # 없어서(15(d)) 방어가 INLINE_TYPES 허용목록과 nosniff 뿐이었다. <img src> 표시에는 영향 없다.
            "Content-Security-Policy": "default-src 'none'; sandbox",
            # no-store (#324): 브라우저 캐시는 쿠키를 안 가려, 하루 캐시면 같은 브라우저의 다음 로그인 사용자가
            # 서버 판정 없이 열고, 메시지를 지운 뒤에도 캐시로 남는다. 인라인 이미지가 스크롤마다 MinIO 를 다시
            # 타는 비용은 15명 사내라 무시한다(결재 첨부도 같은 함수).
            "Cache-Control": "no-store",
        },
    )
