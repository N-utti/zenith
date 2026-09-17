"""04-API §6 게시판 — 등급별 열람(03 §2.2 min_role). 권한 밖은 목록에서 제목 마스킹, 본문은 403. UI 가 아니라 여기서 한다.

- 열람·작성 판정은 `ROLE_RANK[user.role] >= ROLE_RANK[board.min_role]` 하나(FR-BRD-01·02). 모르는 등급은 닫힌다.
- 목록(FR-BRD-03·TC-BRD-01)은 권한 밖 글을 지우지 않고 `title="＿＿＿＿＿ 보고", masked=true, author=null` 로 남긴다 —
  항목 모양은 §2 홈 공지 카드(me.py)와 같다. 본문(TC-BRD-02)·작성·수정·삭제 거부는 403 + 감사 `acl.denied`.
- 수정·삭제는 글쓴이 또는 exec. 삭제는 행을 지운다(게시글에 휴지통 없음 — 03).
- 새 글(FR-BRD-04)은 열람 가능한 등급의 활성 사용자에게 `notifications(kind=post)` + §4.1 `notice` 푸시. 글쓴이는 제외.
  알림 payload 의 제목은 만든 시점 값이라, 알림함(me.py)은 읽을 때 게시판 등급을 다시 판정해 권한 밖이면 가린다.

ponytail: posts 에 (board_id, created_at) 인덱스가 없다 — 03 §2.4 에도 없고 글 수백 건이라 순차 스캔. 느려지면 복합 인덱스.
"""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import ROLE_RANK, Board, Notification, Post, User
from app.paging import decode_cursor, encode_cursor
from app.prefs import wants
from app.realtime import chat

router = APIRouter(tags=["boards"], dependencies=[Depends(current_user)])

MASKED_TITLE = "＿＿＿＿＿ 보고"  # 04 §6 — me.py 와 같은 문자열
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)]


class Person(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class BoardOut(BaseModel):
    id: uuid.UUID
    name: str
    min_role: str
    allowed: bool  # 내 등급으로 열람·작성 가능한가 — "내 등급 표시"


class PostOut(BaseModel):
    id: uuid.UUID
    board_id: uuid.UUID
    board_name: str
    min_role: str
    title: str
    masked: bool
    author: Person | None
    created_at: datetime


class PostDetail(PostOut):
    body: str


class PostCreateIn(BaseModel):
    title: Title
    body: Body


class PostPatchIn(BaseModel):
    title: Title | None = None
    body: Body | None = None


class Items[T](BaseModel):
    items: list[T]


class PostPage(BaseModel):
    items: list[PostOut]  # 최신순
    next_cursor: str | None


def _allowed(user: User, board: Board) -> bool:
    return ROLE_RANK.get(user.role, 0) >= ROLE_RANK.get(board.min_role, 99)


def _post_out(post: Post, board: Board, author: User | None, allowed: bool) -> PostOut:
    return PostOut(
        id=post.id,
        board_id=board.id,
        board_name=board.name,
        min_role=board.min_role,
        title=post.title if allowed else MASKED_TITLE,
        masked=not allowed,
        author=Person.model_validate(author) if (author and allowed) else None,
        created_at=post.created_at,
    )


async def _deny(
    db: AsyncSession,
    request: Request,
    user: User,
    board: Board,
    why: str,
    post: Post | None = None,
) -> NoReturn:
    """403 + 감사. target_id 는 항상 게시판 — 글은 지워질 수 있어 detail 에 post_id 로 따로 남긴다."""
    audit.record(
        db,
        "acl.denied",
        request=request,
        actor_id=user.id,
        target_id=board.id,
        detail={
            "path": request.url.path,
            "reason": why,
            "min_role": board.min_role,
            "role": user.role,
            "post_id": str(post.id) if post else None,
        },
    )
    await db.commit()
    raise ApiError(403, "FORBIDDEN", "권한이 부족합니다.")


def _post_detail(post: Post, board: Board, author: User | None) -> PostDetail:
    return PostDetail(**_post_out(post, board, author, True).model_dump(), body=post.body)


async def _get_board(db: AsyncSession, board_id: uuid.UUID) -> Board:
    board = await db.get(Board, board_id)
    if board is None:
        raise ApiError(404, "NOT_FOUND", "없는 게시판입니다.")
    return board


async def _get_post(db: AsyncSession, post_id: uuid.UUID) -> tuple[Post, Board, User | None]:
    row = (
        await db.execute(
            select(Post, Board, User)
            .join(Board, Board.id == Post.board_id)
            .outerjoin(User, User.id == Post.author_id)
            .where(Post.id == post_id)
        )
    ).first()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "없는 글입니다.")
    return row


@router.get(
    "/boards", response_model=Items[BoardOut], summary="게시판 목록 — allowed 로 내 등급 표시"
)
async def list_boards(
    user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Items[BoardOut]:
    boards = (await db.execute(select(Board))).scalars()
    items = [
        BoardOut(id=b.id, name=b.name, min_role=b.min_role, allowed=_allowed(user, b))
        for b in boards
    ]
    items.sort(key=lambda b: (ROLE_RANK.get(b.min_role, 99), b.name))  # 전체 → 팀장↑ → 임원
    return Items(items=items)


@router.get(
    "/boards/{id}/posts",
    response_model=PostPage,
    summary="글 목록(최신순, 커서) — 권한 밖이면 {title:'＿＿＿＿＿ 보고', masked:true, author:null} (FR-BRD-03)",
)
async def list_posts(
    id: uuid.UUID,
    cursor: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> PostPage:
    board = await _get_board(db, id)
    allowed = _allowed(user, board)
    stmt = (
        select(Post, User)
        .outerjoin(User, User.id == Post.author_id)
        .where(Post.board_id == board.id)
        .order_by(Post.created_at.desc(), Post.id.desc())
        .limit(limit + 1)
    )
    if cursor:
        at, pid = decode_cursor(cursor)
        stmt = stmt.where(tuple_(Post.created_at, Post.id) < (at, pid))
    rows = (await db.execute(stmt)).all()
    more = len(rows) > limit
    rows = rows[:limit]
    return PostPage(
        items=[_post_out(p, board, a, allowed) for p, a in rows],
        next_cursor=encode_cursor(rows[-1][0].created_at, rows[-1][0].id) if more else None,
    )


@router.post(
    "/boards/{id}/posts",
    status_code=201,
    response_model=PostDetail,
    summary="글 작성 — min_role 이상(FR-BRD-02). 열람 가능한 등급에게 알림(FR-BRD-04)",
)
async def create_post(
    id: uuid.UUID,
    body: PostCreateIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> PostDetail:
    board = await _get_board(db, id)
    if not _allowed(user, board):
        await _deny(db, request, user, board, "write")
    now = datetime.now(UTC)  # 커서·알림 시각을 앱 시각으로 (03 §2.7)
    post = Post(
        board_id=board.id, title=body.title, body=body.body, author_id=user.id, created_at=now
    )
    db.add(post)
    await db.flush()
    # 새 공지 알림 — 열람 가능한 등급의 활성 사용자에게만(TC-BRD-04). 글쓴이 자신은 제외.
    readers = [role for role, r in ROLE_RANK.items() if r >= ROLE_RANK.get(board.min_role, 99)]
    targets = (
        await db.execute(
            select(User.id, User.preferences).where(
                User.active.is_(True), User.role.in_(readers), User.id != user.id
            )
        )
    ).all()
    notices = [
        Notification(
            user_id=uid,
            kind="post",
            created_at=now,
            payload={
                "post_id": str(post.id),
                "board_id": str(board.id),
                "board_name": board.name,
                "title": post.title,
                "from": {"id": str(user.id), "name": user.name},
            },
        )
        for uid, prefs in targets
        if wants(prefs, "post")
    ]
    db.add_all(notices)
    await db.commit()
    await asyncio.gather(*(chat.push_notice(n) for n in notices))
    return _post_detail(post, board, user)


@router.get(
    "/posts/{id}", response_model=PostDetail, summary="글 본문 — 권한 밖 403 + 감사 (TC-BRD-02)"
)
async def get_post(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> PostDetail:
    post, board, author = await _get_post(db, id)
    if not _allowed(user, board):
        await _deny(db, request, user, board, "read", post)
    return _post_detail(post, board, author)


def _can_edit(user: User, post: Post) -> bool:
    return post.author_id == user.id or user.role == "exec"


@router.patch("/posts/{id}", response_model=PostDetail, summary="글 수정 — 글쓴이 또는 exec")
async def update_post(
    id: uuid.UUID,
    body: PostPatchIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> PostDetail:
    post, board, author = await _get_post(db, id)
    if not _allowed(user, board):
        await _deny(db, request, user, board, "read", post)
    if not _can_edit(user, post):
        await _deny(db, request, user, board, "edit", post)
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        if value is None:  # me.py 의 todo PATCH 와 같은 계약 — null 은 "지움" 이 아니라 422
            raise ApiError(422, "VALIDATION", f"{key} 는 null 일 수 없습니다.")
        setattr(post, key, value)
    if changes:
        await db.commit()
    return _post_detail(post, board, author)


@router.delete("/posts/{id}", status_code=204, summary="글 삭제 — 글쓴이 또는 exec")
async def delete_post(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    post, board, _author = await _get_post(db, id)
    if not _allowed(user, board):
        await _deny(db, request, user, board, "read", post)
    if not _can_edit(user, post):
        await _deny(db, request, user, board, "delete", post)
    await db.delete(post)
    audit.record(  # docs.hard_deleted 와 같은 이유 — 누가 언제 무엇을 지웠는지는 남긴다
        db,
        "boards.post_deleted",
        request=request,
        actor_id=user.id,
        target_id=board.id,
        detail={"post_id": str(post.id), "title": post.title},
    )
    await db.commit()
    return Response(status_code=204)
