"""04-API §2 홈·개인 — 대시보드 집계 1콜, 오늘 할 일, 알림함.

05 SCR-01: 이어서 작업(최근 문서) · 멘션&댓글 피드 · 안 읽은 메시지(채널/DM 카운트) · 공지 3건(권한 밖은
서버 마스킹, FR-HOM-04) · 오늘 할 일. 근태는 홈에 노출하지 않는다(10 §10). 전부 로그인한 본인 것만.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, func, select, update
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
    Notification,
    Post,
    Todo,
    User,
)
from app.prefs import Preferences, PreferencesPatch, merged

router = APIRouter(tags=["me"], dependencies=[Depends(current_user)])

MASKED_TITLE = "＿＿＿＿＿ 보고"  # 04 §6 — 권한 밖 글은 제목부터 서버가 가린다
MENTION_KINDS = ("mention", "comment", "reply")  # 03 notifications.kind 중 홈 피드에 싣는 것
NonBlank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class Person(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class RecentDoc(BaseModel):
    id: uuid.UUID
    title: str
    path: list[str]  # 폴더 경로 — 05 SCR-01 카드의 "경로"
    updated_at: datetime
    updated_by: Person | None


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    payload: dict | None
    read_at: datetime | None
    created_at: datetime


class UnreadChannel(BaseModel):
    channel_id: uuid.UUID
    name: str
    is_dm: bool
    is_private: bool  # 화면이 `#` 대신 자물쇠를 그린다(#221)
    # DM 상대 — 아바타 색을 이름이 아니라 사람으로 정하려면 id 가 있어야 한다(홈·채팅이 같은 색).
    # 채널이면 null 이지만 키는 늘 있다(기본값을 두면 계약에서 선택 필드가 된다)
    peer_id: uuid.UUID | None
    count: int


class HomePost(BaseModel):
    id: uuid.UUID
    board_id: uuid.UUID
    board_name: str
    min_role: str
    title: str
    masked: bool
    author: Person | None
    created_at: datetime


class TodoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text: str
    done: bool
    created_at: datetime


class HomeOut(BaseModel):
    recent_docs: list[RecentDoc]
    mentions: list[NotificationOut]
    unread: list[UnreadChannel]
    posts: list[HomePost]
    todos: list[TodoOut]


class TodoCreateIn(BaseModel):
    text: NonBlank


class TodoPatchIn(BaseModel):
    text: NonBlank | None = None
    done: bool | None = None


class ReadIn(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


class Items[T](BaseModel):
    items: list[T]


# ── 집계 조각 ────────────────────────────────────────────────────────


async def _recent_docs(db: AsyncSession, user: User, limit: int) -> list[RecentDoc]:
    """이어서 작업(05 SCR-01) — 내가 마지막으로 손댄 문서. 하나도 없으면(신입) 전사 최근으로 채운다.

    ponytail: 문서에는 열람 등급이 없다(03 §2.2 등급은 게시판·RAG). 폴더 등급이 생기면 _posts 처럼 여기서도 거른다.
    """
    base = (
        select(Document, User)
        .options(*DOC_LIST_OPTS)
        .outerjoin(User, User.id == Document.updated_by)
        .where(Document.deleted_at.is_(None))
        .order_by(Document.updated_at.desc(), Document.id)
        .limit(limit)
    )
    docs = (await db.execute(base.where(Document.updated_by == user.id))).all()
    if not docs:
        docs = (await db.execute(base)).all()
    if not docs:
        return []
    # ponytail: 워크스페이스는 하나고 폴더는 몇십 개다 — 한 번 다 읽어 경로를 메모리에서 잇는다.
    folders = {f.id: f for f in (await db.execute(select(Folder))).scalars()}

    def path_of(folder_id: uuid.UUID) -> list[str]:
        names: list[str] = []
        cursor = folders.get(folder_id)
        for _ in range(64):  # 고리 방어
            if cursor is None:
                break
            names.append(cursor.title)
            cursor = folders.get(cursor.parent_id) if cursor.parent_id else None
        return names[::-1]

    return [
        RecentDoc(
            id=d.id,
            title=d.title,
            path=path_of(d.folder_id),
            updated_at=d.updated_at,
            updated_by=Person.model_validate(u) if u else None,
        )
        for d, u in docs
    ]


async def _unread_channels(db: AsyncSession, user: User) -> list[UnreadChannel]:
    """03 §2.3 — 내가 속한 채널에서 last_read_at 이후 메시지 수. 0인 채널은 싣지 않는다."""
    rows = await db.execute(
        select(Channel, func.count(Message.id))
        .join(ChannelMember, ChannelMember.channel_id == Channel.id)
        .join(
            Message,
            (Message.channel_id == Channel.id)
            & (Message.author_id != user.id)
            & (
                (ChannelMember.last_read_at.is_(None))
                | (Message.created_at > ChannelMember.last_read_at)
            ),
        )
        .where(ChannelMember.user_id == user.id, ChannelMember.hidden_at.is_(None))  # 목록과 같은 기준
        .group_by(Channel.id)
        .order_by(func.count(Message.id).desc(), Channel.id)
        .limit(20)  # 홈 카드는 상위 몇 개면 된다 — 전체 목록은 §5 /channels
    )
    channels = rows.all()
    dm_ids = [c.id for c, _ in channels if c.is_dm]
    peers: dict[uuid.UUID, tuple[uuid.UUID, str]] = {}
    if dm_ids:  # DM 은 상대 이름으로 — 한 번에 뽑는다. 3인 이상이면 이름순 첫 사람
        for channel_id, peer_id, name in await db.execute(
            select(ChannelMember.channel_id, User.id, User.name)
            .join(User, User.id == ChannelMember.user_id)
            .where(ChannelMember.channel_id.in_(dm_ids), User.id != user.id)
            .order_by(ChannelMember.channel_id, User.name)
        ):
            peers.setdefault(channel_id, (peer_id, name))
    out = []
    for c, count in channels:
        # 상대가 지워진 DM 이면 peers 에 없다 — 채널 이름으로 되돌아간다
        peer = peers.get(c.id) if c.is_dm else None
        out.append(
            UnreadChannel(
                channel_id=c.id,
                name=peer[1] if peer else c.name,
                is_dm=c.is_dm,
                is_private=c.is_private,
                peer_id=peer[0] if peer else None,
                count=count,
            )
        )
    return out


async def _posts(db: AsyncSession, user: User, limit: int) -> list[HomePost]:
    """최근 공지. 권한 밖이면 제목을 가리고 masked 를 세운다 — UI 가 아니라 API 가 가린다(FR-HOM-04·FR-BRD-03)."""
    rank = ROLE_RANK.get(user.role, 0)
    rows = await db.execute(
        select(Post, Board, User)
        .join(Board, Board.id == Post.board_id)
        .outerjoin(User, User.id == Post.author_id)
        .order_by(Post.created_at.desc(), Post.id.desc())  # 게시판 목록·커서와 같은 순서
        .limit(limit)
    )
    out: list[HomePost] = []
    for post, board, author in rows:
        allowed = rank >= ROLE_RANK.get(board.min_role, 99)
        out.append(
            HomePost(
                id=post.id,
                board_id=board.id,
                board_name=board.name,
                min_role=board.min_role,
                title=post.title if allowed else MASKED_TITLE,
                masked=not allowed,
                author=Person.model_validate(author) if (author and allowed) else None,
                created_at=post.created_at,
            )
        )
    return out


async def _todos(db: AsyncSession, user: User, limit: int) -> list[Todo]:
    return list(
        (
            await db.execute(
                select(Todo)
                .where(Todo.user_id == user.id)
                .order_by(Todo.created_at, Todo.id)
                .limit(limit)
            )
        ).scalars()
    )


# ── 엔드포인트 ───────────────────────────────────────────────────────


@router.get(
    "/me/home",
    response_model=HomeOut,
    summary="대시보드 집계 1콜 {recent_docs[], mentions[], unread[], posts[], todos[]} — posts 는 서버 마스킹",
)
async def home(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> HomeOut:
    mentions = (
        await db.execute(
            select(Notification)
            .where(Notification.user_id == user.id, Notification.kind.in_(MENTION_KINDS))
            .order_by(Notification.created_at.desc())
            .limit(10)
        )
    ).scalars()
    return HomeOut(
        recent_docs=await _recent_docs(db, user, 8),
        mentions=[NotificationOut.model_validate(n) for n in mentions],
        unread=await _unread_channels(db, user),
        posts=await _posts(db, user, 3),
        todos=[TodoOut.model_validate(t) for t in await _todos(db, user, 200)],  # 홈 1콜 상한
    )


@router.get("/me/todos", response_model=Items[TodoOut], summary="오늘 할 일 목록 (FR-HOM-05)")
async def list_todos(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Items[TodoOut]:
    # ponytail: 페이징 없음 — 개인 할 일이 1000개를 넘으면 그때 커서를 단다.
    return Items(items=[TodoOut.model_validate(t) for t in await _todos(db, user, 1000)])


@router.post("/me/todos", status_code=201, response_model=TodoOut, summary="할 일 추가 {text}")
async def create_todo(
    body: TodoCreateIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Todo:
    todo = Todo(user_id=user.id, text=body.text)
    db.add(todo)
    await db.commit()
    await db.refresh(todo)
    return todo


async def _own_todo(db: AsyncSession, user: User, todo_id: uuid.UUID) -> Todo:
    todo = await db.get(Todo, todo_id)
    if todo is None or todo.user_id != user.id:
        raise ApiError(404, "NOT_FOUND", "없는 할 일입니다.")  # 남의 것도 404 (TC-AUTH-04)
    return todo


@router.patch("/me/todos/{id}", response_model=TodoOut, summary="할 일 수정 {text?, done?}")
async def update_todo(
    id: uuid.UUID,
    body: TodoPatchIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Todo:
    todo = await _own_todo(db, user, id)
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return todo
    for key, value in changes.items():
        if value is None:
            raise ApiError(422, "VALIDATION", f"{key} 는 null 일 수 없습니다.")
        setattr(todo, key, value)
    await db.commit()
    await db.refresh(todo)
    return todo


@router.delete("/me/todos/{id}", status_code=204, summary="할 일 삭제")
async def delete_todo(
    id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Response:
    await db.delete(await _own_todo(db, user, id))
    await db.commit()
    return Response(status_code=204)


@router.get(
    "/me/notifications",
    response_model=Items[NotificationOut],
    summary="알림함 (FR-SHL-04) — ?unread=1 이면 안 읽은 것만, 최신순",
)
async def list_notifications(
    unread: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Items[NotificationOut]:
    stmt = (
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    )
    if unread:
        stmt = stmt.where(Notification.read_at.is_(None))
    rows = list((await db.execute(stmt)).scalars())
    items = [NotificationOut.model_validate(n) for n in rows]
    await _mask_post_notices(db, user, items)
    return Items(items=items)


async def _mask_post_notices(db: AsyncSession, user: User, rows: list[NotificationOut]) -> None:
    """kind=post 알림의 제목은 만든 시점 값이다 — 강등·게시판 등급 상향 뒤에도 읽히면 안 되므로 지금 등급으로
    다시 판정해 권한 밖(글이 지워진 것 포함)이면 제목을 가린다.

    ORM 행이 아니라 **응답 모델**을 바꾼다 — 세션에 붙은 Notification 을 고치면 이 라우트에 commit 이
    한 줄만 들어와도(감사·자동 읽음 처리 같은) 원본 제목·작성자가 DB 에서 지워진다."""
    post_ids: list[uuid.UUID] = []
    for n in rows:
        if n.kind == "post" and n.payload and n.payload.get("post_id"):
            try:
                post_ids.append(uuid.UUID(n.payload["post_id"]))
            except ValueError:
                pass
    if not post_ids:
        return
    min_roles = dict(
        (
            await db.execute(
                select(Post.id, Board.min_role)
                .join(Board, Board.id == Post.board_id)
                .where(Post.id.in_(post_ids))
            )
        ).all()
    )
    rank = ROLE_RANK.get(user.role, 0)
    for n in rows:
        if n.kind != "post" or not n.payload:
            continue
        try:
            pid = uuid.UUID(n.payload.get("post_id", ""))
        except ValueError:
            continue
        if rank < ROLE_RANK.get(min_roles.get(pid, "?"), 99):
            # 작성자도 지운다 — 목록(_post_out)이 마스킹할 때 author=None 을 주는 것과 같은 기준이다.
            # 제목만 가리면 "누가 임원 게시판에 글을 썼는지" 가 알림함으로 샌다.
            n.payload = {**n.payload, "title": MASKED_TITLE, "masked": True, "from": None}


@router.post(
    "/me/notifications/read",
    status_code=204,
    summary="읽음 처리 {ids[]} — 내 알림만, 이미 읽은 것은 그대로",
)
async def read_notifications(
    body: ReadIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Response:
    await db.execute(
        update(Notification)
        .where(
            Notification.user_id == user.id,
            Notification.id.in_(body.ids),
            Notification.read_at.is_(None),
        )
        .values(read_at=datetime.now(UTC))
    )
    await db.commit()
    return Response(status_code=204)


@router.post(
    "/me/notifications/delete",
    status_code=204,
    summary="알림 지우기 {ids[]} — 내 알림만, 남의 것·없는 id 는 건너뛴다 (04 밖, 이슈 #269)",
)
async def delete_notifications(
    body: ReadIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Response:
    # 읽음 처리와 같은 태도 — 두 번 보내도 결과가 같다. 행을 지운다(내 것이라 감사 없음).
    await db.execute(
        delete(Notification).where(Notification.user_id == user.id, Notification.id.in_(body.ids))
    )
    await db.commit()
    return Response(status_code=204)


@router.get(
    "/me/preferences",
    response_model=Preferences,
    summary="내 환경설정 — 알림 종류별 수신·시작 화면 (04 밖, 이슈 #81)",
)
async def get_preferences(user: User = Depends(current_user)) -> Preferences:
    return merged(user.preferences)


@router.patch(
    "/me/preferences",
    response_model=Preferences,
    summary="환경설정 부분 갱신 — 준 것만 덮어쓰고 전체를 돌려준다. 모르는 값은 422",
)
async def update_preferences(
    body: PreferencesPatch,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Preferences:
    # ponytail: 읽어서 합치고 JSONB 를 통째로 쓴다 — 같은 사람이 탭 두 개로 동시에 고치면 나중 것이 이긴다.
    # 본인만 본인 것을 고치는 화면이라 감수한다. 걸리면 select(...).with_for_update() 로 줄을 세운다.
    now = merged(user.preferences).model_dump()
    if body.notifications is not None:
        now["notifications"].update(body.notifications.model_dump(exclude_unset=True))
    if body.start_page:
        now["start_page"] = body.start_page
    await db.execute(update(User).where(User.id == user.id).values(preferences=now))
    await db.commit()
    return Preferences.model_validate(now)
