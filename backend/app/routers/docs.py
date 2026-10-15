"""04-API §3 문서 트리·문서. 실시간(§4 /ws, /yjs)은 WebSocket이라 여기 없다 — README 참조.

본문의 원천은 Y.Doc 이다(03 §2.1, frontend/README "문서 본문은 서버에 없다"). 여기서는 트리·메타·버전
표식·댓글만 다루고, `documents.ydoc_snapshot` 은 /yjs 릴레이가 쓴다. 문서에는 열람 등급이 없다 —
로그인한 사람은 모두 읽고 쓴다(03 §2.2 의 등급은 게시판·RAG 에만 있다). 영구 삭제만 exec.
"""

import asyncio
import base64
import binascii
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from app import acl, audit
from app.ai import embed
from app.db import get_db, session_scope
from app.deps import current_user
from app.errors import ApiError
from app.models import (
    DOC_LIST_OPTS,
    ROLE_RANK,
    DocChunk,
    DocComment,
    Document,
    DocVersion,
    Folder,
    FolderMember,
    Message,
    Notification,
    StoredFile,
    User,
    Workspace,
)
from app.prefs import wants
from app.realtime import chat, yjs

router = APIRouter(tags=["docs"], dependencies=[Depends(current_user)])
log = logging.getLogger("zenith.docs")

# 같은 사람이 이어서 편집하는 동안의 무명 스냅샷은 하나로 접는다(frontend/README "버전 기록").
VERSION_COALESCE = timedelta(minutes=3)
# 휴지통 보관 기간(04 §3 DELETE). 지나면 purge_loop 가 영구 삭제한다.
TRASH_RETENTION = timedelta(days=30)
PURGE_INTERVAL_SECONDS = 3600
# 공백만 있는 제목·본문·라벨은 422. 앞뒤 공백은 잘라 저장한다.
NonBlank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000)]
# Yjs 스냅샷은 시점 표식이라 작다(수 KB). base64 8MB ≈ 원본 6MB — 이 위는 스냅샷이 아니다.
SnapshotB64 = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8_000_000)
]
BlockId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


# ── 스키마 ──────────────────────────────────────────────────────────


class Person(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


MinRole = Literal["member", "lead", "exec"]


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    parent_id: uuid.UUID | None
    title: str
    sort: int
    # 열람 권한(README 57) — 트리는 내가 볼 수 있는 폴더만 주므로 이 두 칸은 표시·설정용(자물쇠 아이콘·설정 화면)
    min_role: MinRole
    allowed_users: list[
        uuid.UUID
    ]  # 등급과 무관하게 여는 사람들(임원만 바꾼다). 보는 사람 누구나 본다(15명 사내)


class FolderCreateIn(BaseModel):
    title: NonBlank
    parent_id: uuid.UUID | None = None
    sort: int = 0
    min_role: MinRole = "member"  # 기본값이 아니면 임원만(403)
    allowed_users: list[uuid.UUID] = Field(default_factory=list, max_length=200)


class FolderPatchIn(BaseModel):
    title: NonBlank | None = None
    parent_id: uuid.UUID | None = None
    sort: int | None = None
    min_role: MinRole | None = None  # 임원만
    allowed_users: list[uuid.UUID] | None = Field(None, max_length=200)  # 전체 교체, 임원만


class DocOut(BaseModel):
    id: uuid.UUID
    folder_id: uuid.UUID
    title: str
    updated_at: datetime
    updated_by: Person | None
    deleted_at: datetime | None
    ai_source: bool  # AI 어시스턴트가 이 문서를 근거로 써도 되는가 (README 43)


class DocDetail(DocOut):
    # 서버가 보관한 Yjs 상태(base64). /yjs 릴레이가 영속화하기 전까지는 null 이다.
    ydoc: str | None


class DocCreateIn(BaseModel):
    """04 의 `blocks?`(AI 템플릿 저장)는 받지 않는다 — AI 보류(2026-09-07). 본문은 Y.Doc 으로 들어온다."""

    folder_id: uuid.UUID
    title: NonBlank
    # AI 답변을 「문서로 저장」할 때 프론트가 false 로 보낸다(자기 생성물 순환 방지)
    ai_source: bool = True


class DocPatchIn(BaseModel):
    title: NonBlank | None = None
    folder_id: uuid.UUID | None = None
    ai_source: bool | None = None


class TreeOut(BaseModel):
    folders: list[FolderOut]
    docs: list[DocOut]


class VersionMeta(BaseModel):
    id: uuid.UUID
    created_at: datetime
    author: Person | None
    label: str | None


class VersionOut(VersionMeta):
    snapshot: (
        str  # base64 — 목록에는 싣지 않는다. 버전이 쌓인 문서에서 목록 한 번이 수십 MB 가 된다
    )


class VersionCreateIn(BaseModel):
    snapshot: SnapshotB64
    label: NonBlank | None = None


class RestoreIn(BaseModel):
    version_id: uuid.UUID


class CommentOut(BaseModel):
    id: uuid.UUID
    block_id: str | None
    author: Person
    body: str
    created_at: datetime
    edited_at: datetime | None  # 고친 적 없으면 null (#274)


class CommentCreateIn(BaseModel):
    block_id: BlockId | None = None
    body: LongText


class CommentPatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")  # block_id 는 못 바꾼다

    body: LongText


class Items[T](BaseModel):
    items: list[T]


# ── 헬퍼 ────────────────────────────────────────────────────────────


def _now() -> datetime:
    return datetime.now(UTC)


def _b64(data: bytes | None) -> str | None:
    return base64.b64encode(data).decode() if data is not None else None


def _unb64(value: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as e:
        raise ApiError(422, "VALIDATION", "snapshot 은 base64 여야 합니다.") from e


def _doc_out(doc: Document, editor: User | None) -> DocOut:
    return DocOut(
        id=doc.id,
        folder_id=doc.folder_id,
        title=doc.title,
        updated_at=doc.updated_at,
        updated_by=Person.model_validate(editor) if editor else None,
        deleted_at=doc.deleted_at,
        ai_source=doc.ai_source,
    )


async def _get_doc(
    db: AsyncSession,
    doc_id: uuid.UUID,
    *,
    user: User | None = None,
    trashed_ok: bool = False,
    body: bool = False,
    lock: bool = False,
) -> Document:
    # 본문(Y.Doc)을 쓰는 곳은 상세 하나다. 나머지(수정·삭제·버전·댓글)는 있는지와 휴지통 여부만 본다.
    # populate_existing: 같은 세션이 목록에서 본문 없이 읽어 둔 행이 있어도 다시 읽는다(테스트는 세션을 공유한다).
    # lock: 휴지통 여부를 보고 바로 결정하는 곳(영구 삭제·되돌리기)은 행을 잠가 둘이 겹치지 않게 한다(#278).
    doc = await db.get(
        Document,
        doc_id,
        options=() if body else DOC_LIST_OPTS,
        populate_existing=body or lock,
        with_for_update=lock,
    )
    if doc is None or (doc.deleted_at is not None and not trashed_ok):
        raise ApiError(404, "NOT_FOUND", "없는 문서입니다.")
    if user is not None:  # 폴더 열람 권한(README 57) — 못 보는 폴더의 문서는 403 + acl.denied
        await acl.require_doc_view(db, user, doc, "docs")
    return doc


async def _require_folder(
    db: AsyncSession, folder_id: uuid.UUID, user: User | None = None
) -> Folder:
    # 외래키 위반을 commit 에서 맞으면 409 로 떨어진다. 미리 확인해 422 로 돌려준다.
    # 못 보는 폴더도 「없는 폴더」 — 존재 여부를 새게 하지 않는다(README 57)
    folder = await db.get(Folder, folder_id)
    if folder is None or (user is not None and not await acl.can_view_folder(db, user, folder_id)):
        raise ApiError(422, "VALIDATION", "없는 폴더입니다.")
    return folder


async def _folder_out(db: AsyncSession, folders: list[Folder]) -> list[FolderOut]:
    ids = [f.id for f in folders]
    members: dict[uuid.UUID, list[uuid.UUID]] = {}
    if ids:
        for fid, uid in await db.execute(
            select(FolderMember.folder_id, FolderMember.user_id).where(
                FolderMember.folder_id.in_(ids)
            )
        ):
            members.setdefault(fid, []).append(uid)
    return [
        FolderOut(
            id=f.id,
            parent_id=f.parent_id,
            title=f.title,
            sort=f.sort,
            min_role=f.min_role,
            allowed_users=sorted(members.get(f.id, []), key=str),  # 응답 순서를 일정하게
        )
        for f in folders
    ]


async def _set_members(db: AsyncSession, folder: Folder, user_ids: list[uuid.UUID]) -> None:
    wanted = set(user_ids)
    if wanted:
        found = set(await db.scalars(select(User.id).where(User.id.in_(wanted))))
        if found != wanted:
            raise ApiError(422, "VALIDATION", "없는 사용자가 있습니다.")
    await db.execute(delete(FolderMember).where(FolderMember.folder_id == folder.id))
    db.add_all([FolderMember(folder_id=folder.id, user_id=uid) for uid in wanted])


async def _assert_no_cycle(db: AsyncSession, folder_id: uuid.UUID, new_parent: uuid.UUID) -> None:
    """new_parent 의 조상에 folder_id 가 있으면 순환이다. 깊이는 작아 한 칸씩 올라간다."""
    cursor: uuid.UUID | None = new_parent
    # ponytail: 깊이 상한이 순환 방어를 겸한다 — 동시 이동 두 건이 서로를 부모로 삼아 이미 고리가 생긴
    # 경우에도 무한 루프 대신 422 로 끝난다. 15명 위키에서 폴더 64단은 나올 수 없다.
    for _ in range(64):
        if cursor is None:
            return
        if cursor == folder_id:
            raise ApiError(422, "VALIDATION", "폴더를 자기 자신이나 하위 폴더로 옮길 수 없습니다.")
        cursor = (await db.execute(select(Folder.parent_id).where(Folder.id == cursor))).scalar()
    raise ApiError(422, "VALIDATION", "폴더가 너무 깊거나 상위 폴더에 고리가 있습니다.")


def _version_out(version: DocVersion, author: User | None) -> VersionOut:
    return VersionOut(
        id=version.id,
        created_at=version.created_at,
        author=Person.model_validate(author) if author else None,
        label=version.label,
        snapshot=_b64(version.snapshot) or "",
    )


# ── 트리·폴더 ───────────────────────────────────────────────────────


@router.get(
    "/tree", response_model=TreeOut, summary="사이드바 트리 {folders[], docs[]} (정렬 포함)"
)
async def tree(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> TreeOut:
    visible = acl.visible_folder_ids(user)  # 못 보는 폴더는 문서째 빠진다(README 57)
    folders = list(
        (
            await db.execute(
                select(Folder)
                .where(Folder.id.in_(visible))
                .order_by(Folder.parent_id.nulls_first(), Folder.sort, Folder.title)
            )
        ).scalars()
    )
    rows = await db.execute(
        select(Document, User)
        .options(*DOC_LIST_OPTS)
        .outerjoin(User, User.id == Document.updated_by)
        .where(Document.deleted_at.is_(None), Document.folder_id.in_(visible))
        .order_by(Document.title, Document.id)  # folder_id 는 무작위 UUID 라 정렬 기준이 못 된다
    )
    return TreeOut(
        folders=await _folder_out(db, folders),
        docs=[_doc_out(doc, editor) for doc, editor in rows],
    )


# `/tree` 가 휴지통을 빼므로 되돌리려면 이 목록이 있어야 한다(문서 주소를 외우고 있지 않는 한).
# ponytail: 커서 페이징 없이 상한만 둔다 — 30일이 지나면 스스로 비고, 15명이 그 안에 500개를 지우면
# 그때 `/admin/audit` 과 같은 커서를 붙인다.
@router.get(
    "/trash",
    response_model=Items[DocOut],
    summary="휴지통 목록 — `/tree` 의 여집합, 지운 지 최근 순. 30일이 지나면 서버가 영구 삭제한다",
)
async def list_trash(
    limit: int = Query(200, ge=1, le=500),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Items[DocOut]:
    rows = await db.execute(
        select(Document, User)
        .options(*DOC_LIST_OPTS)
        .outerjoin(User, User.id == Document.updated_by)
        .where(
            Document.deleted_at.is_not(None), Document.folder_id.in_(acl.visible_folder_ids(user))
        )
        .order_by(Document.deleted_at.desc(), Document.id)
        .limit(limit)
    )
    return Items(items=[_doc_out(doc, editor) for doc, editor in rows])


@router.post("/folders", status_code=201, response_model=FolderOut, summary="폴더 생성")
async def create_folder(
    body: FolderCreateIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> FolderOut:
    # ponytail: 워크스페이스는 하나다(03 §2.5 시드). 여러 개가 되면 요청에서 받는다.
    ws_id = (await db.execute(select(Workspace.id).limit(1))).scalar()
    if ws_id is None:
        raise ApiError(
            409, "CONFLICT", "워크스페이스가 없습니다. scripts/seed.py 를 먼저 돌리세요."
        )
    if body.min_role != "member" or body.allowed_users:
        acl.require_acl_editor(user)  # 등급·사람 지정은 임원만(README 57) — 다른 검사보다 먼저
    if body.parent_id is not None:
        await _require_folder(db, body.parent_id, user)
    folder = Folder(
        ws_id=ws_id,
        parent_id=body.parent_id,
        title=body.title,
        sort=body.sort,
        min_role=body.min_role,
    )
    db.add(folder)
    await db.flush()
    await _set_members(db, folder, body.allowed_users)
    await db.commit()
    await db.refresh(folder)
    return (await _folder_out(db, [folder]))[0]


@router.patch("/folders/{id}", response_model=FolderOut, summary="폴더 이름·이동·정렬")
async def update_folder(
    id: uuid.UUID,
    body: FolderPatchIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> FolderOut:
    folder = await db.get(Folder, id)
    if folder is None or not await acl.can_view_folder(
        db, user, id
    ):  # 못 보는 폴더는 「없는 폴더」
        raise ApiError(404, "NOT_FOUND", "없는 폴더입니다.")
    changes = body.model_dump(exclude_unset=True)
    allowed = changes.pop("allowed_users", "unset")
    if "min_role" in changes or allowed != "unset":
        acl.require_acl_editor(user)  # 등급·사람 지정은 임원만(README 57) — 다른 검사보다 먼저
    if allowed is None:
        raise ApiError(422, "VALIDATION", "allowed_users 는 null 일 수 없습니다.")
    if "parent_id" in changes:
        # 이동은 등급을 바꾸는 것과 같다(등급 폴더에서 꺼내면 공개, 넣으면 숨김) — 어느 쪽이든 「전원 열람」이 아니면 임원만
        if await acl.is_restricted(db, folder.id) or (
            changes["parent_id"] is not None and await acl.is_restricted(db, changes["parent_id"])
        ):
            acl.require_acl_editor(user)
        if changes["parent_id"] is not None:
            await _require_folder(db, changes["parent_id"], user)
            await _assert_no_cycle(db, folder.id, changes["parent_id"])
    for key, value in changes.items():
        if value is None and key != "parent_id":  # NOT NULL 컬럼 — DB 409 대신 422
            raise ApiError(422, "VALIDATION", f"{key} 는 null 일 수 없습니다.")
        setattr(folder, key, value)
    if allowed != "unset":
        await _set_members(db, folder, allowed)
    await db.commit()
    await db.refresh(folder)
    return (await _folder_out(db, [folder]))[0]


@router.delete(
    "/folders/{id}",
    status_code=204,
    responses={
        409: {"description": "FOLDER_NOT_EMPTY — 하위 폴더·문서(휴지통 포함)가 있다 (이슈 #271)"}
    },
    summary="빈 폴더 삭제 — 하위 폴더·살아 있는 문서·휴지통 문서가 하나라도 있으면 409",
)
async def delete_folder(
    id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if not await acl.can_view_folder(db, user, id):  # 못 보는 폴더는 「없는 폴더」(README 57)
        raise ApiError(404, "NOT_FOUND", "없는 폴더입니다.")
    # 행 잠금 — 같은 폴더를 두 탭에서 동시에 지우면 둘 다 204 에 감사가 두 건 남던 것(늦은 쪽은 None → 404)
    folder = await db.get(Folder, id, with_for_update=True, populate_existing=True)
    if folder is None:
        raise ApiError(404, "NOT_FOUND", "없는 폴더입니다.")
    # 문서는 폴더 안에만 있을 수 있어(DocCreateIn.folder_id 필수) 휴지통 문서가 남은 폴더를 지우면 되살릴 자리가
    # 없다 — 휴지통 문서도 막는다. 트리에 안 보여 화면이 미리 못 막는 경우라 문구를 따로 둔다.
    if (await db.execute(select(Folder.id).where(Folder.parent_id == id).limit(1))).first():
        raise ApiError(409, "FOLDER_NOT_EMPTY", "하위 폴더가 있어 지울 수 없습니다.")
    # 살아 있는 문서가 하나라도 있으면 그 문구 — 휴지통 문구를 따라 해도 살아 있는 문서가 남아 또 409 가 되지 않게
    trashed = (
        await db.execute(
            select(Document.deleted_at)
            .where(Document.folder_id == id)
            .order_by(Document.deleted_at.nulls_first())
            .limit(1)
        )
    ).first()
    if trashed is not None:
        if trashed[0] is None:
            raise ApiError(409, "FOLDER_NOT_EMPTY", "문서가 있어 지울 수 없습니다.")
        raise ApiError(
            409,
            "FOLDER_NOT_EMPTY",
            "휴지통에 이 폴더의 문서가 남아 있어 지울 수 없습니다. 되살려 옮기거나 영구 삭제한 뒤 지워 주세요.",
        )
    # ponytail: 확인과 삭제 사이에 누가 이 폴더에 문서를 만들면 외래키 위반 → 409(IntegrityError 핸들러). 잠금 없음.
    audit.record(
        db,
        "docs.folder_deleted",
        request=request,
        actor_id=user.id,
        target_id=folder.id,
        detail={
            "title": folder.title,
            "parent_id": str(folder.parent_id) if folder.parent_id else None,
        },
    )
    await db.delete(folder)
    await db.commit()
    return Response(status_code=204)


# ── 문서 ────────────────────────────────────────────────────────────


@router.post(
    "/docs", status_code=201, response_model=DocOut, summary="{folder_id, title} → 문서 생성"
)
async def create_doc(
    body: DocCreateIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> DocOut:
    await _require_folder(db, body.folder_id, user)
    doc = Document(
        folder_id=body.folder_id, title=body.title, updated_by=user.id, ai_source=body.ai_source
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return _doc_out(doc, user)


@router.get(
    "/docs/{id}", response_model=DocDetail, summary="메타 + 서버 보관 Yjs 상태 (초기 로드용)"
)
async def get_doc(
    id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> DocDetail:
    # 휴지통에 있는 문서도 연다 — 복구하려면 열 수 있어야 한다. 트리에서만 빠진다.
    doc = await _get_doc(db, id, user=user, trashed_ok=True, body=True)
    editor = await db.get(User, doc.updated_by) if doc.updated_by else None
    return DocDetail(**_doc_out(doc, editor).model_dump(), ydoc=_b64(doc.ydoc_snapshot))


@router.patch(
    "/docs/{id}",
    response_model=DocOut,
    summary="제목·폴더 이동·ai_source (목록용 투영 — 본문 원천은 Y.Doc)",
)
async def update_doc(
    id: uuid.UUID,
    body: DocPatchIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> DocOut:
    doc = await _get_doc(db, id, user=user)
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        editor = await db.get(User, doc.updated_by) if doc.updated_by else None
        return _doc_out(doc, editor)  # 빈 본문으로 "이어서 작업" 순서를 흔들지 않는다
    if changes.get("folder_id") is not None:
        await _require_folder(db, changes["folder_id"], user)
        # 이동은 등급을 바꾸는 것과 같다 — 원래 폴더나 대상 폴더가 「전원 열람」이 아니면 임원만(README 57)
        if await acl.is_restricted(db, doc.folder_id) or await acl.is_restricted(
            db, changes["folder_id"]
        ):
            acl.require_acl_editor(user)
    for key, value in changes.items():
        if value is None:
            raise ApiError(422, "VALIDATION", f"{key} 는 null 일 수 없습니다.")
        setattr(doc, key, value)
    if changes.keys() - {"ai_source"}:
        doc.updated_by = user.id
        doc.updated_at = (
            _now()
        )  # 제목만 바뀌어도 "이어서 작업" 순서에 잡히게. 스위치만은 내용 변경이 아니다
    if "ai_source" in changes:
        # 「AI 에 보내지 않을 문서」를 누가 다시 켰는지 추적할 수 있게(문서는 권한 구분이 없어 누구나 토글한다)
        audit.record(
            db,
            "docs.ai_source",
            request=request,
            actor_id=user.id,
            target_id=doc.id,
            detail={"ai_source": changes["ai_source"]},
        )
    await db.commit()
    await db.refresh(doc)
    editor = (
        await db.get(User, doc.updated_by) if doc.updated_by else None
    )  # 스위치만 바꿨으면 요청자가 아니다
    return _doc_out(doc, editor)


@router.delete(
    "/docs/{id}",
    status_code=204,
    summary="휴지통 이동(30일) / ?hard=1 은 exec 만, 휴지통에 든 문서만 — 버전·댓글·색인까지 지운다",
    responses={409: {"description": "NOT_TRASHED — hard=1 인데 휴지통에 없는 문서(이슈 #278)"}},
)
async def delete_doc(
    id: uuid.UUID,
    request: Request,
    hard: bool = Query(False),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    doc = await _get_doc(db, id, user=user, trashed_ok=True, lock=hard)
    if not hard:
        if doc.deleted_at is None:
            doc.deleted_at = _now()
            doc.updated_by = user.id  # 누가 휴지통에 넣었나. 30일 뒤 purge_trash 가 지운다
            await db.commit()
            # 열려 있던 편집 방을 걷는다 — 안 걷으면 30초마다 도는 저장이 updated_by("지운 사람")·제목·
            # 스냅샷을 편집자 것으로 덮어쓴다. 휴지통 문서는 새로 열 수도 없으니(yjs 핸드셰이크) 방만 남는다.
            await yjs.close_room(doc.id)
        return Response(status_code=204)
    if ROLE_RANK.get(user.role, 0) < ROLE_RANK["exec"]:
        audit.record(
            db,
            "acl.denied",
            request=request,
            actor_id=user.id,
            target_id=doc.id,
            detail={"path": request.url.path, "min_role": "exec"},
        )
        await db.commit()
        # 등급 이름은 화면 표기대로 — 프론트가 서버 문구를 그대로 띄운다(exec = "임원")
        raise ApiError(403, "FORBIDDEN", "영구 삭제는 임원만 할 수 있습니다.")
    if doc.deleted_at is None:
        # 휴지통 화면이 확인 창을 띄운 사이 누가 되돌렸으면 방금 살린 문서가 사라진다(#278) — 서버가 막는다.
        # 행을 잠그고 봤으므로 이 판정과 _purge 사이에 되돌리기가 끼지 못한다(되돌리기도 같은 잠금을 기다린다)
        raise ApiError(409, "NOT_TRASHED", "휴지통에 있는 문서만 영구 삭제할 수 있습니다.")
    await _purge(db, doc)
    audit.record(
        db,
        "docs.hard_deleted",
        request=request,
        actor_id=user.id,
        target_id=doc.id,
        detail={"title": doc.title},
    )
    await db.commit()
    return Response(status_code=204)


async def _purge(db: AsyncSession, doc: Document) -> None:
    """버전·댓글·색인까지 지우고 채팅 문서 카드·파일 기록부는 참조만 푼다. 감사 기록·commit 은 호출한 쪽이.
    documents 를 참조하는 테이블이 늘면 여기와 test_hard_delete_cascades 를 같이 고친다."""
    for model in (DocVersion, DocComment, DocChunk):
        await db.execute(delete(model).where(model.doc_id == doc.id))
    await db.execute(update(Message).where(Message.doc_ref == doc.id).values(doc_ref=None))
    # 파일(README 16(h))은 오브젝트가 남으니 행도 남기고 출처만 푼다 — 자료실(#226)에서 빠진다
    await db.execute(update(StoredFile).where(StoredFile.doc_id == doc.id).values(doc_id=None))
    await db.delete(doc)
    await yjs.close_room(doc.id)  # 접속 중인 편집자는 4404 로 끊는다


async def purge_trash(db: AsyncSession, *, now: datetime | None = None) -> int:
    """휴지통에 TRASH_RETENTION 넘게 있던 문서를 영구 삭제한다(04 §3 DELETE "휴지통 이동(30일)").
    exec 의 ?hard=1 과 같은 캐스케이드, 감사는 actor 없는 `docs.purged`. 지운 수를 돌려준다.
    ponytail: SELECT 와 commit 사이에 untrash 되면 그 문서도 지워진다 — 창은 배치 한 번 길이, 15명 규모에서 감수."""
    cutoff = (now or _now()) - TRASH_RETENTION
    # 지우는 데 본문은 필요 없다. 없으면 30일치 Y.Doc 이 한꺼번에 메모리에 올라온다
    rows = await db.execute(
        select(Document).options(*DOC_LIST_OPTS).where(Document.deleted_at <= cutoff)
    )
    docs = list(rows.scalars())
    for doc in docs:
        await _purge(db, doc)
        audit.record(
            db,
            "docs.purged",
            target_id=doc.id,
            detail={"title": doc.title, "deleted_at": doc.deleted_at.isoformat()},
        )
    await db.commit()
    return len(docs)


async def purge_loop() -> None:
    """main.py lifespan 이 띄우는 배치. 한 시간마다 한 번 — 30일 기한에 시 단위 오차면 충분하다.
    ponytail: worker 1개 전제(yjs 방과 같은 이유)라 프로세스 안 루프로 둔다. worker 가 늘면 compose 의
    backup 처럼 별도 서비스로 빼거나 advisory lock 을 건다."""
    while True:
        try:
            async with session_scope() as db:
                await purge_trash(db)
        except Exception:  # 배치 하나 실패로 서버가 죽거나 루프가 멈추면 안 된다
            log.exception("휴지통 비우기 실패")
        await asyncio.sleep(PURGE_INTERVAL_SECONDS)


@router.post(
    "/docs/{id}/untrash",
    response_model=DocOut,
    summary="휴지통에서 복구 (TC-DOC-05) — 04 에 없던 경로",
)
async def untrash_doc(
    id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> DocOut:
    doc = await _get_doc(db, id, user=user, trashed_ok=True, lock=True)
    doc.deleted_at = None
    doc.updated_by = user.id
    doc.updated_at = _now()
    await db.commit()
    await db.refresh(doc)
    embed.schedule(doc.id)  # 휴지통에 있는 동안 비워진 벡터 조각을 다시 채운다(README 45)
    return _doc_out(doc, user)


# ── 버전 ────────────────────────────────────────────────────────────


@router.get(
    "/docs/{id}/versions",
    response_model=Items[VersionMeta],
    summary="버전 목록 (최신순) — 스냅샷은 /restore 로 받는다",
)
async def list_versions(
    id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Items[VersionMeta]:
    doc = await _get_doc(db, id, user=user, trashed_ok=True)
    rows = await db.execute(
        select(DocVersion, User)
        # 스냅샷은 읽지 않는다. 전에는 버전마다 읽어 base64 로 만든 뒤 응답에서 버렸다(60개×500KB 에 233ms·32MB).
        .options(defer(DocVersion.snapshot, raiseload=True))
        .outerjoin(User, User.id == DocVersion.author_id)
        .where(DocVersion.doc_id == doc.id)
        .order_by(DocVersion.created_at.desc(), DocVersion.id.desc())
    )
    return Items(
        items=[
            VersionMeta(
                id=v.id,
                created_at=v.created_at,
                author=Person.model_validate(a) if a else None,
                label=v.label,
            )
            for v, a in rows
        ]
    )


@router.post(
    "/docs/{id}/versions",
    status_code=201,
    response_model=VersionOut,
    summary="Yjs 스냅샷 보관 — 같은 사람의 무명 스냅샷은 3분 안에 하나로 접는다. 04 에 없던 경로",
)
async def create_version(
    id: uuid.UUID,
    body: VersionCreateIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> VersionOut:
    doc = await _get_doc(db, id, user=user)
    snapshot = _unb64(body.snapshot)
    latest = (
        await db.execute(
            select(DocVersion)
            .options(defer(DocVersion.snapshot))  # 접을지 판정에는 안 쓴다. 접으면 덮어쓸 값이다
            .where(DocVersion.doc_id == doc.id)
            .order_by(DocVersion.created_at.desc(), DocVersion.id.desc())
            .limit(1)
            .with_for_update()  # 같은 사람의 동시 저장 둘이 같은 행을 접어 한쪽을 잃지 않게
        )
    ).scalar_one_or_none()
    coalescable = (
        latest is not None
        and body.label is None
        and latest.label is None
        and latest.author_id == user.id
        and _now() - latest.created_at < VERSION_COALESCE
    )
    if coalescable and latest is not None:
        latest.snapshot = snapshot
        latest.created_at = _now()
        version = latest
    else:
        # created_at 을 서버 now() 에 맡기지 않는다 — now() 는 트랜잭션 시작 시각이라 접기(위)로 갱신한
        # 파이썬 시각과 섞이면 순서가 뒤집힌다. 버전은 전부 앱 시각으로 찍는다.
        version = DocVersion(
            doc_id=doc.id, snapshot=snapshot, author_id=user.id, label=body.label, created_at=_now()
        )
        db.add(version)
    # refresh 하지 않는다. 칸은 전부 위에서 채웠고(id 는 INSERT 의 RETURNING), 하면 방금 쓴 스냅샷을 다시 읽는다.
    await db.commit()
    return _version_out(version, user)


@router.post(
    "/docs/{id}/restore",
    response_model=VersionOut,
    summary="버전 복구 — 복원할 스냅샷을 돌려준다. 적용은 클라이언트가 '앞으로 가는 편집' 한 번으로 한다",
)
async def restore_version(
    id: uuid.UUID,
    body: RestoreIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> VersionOut:
    # Y.Doc 을 서버가 과거 상태로 갈아끼우면 접속 중인 다른 사람과 병합돼 도로 취소된다(frontend/README).
    # 그래서 서버는 표식만 돌려주고, 클라이언트가 setContent 한 뒤 라벨 붙은 버전을 다시 올린다.
    doc = await _get_doc(db, id, user=user)
    row = (
        await db.execute(
            select(DocVersion, User)
            .outerjoin(User, User.id == DocVersion.author_id)
            .where(DocVersion.id == body.version_id, DocVersion.doc_id == doc.id)
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "이 문서에 없는 버전입니다.")
    version, author = row
    return _version_out(version, author)


# ── 댓글 ────────────────────────────────────────────────────────────


@router.get(
    "/docs/{id}/comments", response_model=Items[CommentOut], summary="블록 댓글 목록 (오래된 순)"
)
async def list_comments(
    id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
) -> Items[CommentOut]:
    doc = await _get_doc(db, id, user=user, trashed_ok=True)
    rows = await db.execute(
        select(DocComment, User)
        .join(User, User.id == DocComment.author_id)
        .where(DocComment.doc_id == doc.id)
        .order_by(DocComment.created_at, DocComment.id)
    )
    return Items(items=[_comment_out(c, a) for c, a in rows])


def _comment_out(c: DocComment, author: User) -> CommentOut:
    return CommentOut(
        id=c.id,
        block_id=c.block_id,
        author=Person.model_validate(author),
        body=c.body,
        created_at=c.created_at,
        edited_at=c.edited_at,
    )


async def _own_comment(
    db: AsyncSession, request: Request, user: User, doc_id: uuid.UUID, comment_id: uuid.UUID
) -> tuple[Document, DocComment]:
    """고치기·지우기의 공통 앞부분: 문서(휴지통 404) → 댓글(다른 문서의 것 404) → 쓴 사람(403 + acl.denied)."""
    doc = await _get_doc(db, doc_id, user=user)
    # 행 잠금 — 두 탭에서 고치기와 지우기가 겹치면 늦은 쪽이 0행에 닿아 500(StaleDataError)이 나던 것.
    # 잠금을 기다리는 사이 지워졌으면 None 이 와서 404 로 떨어진다(#278 의 문서 잠금과 같은 방식)
    comment = await db.get(DocComment, comment_id, with_for_update=True, populate_existing=True)
    if comment is None or comment.doc_id != doc.id:
        raise ApiError(404, "NOT_FOUND", "없는 댓글입니다.")
    if comment.author_id != user.id:
        audit.record(
            db,
            "acl.denied",
            request=request,
            actor_id=user.id,
            target_id=doc.id,
            detail={
                "path": request.url.path,
                "method": request.method,  # 고치기와 지우기가 같은 경로라 method 로 가른다
                "comment_id": str(comment.id),
            },
        )
        await db.commit()
        raise ApiError(403, "FORBIDDEN", "내 댓글만 고치거나 지울 수 있습니다.")
    return doc, comment


@router.post(
    "/docs/{id}/comments",
    status_code=201,
    response_model=CommentOut,
    summary="{block_id?, body} — @이름 멘션은 notifications(kind=mention) 로 (FR-DOC-04)",
)
async def create_comment(
    id: uuid.UUID,
    body: CommentCreateIn,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> CommentOut:
    doc = await _get_doc(db, id, user=user)
    comment = DocComment(
        doc_id=doc.id,
        block_id=body.block_id,
        author_id=user.id,
        body=body.body,
        created_at=_now(),  # 버전과 같은 이유 — 목록 정렬이 서버 now()(트랜잭션 시각)에 매달리지 않게
    )
    db.add(comment)
    await db.flush()

    # 못 보는 문서의 제목·댓글 미리보기를 멘션 알림으로 흘리지 않는다(README 57, 보안 리뷰)
    targets = [
        t
        for t in await chat.mention_targets(db, comment.body, user.id)
        if await acl.can_view_folder(db, t, doc.folder_id)
    ]
    notices = [
        Notification(
            user_id=target.id,
            kind="mention",
            created_at=comment.created_at,
            payload={
                "doc_id": str(doc.id),
                "doc_title": doc.title,
                "comment_id": str(comment.id),
                "block_id": comment.block_id,
                "from": {"id": str(user.id), "name": user.name},
                "preview": comment.body[:120],
            },
        )
        for target in targets
        if wants(target.preferences, "mention")
    ]
    db.add_all(notices)
    await db.commit()
    await db.refresh(comment)
    await asyncio.gather(*(chat.push_notice(n) for n in notices))  # 04 §3: 푸시는 /ws 몫
    return _comment_out(comment, user)


@router.patch(
    "/docs/{id}/comments/{comment_id}",
    response_model=CommentOut,
    responses={
        403: {"description": "남의 댓글"},
        404: {"description": "없는 문서·댓글, 휴지통 문서"},
    },
    summary="댓글 고치기 {body} — 쓴 사람만. 그대로면 edited_at 을 찍지 않는다 (이슈 #274)",
)
async def edit_comment(
    id: uuid.UUID,
    comment_id: uuid.UUID,
    body: CommentPatchIn,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> CommentOut:
    doc, comment = await _own_comment(db, request, user, id, comment_id)
    if body.body == comment.body:
        return _comment_out(comment, user)  # 고친 것으로 치지 않는다
    # 이전 본문은 행에 안 남는다 — 앞 120자를 감사에. 멘션 알림의 미리보기도 새 본문으로(채팅 #284 와 같은 규칙).
    # 새로 넣은 @이름에는 알림을 만들지 않는다 — 멘션은 달 때 한 번
    audit.record(
        db,
        "docs.comment_edited",
        request=request,
        actor_id=user.id,
        target_id=doc.id,
        detail={"comment_id": str(comment.id), "before": comment.body[:120]},
    )
    await db.execute(
        update(Notification)
        .where(Notification.payload["comment_id"].astext == str(comment.id))
        .values(
            payload=Notification.payload.op("||")(
                func.jsonb_build_object("preview", body.body[:120])
            )
        )
    )
    comment.body = body.body
    comment.edited_at = _now()
    await db.commit()
    return _comment_out(comment, user)


@router.delete(
    "/docs/{id}/comments/{comment_id}",
    status_code=204,
    responses={
        403: {"description": "남의 댓글"},
        404: {"description": "없는 문서·댓글, 휴지통 문서"},
    },
    summary="댓글 삭제 — 쓴 사람만. 그 댓글의 멘션 알림도 같이 지운다 (이슈 #253)",
)
async def delete_comment(
    id: uuid.UUID,
    comment_id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    doc, comment = await _own_comment(db, request, user, id, comment_id)
    # 답글 구조가 없어 자리표시 없이 행을 지운다. 알림을 눌러 올 곳이 없어지므로 멘션 알림도 함께.
    await db.execute(
        delete(Notification).where(Notification.payload["comment_id"].astext == str(comment.id))
    )
    await db.delete(comment)
    audit.record(
        db,
        "docs.comment_deleted",
        request=request,
        actor_id=user.id,
        target_id=doc.id,
        detail={"comment_id": str(comment.id), "preview": comment.body[:120]},
    )
    await db.commit()
    return Response(status_code=204)
