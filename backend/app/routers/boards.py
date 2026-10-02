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
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Query, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit, storage
from app.db import get_db
from app.deps import current_user
from app.errors import ApiError
from app.models import ROLE_RANK, Board, Notification, Post, PostComment, User
from app.paging import decode_cursor, encode_cursor
from app.prefs import wants
from app.realtime import chat
from app.routers.channels import (
    INLINE_TYPES,
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENTS,
    AttachmentOut,
    _normalize_content_type,
)

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
    attachments: list[AttachmentOut]  # 없으면 [] (#299)


Attachments = Annotated[list[AttachmentOut], Field(max_length=MAX_ATTACHMENTS)]


class PostCreateIn(BaseModel):
    title: Title
    body: Body
    attachments: Attachments | None = None  # POST /boards/{id}/attachments 의 응답 그대로


class PostPatchIn(BaseModel):
    title: Title | None = None
    body: Body | None = None
    attachments: Attachments | None = None  # 보낼 때는 전체 목록, 안 보내면 그대로, [] 는 전부 뗌


class Items[T](BaseModel):
    items: list[T]


CommentBody = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000)
]  # 문서 댓글과 같은 상한


class PostCommentOut(BaseModel):
    """문서 댓글(`CommentOut`)에서 블록 칸을 뺀 모양 (이슈 #292)."""

    id: uuid.UUID
    author: Person
    body: str
    created_at: datetime
    edited_at: datetime | None


class PostCommentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: CommentBody


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
    **extra: str,
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
            **extra,
        },
    )
    await db.commit()
    raise ApiError(403, "FORBIDDEN", "권한이 부족합니다.")


def _post_detail(post: Post, board: Board, author: User | None) -> PostDetail:
    return PostDetail(
        **_post_out(post, board, author, True).model_dump(),
        body=post.body,
        attachments=post.attachments or [],
    )


# ── 첨부 (이슈 #299, README 34) — 채팅 첨부(channels.py)와 같은 규약, 등급은 게시판으로 판정 ──


def _att_key(board_id: uuid.UUID, file_id: uuid.UUID, name: str) -> str:
    return f"boards/{board_id}/{file_id}/{name}"


def _att_url(board_id: uuid.UUID, file_id: uuid.UUID, name: str) -> str:
    return f"/api/boards/{board_id}/attachments/{file_id}/{quote(name, safe='')}"


def _parse_att_url(url: str, board_id: uuid.UUID) -> str | None:
    """이 게시판의 업로드 URL 이면 파일명, 아니면 None — 임원 게시판 파일 id 를 공지 글에 끼워 등급 밖에서 받는 길을 막는다."""
    prefix = f"/api/boards/{board_id}/attachments/"
    if not url.startswith(prefix) or any(c in url for c in "?#\\"):
        return None  # ?·# 는 브라우저가 떼어 내 칩의 이름과 실제로 받는 파일이 달라진다
    rest = url[len(prefix) :].split("/")
    if len(rest) != 2 or not rest[1]:
        return None
    try:
        uuid.UUID(rest[0])
    except ValueError:
        return None
    return unquote(rest[1])


def _checked_attachments(board: Board, items: list[AttachmentOut] | None) -> list[dict] | None:
    if items is None:
        return None
    if any(_parse_att_url(a.url, board.id) != a.name for a in items):
        raise ApiError(422, "VALIDATION", "이 게시판에 올린 첨부가 아닙니다.")
    return [a.model_dump() for a in items]


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
        board_id=board.id,
        title=body.title,
        body=body.body,
        author_id=user.id,
        attachments=_checked_attachments(board, body.attachments),
        created_at=now,
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
        if key == "attachments":
            value = _checked_attachments(board, body.attachments)  # [] 는 전부 뗀다
        setattr(post, key, value)
    if changes:
        await db.commit()
    return _post_detail(post, board, author)


@router.post(
    "/boards/{id}/attachments",
    status_code=201,
    response_model=AttachmentOut,
    summary="게시글 첨부 업로드 multipart `file` — 게시판을 읽을 수 있는 등급만. 10MB 초과·빈 파일 422. 응답을 글의 attachments[] 에 그대로 싣는다",
)
async def upload_board_attachment(
    id: uuid.UUID,
    file: UploadFile,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> AttachmentOut:
    board = await _get_board(db, id)
    if not _allowed(user, board):
        await _deny(db, request, user, board, "attach")
    # ponytail: 채팅 첨부와 같은 천장 — 쿼터·글에 안 실린 오브젝트 정리 없음(15명 사내)
    data = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise ApiError(422, "VALIDATION", "10MB 이하 파일만 올릴 수 있습니다.")
    if not data:
        raise ApiError(422, "VALIDATION", "빈 파일입니다.")
    name = storage.safe_name(file.filename)
    file_id = uuid.uuid4()
    content_type = _normalize_content_type(file.content_type)
    await storage.put(_att_key(board.id, file_id, name), data, content_type)
    return AttachmentOut(
        url=_att_url(board.id, file_id, name), name=name, size=len(data), content_type=content_type
    )


@router.get(
    "/boards/{id}/attachments/{file_id}/{name}",
    summary="게시글 첨부 내려받기 — 게시판을 읽을 수 있는 등급만. 이미지 넷은 inline, 나머지는 attachment",
    response_class=Response,
    responses={200: {"content": {"application/octet-stream": {}}}},
)
async def download_board_attachment(
    id: uuid.UUID,
    file_id: uuid.UUID,
    name: str,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    board = await _get_board(db, id)
    if not _allowed(user, board):
        await _deny(db, request, user, board, "attach")
    found = await storage.get(
        _att_key(board.id, file_id, name)
    )  # 키에 게시판 id — 다른 게시판 경로로는 404
    if found is None:
        raise ApiError(404, "NOT_FOUND", "없는 첨부입니다.")
    data, content_type = found
    disposition = "inline" if content_type in INLINE_TYPES else "attachment"
    return Response(  # 헤더는 채팅 첨부와 같다(channels.download_attachment)
        data,
        media_type=content_type,
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name, safe='')}",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "private, max-age=86400",
        },
    )


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
    # 댓글은 DB 가 같이 지운다(CASCADE) — 몇 개가 사라졌는지는 여기에만 남는다(#292)
    comments = await db.scalar(
        select(func.count()).select_from(PostComment).where(PostComment.post_id == post.id)
    )
    await db.delete(post)
    audit.record(  # docs.hard_deleted 와 같은 이유 — 누가 언제 무엇을 지웠는지는 남긴다
        db,
        "boards.post_deleted",
        request=request,
        actor_id=user.id,
        target_id=board.id,
        detail={"post_id": str(post.id), "title": post.title, "comment_count": comments},
    )
    await db.commit()
    return Response(status_code=204)


# ── 댓글 (이슈 #292, README 33) ────────────────────────────────────────


def _comment_out(c: PostComment, author: User) -> PostCommentOut:
    return PostCommentOut(
        id=c.id,
        author=Person.model_validate(author),
        body=c.body,
        created_at=c.created_at,
        edited_at=c.edited_at,
    )


async def _readable_post(
    db: AsyncSession, request: Request, user: User, post_id: uuid.UUID
) -> tuple[Post, Board]:
    """댓글의 열람·작성 권한은 글과 같다 — 판정은 늘 글의 지금 min_role 로(댓글에 등급을 복사하지 않는다)."""
    post, board, _author = await _get_post(db, post_id)
    if not _allowed(user, board):
        await _deny(db, request, user, board, "read", post)
    return post, board


async def _post_comment(
    db: AsyncSession, post: Post, comment_id: uuid.UUID, *, lock: bool = False
) -> PostComment:
    comment = await db.get(PostComment, comment_id, with_for_update=lock, populate_existing=lock)
    if comment is None or comment.post_id != post.id:
        raise ApiError(404, "NOT_FOUND", "없는 댓글입니다.")
    return comment


@router.get(
    "/posts/{id}/comments",
    response_model=Items[PostCommentOut],
    responses={403: {"description": "글을 못 보는 등급"}, 404: {"description": "없는 글"}},
    summary="댓글 목록 (오래된 순) — 글을 못 보는 사람은 403 + 감사",
)
async def list_post_comments(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Items[PostCommentOut]:
    post, _board = await _readable_post(db, request, user, id)
    rows = await db.execute(
        select(PostComment, User)
        .join(User, User.id == PostComment.author_id)
        .where(PostComment.post_id == post.id)
        .order_by(PostComment.created_at, PostComment.id)
        .limit(500)  # ponytail: 상한만 — 글 하나에 500개를 넘으면 커서
    )
    return Items(items=[_comment_out(c, a) for c, a in rows])


@router.post(
    "/posts/{id}/comments",
    status_code=201,
    response_model=PostCommentOut,
    responses={403: {"description": "글을 못 보는 등급"}, 404: {"description": "없는 글"}},
    summary="댓글 등록 {body} — 글을 읽을 수 있는 사람. @이름은 해석하지 않는다(등급 밖으로 새지 않게)",
)
async def create_post_comment(
    id: uuid.UUID,
    body: PostCommentIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> PostCommentOut:
    post, _board = await _readable_post(db, request, user, id)
    comment = PostComment(
        post_id=post.id, author_id=user.id, body=body.body, created_at=datetime.now(UTC)
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return _comment_out(comment, user)


@router.patch(
    "/posts/{id}/comments/{comment_id}",
    response_model=PostCommentOut,
    responses={
        403: {"description": "글을 못 보거나 남의 댓글"},
        404: {"description": "없는 글·댓글"},
    },
    summary="댓글 고치기 {body} — 쓴 사람만. 그대로면 edited_at 을 찍지 않는다",
)
async def edit_post_comment(
    id: uuid.UUID,
    comment_id: uuid.UUID,
    body: PostCommentIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> PostCommentOut:
    post, board = await _readable_post(db, request, user, id)
    comment = await _post_comment(db, post, comment_id, lock=True)
    if comment.author_id != user.id:
        await _deny(db, request, user, board, "comment_edit", post, comment_id=str(comment.id))
    if body.body == comment.body:
        return _comment_out(comment, user)
    audit.record(  # 이전 본문은 행에 안 남는다 — 문서 댓글(docs.comment_edited)과 같은 기준
        db,
        "boards.comment_edited",
        request=request,
        actor_id=user.id,
        target_id=board.id,
        detail={
            "post_id": str(post.id),
            "comment_id": str(comment.id),
            "before": comment.body[:120],
        },
    )
    comment.body = body.body
    comment.edited_at = datetime.now(UTC)
    await db.commit()
    return _comment_out(comment, user)


@router.delete(
    "/posts/{id}/comments/{comment_id}",
    status_code=204,
    responses={
        403: {"description": "글을 못 보거나, 쓴 사람·임원이 아님"},
        404: {"description": "없는 글·댓글"},
    },
    summary="댓글 삭제 — 쓴 사람 또는 exec(글 삭제와 같은 기준). 감사 boards.comment_deleted",
)
async def delete_post_comment(
    id: uuid.UUID,
    comment_id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    post, board = await _readable_post(db, request, user, id)
    comment = await _post_comment(db, post, comment_id, lock=True)
    if comment.author_id != user.id and user.role != "exec":
        await _deny(db, request, user, board, "comment_delete", post, comment_id=str(comment.id))
    audit.record(
        db,
        "boards.comment_deleted",
        request=request,
        actor_id=user.id,
        target_id=board.id,
        detail={
            "post_id": str(post.id),
            "comment_id": str(comment.id),
            "author_id": str(comment.author_id),  # 지운 사람과 다르면 임원이 남의 댓글을 지운 것
            "preview": comment.body[:120],
        },
    )
    await db.delete(comment)
    await db.commit()
    return Response(status_code=204)
