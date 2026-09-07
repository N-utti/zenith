"""요청 단위 인증·권한·CSRF 의존성."""

import hmac
from collections.abc import Callable, Coroutine, Mapping
from datetime import UTC, datetime
from typing import Any

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.config import settings
from app.db import get_db
from app.errors import ApiError
from app.models import ROLE_RANK, AuthSession, Role, User
from app.security import csrf_token, decode_token, session_id_from_cookies

Auth = tuple[User, AuthSession]


async def authenticate(cookies: Mapping[str, str], db: AsyncSession) -> Auth:
    """access 쿠키 → (사용자, 세션). HTTP 와 WebSocket 핸드셰이크가 같이 쓴다.

    쿠키가 없으면 DB 를 건드리지 않는다. 세션을 함께 읽어 로그아웃·강제 종료가 access 만료(15분)를
    기다리지 않고 바로 먹히게 한다.
    """
    token = cookies.get("access")
    if not token:
        raise ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.")
    claims = decode_token(token, "access")
    row = (
        await db.execute(
            select(User, AuthSession)
            .join(AuthSession, AuthSession.user_id == User.id)
            .where(User.id == claims.user_id, AuthSession.id == claims.session_id)
        )
    ).one_or_none()
    if row is None:
        raise ApiError(401, "AUTH_INVALID", "유효하지 않은 세션입니다.")
    user, session = row
    if not user.active:
        raise ApiError(401, "AUTH_DISABLED", "비활성화된 계정입니다. 관리자에게 문의하세요.")
    if session.revoked_at is not None or session.expires_at <= datetime.now(UTC):
        raise ApiError(401, "AUTH_INVALID", "세션이 종료되었습니다. 다시 로그인해 주세요.")
    return user, session


async def current_auth(request: Request, db: AsyncSession = Depends(get_db)) -> Auth:
    return await authenticate(request.cookies, db)


async def current_user(auth: Auth = Depends(current_auth)) -> User:
    return auth[0]


def require_role(min_role: Role) -> Callable[..., Coroutine[Any, Any, User]]:
    """03-ERD §2.2: member < lead < exec 서열 하나로 판정한다. 거부는 감사 로그에 남긴다(04 §9)."""

    async def dep(
        request: Request,
        user: User = Depends(current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        # users.role 은 CHECK 없는 text — 모르는 값은 최소 권한(0)으로 닫는다.
        if ROLE_RANK.get(user.role, 0) < ROLE_RANK[min_role]:
            audit.record(
                db,
                "acl.denied",
                request=request,
                actor_id=user.id,
                detail={"path": request.url.path, "min_role": min_role},
            )
            await db.commit()
            raise ApiError(403, "FORBIDDEN", "권한이 부족합니다.")
        return user

    return dep


_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_CSRF_EXEMPT = frozenset({"/api/auth/login"})  # 아직 세션이 없어 토큰도 없다
# Fetch Metadata: 브라우저가 붙이는 요청 출처. same-site 도 막는다 — 형제 서브도메인에도 SameSite=Lax 쿠키가 실린다.
_FORBIDDEN_SITES = frozenset({"cross-site", "same-site"})


def _own_origin(request: Request) -> str:
    # Caddy·vite 프록시 뒤에서는 X-Forwarded-* 가 브라우저가 본 주소다.
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    return f"{scheme}://{host}"


async def csrf_guard(request: Request) -> None:
    """11 §4.3 — 상태 변경 요청의 출처를 대조하고, 쿠키 세션이면 X-CSRF-Token 이 세션에서 계산한 값과 같아야 한다.

    출처: `Sec-Fetch-Site` 가 cross-site·same-site 이거나 `Origin` 이 우리 것이 아니면 403. 둘 다 없는
    요청(curl 같은 비브라우저)은 쿠키를 자동으로 싣지 않으므로 CSRF 표면이 아니다. 네이티브 셸(tauri://…)은
    CORS_ORIGINS 로 허용한다.
    토큰: 헤더 값을 쿠키와 비교하지 않는다 — 쿠키는 공격자가 심을 수 있다. 세션 id 로 HMAC 을 다시 계산해 대조한다.
    """
    if request.method in _SAFE_METHODS:
        return
    origin = request.headers.get("origin")
    origin_ok = origin is not None and (
        origin == _own_origin(request) or origin in settings.cors_origins
    )
    if request.headers.get("sec-fetch-site") in _FORBIDDEN_SITES and not origin_ok:
        raise ApiError(403, "CSRF_ORIGIN", "허용되지 않은 출처의 요청입니다.")
    if origin is not None and not origin_ok:
        raise ApiError(403, "CSRF_ORIGIN", "허용되지 않은 출처의 요청입니다.")
    if request.url.path in _CSRF_EXEMPT:
        return  # 로그인 CSRF 는 위 출처 대조가 막는다
    if "access" in request.cookies or "refresh" in request.cookies:
        session_id = session_id_from_cookies(request.cookies)
        header = request.headers.get("x-csrf-token", "")
        if session_id is None or not hmac.compare_digest(header, csrf_token(session_id)):
            raise ApiError(403, "CSRF_TOKEN", "CSRF 토큰이 없거나 일치하지 않습니다.")
