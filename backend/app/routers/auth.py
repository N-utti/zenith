"""04-API §1 인증 · §4.2/11 §7.5 프록시 인증 확인 · 비밀번호 변경.

세션은 auth_sessions 에 있고 refresh 는 쓸 때마다 회전한다(NFR-02). 옛 refresh 가 다시 오면 탈취로 보고
세션을 닫는다. 로그아웃·비활성화·비밀번호 변경은 세션을 회수하므로 access 만료를 기다리지 않는다.
FR-AUTH-04(LDAP/AD 확장점): 자격증명 검증은 `_verify_credentials` 한 곳이다 — LDAP 은 이 함수를 바꾼다.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.config import settings
from app.db import get_db
from app.deps import Auth, current_auth, current_user
from app.errors import ApiError
from app.models import AuthSession, Team, User
from app.security import (
    clear_auth_cookies,
    decode_token,
    hash_password,
    hash_password_async,
    set_auth_cookies,
    verify_password_async,
)

log = logging.getLogger(__name__)

REFRESH_GRACE = timedelta(seconds=10)  # 동시 refresh 유예(#340) — 아래 refresh() 참조

router = APIRouter(tags=["auth"])

# 없는 이메일에도 argon2 검증을 한 번 태워, 응답 시간으로 가입 여부를 알 수 없게 한다.
_DUMMY_HASH = hash_password("not-a-real-password")


class LoginIn(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class TeamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class MeOut(BaseModel):
    """04 §1 `GET /me` → {id, name, email, role, avatar} + team (03 §2.6 조직, 계약 확장)."""

    id: uuid.UUID
    name: str
    email: str
    role: str
    avatar: str | None
    team: TeamOut | None


class PasswordIn(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=settings.password_min_length)


def _now() -> datetime:
    return datetime.now(UTC)


async def _verify_credentials(db: AsyncSession, email: str, password: str) -> User | None:
    """이메일·비밀번호가 맞으면 사용자, 아니면 None. 활성 여부는 여기서 보지 않는다."""
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    ok = await verify_password_async(password, user.pw_hash if user else _DUMMY_HASH)
    return user if user is not None and ok else None


async def _open_session(db: AsyncSession, request: Request, response: Response, user: User) -> None:
    session = AuthSession(
        user_id=user.id,
        refresh_jti=uuid.uuid4(),
        expires_at=_now() + timedelta(days=settings.refresh_ttl_days),
        user_agent=request.headers.get("user-agent"),
        ip=audit.client_ip(request),
    )
    db.add(session)
    await db.flush()
    set_auth_cookies(
        response, user_id=user.id, session_id=session.id, refresh_jti=session.refresh_jti
    )


@router.post(
    "/auth/login",
    status_code=204,
    response_class=Response,
    summary="로그인 → 204 + Set-Cookie(access/refresh/csrf)",
    responses={
        401: {"description": "AUTH_INVALID(불일치) · AUTH_DISABLED(비활성 계정)"},
        429: {"description": "AUTH_THROTTLED — 같은 이메일로 실패가 누적됨"},
    },
)
async def login(
    body: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)
) -> None:
    email = body.email.strip().lower()
    window_start = _now() - timedelta(minutes=settings.login_failure_window_minutes)
    ip = audit.client_ip(request)
    # 이메일 기준은 (이메일, IP) 쌍으로 센다 — 남의 주소를 두드려 그 사람을 잠그지 못하게.
    # IP 기준은 이메일을 바꿔 가며 두드리는 걸 막는다. 둘이 합쳐 IP 당 시도 총량이 갇힌다.
    by_email = await audit.count_since(db, "auth.login_fail", window_start, ip=ip, email=email)
    by_ip = await audit.count_since(db, "auth.login_fail", window_start, ip=ip) if ip else 0
    if by_email >= settings.login_max_failures or by_ip >= settings.login_max_failures_per_ip:
        raise ApiError(
            429,
            "AUTH_THROTTLED",
            "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
            headers={"Retry-After": str(settings.login_failure_window_minutes * 60)},
        )

    user = await _verify_credentials(db, email, body.password)
    if user is None:
        audit.record(db, "auth.login_fail", request=request, detail={"email": email})
        await db.commit()
        raise ApiError(401, "AUTH_INVALID", "이메일 또는 비밀번호가 올바르지 않습니다.")
    if not user.active:
        # 비밀번호까지 맞는 본인에게만 비활성 사실을 알린다(TC-AUTH-03 "401 + 안내").
        audit.record(
            db,
            "auth.login_fail",
            request=request,
            actor_id=user.id,
            detail={"email": email, "reason": "disabled"},
        )
        await db.commit()
        raise ApiError(401, "AUTH_DISABLED", "비활성화된 계정입니다. 관리자에게 문의하세요.")

    await _open_session(db, request, response, user)
    audit.record(db, "auth.login_ok", request=request, actor_id=user.id)
    await db.commit()


@router.post(
    "/auth/refresh",
    status_code=204,
    response_class=Response,
    summary="refresh 쿠키로 access/refresh/csrf 재발급 — refresh 는 회전, 재사용은 세션 종료",
)
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> None:
    token = request.cookies.get("refresh")
    if not token:
        raise ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.")
    claims = decode_token(token, "refresh")
    # 행 잠금(#340 M2) — 같은 refresh 토큰이 동시에 둘 오면 둘째는 첫째의 커밋을 기다렸다가 회전된 jti 를 본다.
    # 잠금이 없으면 둘 다 통과해 커밋 순서에 따라 브라우저가 낡은 쿠키를 들게 된다(다음 refresh 에서 탈취로 오판).
    session = await db.get(AuthSession, claims.session_id, with_for_update=True)
    if session is None or session.revoked_at is not None or session.expires_at <= _now():
        raise ApiError(401, "AUTH_INVALID", "세션이 종료되었습니다. 다시 로그인해 주세요.")
    # 직전 회전 직후(REFRESH_GRACE 안)에 옛 토큰이 또 오면 동시 refresh 로 본다 — 평문 사내 주소에는
    # navigator.locks 가 없어 탭마다 따로 부른다(lib/api.ts). 회전도 회수도 하지 않고 현재 쿠키를 다시 내준다.
    # 대가: 회전 직후 10초 동안은 이 세션의 **어떤** 옛 jti 도 재사용으로 탐지되지 않고 현재 쿠키를 받는다
    # (직전 것만이 아니다). 창 밖이면 바로 회수되므로 반복 시도로 창을 노리기는 어렵다.
    # ponytail: 정확히 「직전 jti」만 봐주려면 prev_refresh_jti 칸.
    race = session.refresh_jti != claims.jti and _now() - session.last_used_at < REFRESH_GRACE
    if session.refresh_jti != claims.jti and not race:
        # 이미 회전된 토큰이 다시 왔다 — 탈취로 간주하고 세션을 닫는다.
        session.revoked_at = _now()
        audit.record(
            db,
            "auth.refresh_reuse",
            request=request,
            actor_id=session.user_id,
            target_id=session.id,
        )
        await db.commit()
        raise ApiError(401, "AUTH_INVALID", "세션이 무효화되었습니다. 다시 로그인해 주세요.")
    user = await db.get(User, session.user_id)
    if user is None or not user.active:
        session.revoked_at = _now()
        await db.commit()
        raise ApiError(401, "AUTH_DISABLED", "비활성화된 계정입니다. 관리자에게 문의하세요.")

    # expires_at 은 로그인 때 정한 그대로다 — 세션 수명은 절대값 14일이고 쓸수록 늘어나지 않는다.
    if race:
        log.info("refresh 동시 유예 %s", session.id)  # 탐지를 완화한 흔적 — 감사까지는 두지 않는다
    else:
        session.refresh_jti = uuid.uuid4()
        session.last_used_at = _now()
        await db.commit()
    set_auth_cookies(
        response, user_id=user.id, session_id=session.id, refresh_jti=session.refresh_jti
    )


@router.post(
    "/auth/logout",
    status_code=204,
    response_class=Response,
    summary="세션 회수 + 쿠키 제거. 쿠키가 없거나 깨져 있어도 204",
)
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> None:
    for kind in ("access", "refresh"):
        token = request.cookies.get(kind)
        if not token:
            continue
        try:
            claims = decode_token(token, kind)
        except ApiError:
            continue
        session = await db.get(AuthSession, claims.session_id)
        if session is not None and session.revoked_at is None:
            session.revoked_at = _now()
            audit.record(
                db, "auth.logout", request=request, actor_id=session.user_id, target_id=session.id
            )
            await db.commit()
        break
    clear_auth_cookies(response)
    # 이 브라우저가 캐시해 둔 첨부·문서 파일을 비운다(#328) — 공용 PC 의 다음 사용자가 캐시로 열지 못하게.
    # HTTPS 에서만 동작한다(평문 사내 주소에서는 브라우저가 무시) — 첨부는 어차피 no-store, 문서 파일은 no-cache.
    response.headers["Clear-Site-Data"] = '"cache"'


@router.get("/me", response_model=MeOut, summary="내 프로필")
async def me(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> MeOut:
    team = await db.get(Team, user.team_id) if user.team_id else None
    return MeOut(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        avatar=user.avatar,
        team=TeamOut.model_validate(team) if team else None,
    )


@router.get(
    "/auth/yjs-check",
    status_code=204,
    response_class=Response,
    summary="프록시 forward_auth 용 (04 §4.2 · 11 §7.5): 쿠키가 유효하면 204 + X-User-Id/X-User-Role",
)
async def yjs_check(response: Response, user: User = Depends(current_user)) -> None:
    # ponytail: 문서 단위 열람 권한은 문서 기능이 붙을 때 X-Forwarded-Uri 로 판정한다. 지금은 로그인 여부만.
    response.headers["X-User-Id"] = str(user.id)
    response.headers["X-User-Role"] = user.role


@router.post(
    "/me/password",
    status_code=204,
    response_class=Response,
    summary="비밀번호 변경 — 지금 세션 외 다른 세션은 모두 종료",
)
async def change_password(
    body: PasswordIn,
    request: Request,
    auth: Auth = Depends(current_auth),
    db: AsyncSession = Depends(get_db),
) -> None:
    user, session = auth
    if not await verify_password_async(body.current_password, user.pw_hash):
        raise ApiError(400, "PASSWORD_MISMATCH", "현재 비밀번호가 올바르지 않습니다.")
    user.pw_hash = await hash_password_async(body.new_password)
    await db.execute(
        update(AuthSession)
        .where(
            AuthSession.user_id == user.id,
            AuthSession.id != session.id,
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=_now())
    )
    audit.record(db, "auth.password_changed", request=request, actor_id=user.id)
    await db.commit()
