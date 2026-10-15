"""워크스페이스(문서) 열람 권한 — 폴더 등급 + 사람 지정(README 57, 사용자 결정 2026-10-15).

규칙 하나: 폴더 F 를 볼 수 있다 = (F 와 F 의 모든 조상 각각에 대해) 내 등급이 그 폴더의 `min_role` 이상이거나 그
폴더의 `folder_members` 에 내가 있다. 문서는 자기 폴더를 따른다. 임원(exec)은 등급이 가장 높아 전부 본다(게시판
`min_role` 과 같은 서열, 03 §2.2). 등급·사람 지정은 임원만 바꾼다.

판정은 전부 서버에서 — 트리·상세·수정·버전·댓글·검색·AI 근거·실시간 편집(yjs)·문서 파일·자료실·홈이 전부 이
모듈의 `visible_folder_ids()`(SQL 부분식)와 `require_doc_view()` 를 쓴다. 거부는 `acl.denied` 감사(403), 목록에서는
그냥 빠진다(게시판은 제목을 가리지만 문서는 폴더째 숨긴다 — 존재도 안 보이는 게 맞다).
"""

import uuid

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select
from starlette.requests import HTTPConnection

from app import audit
from app.errors import ApiError
from app.models import ROLE_RANK, Document, Folder, FolderMember, User


def _allowed(user: User):
    """폴더 행 하나에 대한 허용 조건(SQL)."""
    rank = ROLE_RANK.get(user.role, 0)
    roles = [
        r for r, k in ROLE_RANK.items() if k <= rank
    ]  # 모르는 등급은 아무것도 못 본다(게시판과 같다)
    return or_(
        Folder.min_role.in_(roles),
        exists().where(FolderMember.folder_id == Folder.id, FolderMember.user_id == user.id),
    )


def visible_folder_ids(user: User) -> Select:
    """이 사람이 볼 수 있는 폴더 id 의 SELECT — `Document.folder_id.in_(visible_folder_ids(user))` 로 쓴다.
    「막힌 폴더」(허용 조건을 못 채운 폴더)와 그 아래 전부를 모아 뺀다 — 조상 중 하나라도 막히면 그 아래는 안 보인다.
    루트에서 내려가지 않고 막힌 곳에서 내려가므로 폴더 고리(동시 이동 경합으로 생길 수 있다, docs._assert_no_cycle
    주석)가 있어도 보인다. UNION(ALL 아님)이라 고리를 돌아도 끝난다(search.py 의 subtree 와 같은 이유).
    한 SQL 문에 한 번만 — 두 번 필요하면 결과 객체를 재사용한다(같은 이름의 CTE 가 둘이면 컴파일 오류).
    ponytail: 폴더 하나를 판정할 때도 막힌 폴더 전체를 센다 — 폴더 수십 개 규모. 수백 개를 넘으면 조상만 따라 올라간다."""
    blocked = select(Folder.id).where(~_allowed(user)).cte("blocked_folders", recursive=True)
    blocked = blocked.union(select(Folder.id).join(blocked, Folder.parent_id == blocked.c.id))
    return select(Folder.id).where(Folder.id.not_in(select(blocked.c.id)))


def restricted_folder_ids() -> Select:
    """등급·사람 지정이 걸린 폴더와 그 아래 전부(「전원 열람」이 아닌 폴더) — 이동 제한(README 57)과 자료실 scope 에 쓴다."""
    marked = or_(
        Folder.min_role != "member",
        exists().where(FolderMember.folder_id == Folder.id),
    )
    cte = select(Folder.id).where(marked).cte("restricted_folders", recursive=True)
    cte = cte.union(select(Folder.id).join(cte, Folder.parent_id == cte.c.id))
    return select(cte.c.id)


async def is_restricted(db: AsyncSession, folder_id: uuid.UUID) -> bool:
    return bool(
        await db.scalar(
            select(exists().where(Folder.id == folder_id, Folder.id.in_(restricted_folder_ids())))
        )
    )


async def can_view_folder(db: AsyncSession, user: User, folder_id: uuid.UUID) -> bool:
    return bool(
        await db.scalar(
            select(exists().where(Folder.id == folder_id, Folder.id.in_(visible_folder_ids(user))))
        )
    )


async def can_view_doc(db: AsyncSession, user: User, doc_id: uuid.UUID) -> bool:
    """문서가 없으면 True — 「없음」 판정(404)은 호출자가 한다(존재 여부를 권한 오류로 새게 하지 않는다)."""
    folder_id = await db.scalar(select(Document.folder_id).where(Document.id == doc_id))
    return folder_id is None or await can_view_folder(db, user, folder_id)


async def require_doc_view(
    db: AsyncSession, user: User, doc: Document, path: str, request: HTTPConnection | None = None
) -> None:
    """못 보는 폴더의 문서면 403 + acl.denied(게시판 본문 403 과 같은 결). `path` 는 감사용 경로 이름."""
    if await can_view_folder(db, user, doc.folder_id):
        return
    audit.record(
        db,
        "acl.denied",
        request=request,
        actor_id=user.id,
        target_id=doc.id,
        detail={"path": path, "folder_id": str(doc.folder_id)},
    )
    await db.commit()
    raise ApiError(403, "FORBIDDEN", "이 문서를 볼 권한이 없습니다.")


def require_acl_editor(user: User) -> None:
    """폴더 등급·사람 지정은 임원만."""
    if user.role != "exec":
        raise ApiError(403, "FORBIDDEN", "폴더 열람 권한은 임원만 바꿀 수 있습니다.")
