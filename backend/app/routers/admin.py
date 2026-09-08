"""exec 전용 관리 — 04-API §9 계정·감사(실구현) · §10.4 근태 · 13 §9.3 결재 정책(스텁).

FR-AUTH-03: 셀프 가입이 없다. 계정은 여기서만 만들고 비활성화한다.
"""

import uuid
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.config import settings
from app.db import get_db
from app.deps import require_role
from app.errors import ApiError
from app.models import AuditEvent, AuthSession, Role, Team, User
from app.paging import decode_cursor, encode_cursor
from app.routers import channels
from app.security import hash_password_async
from app.stubs import register_stubs

require_exec = require_role("exec")
router = APIRouter(tags=["admin"], dependencies=[Depends(require_exec)])

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    role: str
    avatar: str | None
    active: bool
    team_id: uuid.UUID | None
    hire_date: date | None
    created_at: datetime


class UserCreateIn(BaseModel):
    name: str = Field(min_length=1)
    email: str = Field(pattern=EMAIL_PATTERN)
    password: str = Field(min_length=settings.password_min_length)
    role: Role = "member"
    team_id: uuid.UUID | None = None
    hire_date: date | None = None


class UserPatchIn(BaseModel):
    """보낸 필드만 바꾼다. password 를 보내면 임시 비밀번호로 재설정하고 그 사람의 세션을 전부 닫는다."""

    name: str | None = Field(default=None, min_length=1)
    role: Role | None = None
    active: bool | None = None
    team_id: uuid.UUID | None = None
    hire_date: date | None = None
    password: str | None = Field(default=None, min_length=settings.password_min_length)


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    at: datetime
    kind: str
    actor_id: uuid.UUID | None
    target_id: uuid.UUID | None
    ip: str | None
    user_agent: str | None
    detail: dict | None


class AuditPage(BaseModel):
    items: list[AuditOut]
    next_cursor: str | None


def _now() -> datetime:
    return datetime.now(UTC)


async def _revoke_sessions(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


async def _require_team(db: AsyncSession, team_id: uuid.UUID | None) -> None:
    # 외래키 위반을 commit 에서 맞으면 500 이 된다. 미리 확인해 422 로 돌려준다.
    if team_id is not None and await db.get(Team, team_id) is None:
        raise ApiError(422, "VALIDATION", "없는 팀입니다.")


@router.get("/admin/users", response_model=list[UserOut], summary="계정 목록")
async def list_users(db: AsyncSession = Depends(get_db)) -> list[User]:
    return list((await db.execute(select(User).order_by(User.name))).scalars())


@router.post(
    "/admin/users",
    status_code=201,
    response_model=UserOut,
    summary="계정 생성 (FR-AUTH-03)",
    responses={409: {"description": "CONFLICT — 이미 있는 이메일"}},
)
async def create_user(
    body: UserCreateIn,
    request: Request,
    actor: User = Depends(require_exec),
    db: AsyncSession = Depends(get_db),
) -> User:
    email = body.email.strip().lower()
    if (await db.execute(select(User.id).where(User.email == email))).scalar_one_or_none():
        raise ApiError(409, "CONFLICT", "이미 있는 이메일입니다.")
    await _require_team(db, body.team_id)
    user = User(
        name=body.name.strip(),
        email=email,
        pw_hash=await hash_password_async(body.password),
        role=body.role,
        team_id=body.team_id,
        hire_date=body.hire_date,
    )
    db.add(user)
    await db.flush()
    await channels.join_public_channels(db, user.id)  # 공개 채널은 전원 멤버 (04 §5, README 12)
    audit.record(
        db,
        "admin.user_created",
        request=request,
        actor_id=actor.id,
        target_id=user.id,
        detail={"email": email, "role": body.role},
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.patch(
    "/admin/users/{user_id}",
    response_model=UserOut,
    summary="등급 변경·비활성화·임시 비밀번호. 자기 자신의 등급·활성 상태는 못 바꾼다",
)
async def update_user(
    user_id: uuid.UUID,
    body: UserPatchIn,
    request: Request,
    actor: User = Depends(require_exec),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise ApiError(404, "NOT_FOUND", "없는 계정입니다.")
    changes = body.model_dump(exclude_unset=True)
    if user.id == actor.id and ({"active", "role"} & changes.keys()):
        raise ApiError(400, "ADMIN_SELF", "자기 자신의 등급·활성 상태는 바꿀 수 없습니다.")

    await _require_team(db, changes.get("team_id"))
    before = {"role": user.role, "active": user.active}
    password = changes.pop("password", None)
    for key, value in changes.items():
        setattr(user, key, value.strip() if key == "name" else value)
    if password:
        user.pw_hash = await hash_password_async(password)
    if password or changes.get("active") is False:
        await _revoke_sessions(db, user.id)

    audit.record(
        db,
        "admin.user_updated",
        request=request,
        actor_id=actor.id,
        target_id=user.id,
        detail={
            "fields": sorted(changes) + (["password"] if password else []),
            "before": before,
            "after": {"role": user.role, "active": user.active},
        },
    )
    await db.commit()
    await db.refresh(user)
    return user


@router.get(
    "/admin/audit",
    response_model=AuditPage,
    summary="감사 로그 — ?kind=acl 처럼 앞글자 일치, 최신순 커서 페이징 (04 §0)",
)
async def list_audit(
    kind: str | None = None,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> AuditPage:
    stmt = select(AuditEvent).order_by(AuditEvent.at.desc(), AuditEvent.id.desc()).limit(limit + 1)
    if kind:
        stmt = stmt.where(AuditEvent.kind.startswith(kind, autoescape=True))  # %·_ 를 글자로
    if cursor:
        at, id_ = decode_cursor(cursor)
        stmt = stmt.where(tuple_(AuditEvent.at, AuditEvent.id) < (at, id_))
    rows = list((await db.execute(stmt)).scalars())
    more = len(rows) > limit
    rows = rows[:limit]
    return AuditPage(
        items=[AuditOut.model_validate(row) for row in rows],
        next_cursor=encode_cursor(rows[-1].at, rows[-1].id) if more else None,
    )


register_stubs(
    router,
    [
        ("GET", "/admin/holidays", "공휴일·회사 휴일 목록"),
        ("POST", "/admin/holidays", "휴일 등록 → 근무 달력 재생성 (10-근태 §6.2)"),
        ("POST", "/admin/attendance/calendar/rebuild", "{year} 근무 달력 재생성"),
        ("GET", "/admin/leave-policy", "연차 부여 기준 (입사일 / 회계연도)"),
        ("PATCH", "/admin/leave-policy", "연차 부여 기준 변경"),
        ("GET", "/admin/approval-policy", "결재 양식·전결 기준 (13 §9.3)"),
        ("PATCH", "/admin/approval-policy", "결재 양식·전결 기준 변경"),
    ],
)
