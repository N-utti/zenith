"""JWT(HS256) 발급·검증 · 쿠키 · CSRF 토큰 · 비밀번호 해시.

규약: 04-API §1(access 15분 / refresh 14일) · 11 §7.2(쿠키 속성) · 11 §4.3(CSRF 이중 제출).
토큰은 세션(auth_sessions)에 묶인다 — access/refresh 모두 sid 를 싣고, refresh 는 회전용 jti 를 더 싣는다.
"""

import hashlib
import hmac
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

import anyio
import jwt
from fastapi import Response
from pwdlib import PasswordHash

from app.config import settings
from app.errors import ApiError

TokenKind = Literal["access", "refresh"]

# NFR-02 는 bcrypt 를 적었지만 argon2id 가 현재 권장(OWASP)이며 pwdlib 기본값이다. README "설계와 어긋나는 것".
_hasher = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, pw_hash: str) -> bool:
    return _hasher.verify(password, pw_hash)


# argon2 는 일부러 느리다(수십 ms, 64MiB). 이벤트 루프에서 돌리면 로그인 하나가 다른 요청을 전부 세운다.
async def hash_password_async(password: str) -> str:
    return await anyio.to_thread.run_sync(hash_password, password)


async def verify_password_async(password: str, pw_hash: str) -> bool:
    return await anyio.to_thread.run_sync(verify_password, password, pw_hash)


@dataclass(frozen=True)
class Claims:
    user_id: uuid.UUID
    session_id: uuid.UUID
    jti: uuid.UUID | None  # refresh 에만 있다


def create_token(
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    kind: TokenKind,
    ttl: timedelta,
    jti: uuid.UUID | None = None,
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, object] = {
        "sub": str(user_id),
        "sid": str(session_id),
        "kind": kind,
        "iat": now,
        "exp": now + ttl,
    }
    if jti is not None:
        payload["jti"] = str(jti)
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str, kind: TokenKind, *, verify_exp: bool = True) -> Claims:
    """만료는 AUTH_EXPIRED, 위조·종류 불일치·깨진 클레임은 AUTH_INVALID."""
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=["HS256"], options={"verify_exp": verify_exp}
        )
    except jwt.ExpiredSignatureError as e:
        raise ApiError(401, "AUTH_EXPIRED", "로그인이 만료되었습니다.") from e
    except jwt.InvalidTokenError as e:
        raise ApiError(401, "AUTH_INVALID", "유효하지 않은 토큰입니다.") from e
    if payload.get("kind") != kind:
        raise ApiError(401, "AUTH_INVALID", "유효하지 않은 토큰입니다.")
    try:
        return Claims(
            user_id=uuid.UUID(str(payload.get("sub"))),
            session_id=uuid.UUID(str(payload.get("sid"))),
            jti=uuid.UUID(str(payload["jti"])) if payload.get("jti") else None,
        )
    except ValueError as e:
        raise ApiError(401, "AUTH_INVALID", "유효하지 않은 토큰입니다.") from e


def csrf_token(session_id: uuid.UUID) -> str:
    """세션 id 의 HMAC — 저장할 것이 없고, 비밀키 없이는 만들 수 없다. 검사하는 쪽이 반드시 다시 계산한다."""
    return hmac.new(
        settings.jwt_secret.encode(), f"csrf:{session_id}".encode(), hashlib.sha256
    ).hexdigest()


def session_id_from_cookies(cookies: Mapping[str, str]) -> uuid.UUID | None:
    """CSRF 검사용 — 서명만 맞으면 만료된 access 에서도 sid 를 꺼낸다(access 쿠키는 토큰보다 오래 산다)."""
    for kind in ("access", "refresh"):
        token = cookies.get(kind)
        if not token:
            continue
        try:
            return decode_token(token, kind, verify_exp=False).session_id
        except ApiError:
            continue
    return None


def set_auth_cookies(
    response: Response, *, user_id: uuid.UUID, session_id: uuid.UUID, refresh_jti: uuid.UUID
) -> None:
    access_ttl = timedelta(minutes=settings.access_ttl_minutes)
    refresh_ttl = timedelta(days=settings.refresh_ttl_days)
    common = {"secure": settings.cookie_secure, "samesite": "lax", "path": "/"}
    # ponytail: 11 §7.2대로 전부 Path=/. refresh 는 /api/auth 로 좁히는 편이 낫지만 명세를 먼저 고친 뒤에.
    # access 쿠키의 수명은 refresh 와 같다. 15분은 토큰(exp)이 판정한다 — 쿠키 수명을 15분으로 두면
    # 브라우저가 만료된 쿠키를 아예 버려 서버가 AUTH_EXPIRED 대신 AUTH_REQUIRED 를 주고, 프론트는
    # 재발급을 시도할 신호를 잃는다(TC-AUTH-02).
    response.set_cookie(
        "access",
        create_token(user_id=user_id, session_id=session_id, kind="access", ttl=access_ttl),
        max_age=int(refresh_ttl.total_seconds()),
        httponly=True,
        **common,
    )
    response.set_cookie(
        "refresh",
        create_token(
            user_id=user_id, session_id=session_id, kind="refresh", ttl=refresh_ttl, jti=refresh_jti
        ),
        max_age=int(refresh_ttl.total_seconds()),
        httponly=True,
        **common,
    )
    # JS 가 읽어 X-CSRF-Token 헤더로 되돌려 보낸다(11 §4.3). HttpOnly 가 아닌 유일한 쿠키.
    response.set_cookie(
        "csrf",
        csrf_token(session_id),
        max_age=int(refresh_ttl.total_seconds()),
        httponly=False,
        **common,
    )


def clear_auth_cookies(response: Response) -> None:
    for name, httponly in (("access", True), ("refresh", True), ("csrf", False)):
        response.delete_cookie(
            name, path="/", httponly=httponly, secure=settings.cookie_secure, samesite="lax"
        )
