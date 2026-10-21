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
from fastapi import Request, Response
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


def cookie_attrs(request: Request, *, strict: bool = True) -> dict[str, object]:
    """세션 쿠키의 Secure·SameSite — 요청이 어디서 왔는지로 정한다(11 §7.2 · I6).

    웹(같은 오리진)은 Lax. 네이티브 셸(Origin 이 CORS_ORIGINS 에 있는 요청)은 셸 오리진(http://tauri.localhost)과
    서버가 교차 사이트라 Lax 쿠키가 fetch 에 실리지 않으므로 SameSite=None. None 은 Secure 가 필수(Chromium 이
    아니면 버린다) — 평문 사이트(사내망 5180)에서는 셸 로그인이 조용히 깨지는 대신 400 으로 알린다.
    strict=False(로그아웃)는 400 대신 Lax 로 폴백한다 — 삭제는 (name, path) 만 맞으면 되고 응답은 늘 204 여야 한다.
    CSRF 는 SameSite 가 아니라 출처 대조 + HMAC 토큰(deps.csrf_guard)이 막으므로 None 이 방어를 깎지 않는다.
    호출부는 DB 를 commit 하기 **전에** 부른다 — refresh 가 회전을 저장한 뒤 400 이 나면 쿠키만 안 바뀌어
    다음 요청이 재사용 탐지(세션 종료)로 오인된다.

    받아들인 위험(리뷰 2026-10-21): `*.localhost` 는 Chromium 이 루프백으로 못박으므로 사용자 PC 의 127.0.0.1:80
    을 점유한 프로세스가 일반 브라우저에서도 http://tauri.localhost 오리진을 얻어 login CSRF(피해자 브라우저에
    공격자 세션 쿠키 심기)를 할 수 있다. 로컬 코드 실행이 전제라 파일럿에서는 받아들인다. 막으려면 셸을
    useHttpsScheme(https://tauri.localhost)으로 옮기고 CORS_ORIGINS 를 맞춘다(apps/desktop, 프론트 영역).
    """
    lax = {"secure": settings.cookie_secure, "samesite": "lax", "path": "/"}
    if request.headers.get("origin") not in settings.cors_origins:
        return lax
    # caddy 뒤에서는 X-Forwarded-Proto 가 브라우저가 본 scheme 이다
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    if not (settings.cookie_secure or scheme == "https"):
        if not strict:
            return lax
        raise ApiError(400, "SHELL_NEEDS_HTTPS", "앱 로그인은 HTTPS 주소로만 됩니다.")
    return {"secure": True, "samesite": "none", "path": "/"}


def set_auth_cookies(
    response: Response,
    *,
    attrs: dict[str, object],
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    refresh_jti: uuid.UUID,
) -> None:
    access_ttl = timedelta(minutes=settings.access_ttl_minutes)
    refresh_ttl = timedelta(days=settings.refresh_ttl_days)
    common = attrs
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
    token = csrf_token(session_id)
    response.set_cookie(
        "csrf", token, max_age=int(refresh_ttl.total_seconds()), httponly=False, **common
    )
    # 셸 페이지(http://tauri.localhost)는 서버 도메인의 쿠키를 document.cookie 로 못 읽는다 — 같은 값을 헤더로도
    # 준다(main.py CORS expose_headers). 세션 HMAC 이라 노출해도 쿠키와 같은 수준이다. 프론트 lib/api.ts 가 받아 둔다.
    response.headers["X-CSRF-Token"] = token


def clear_auth_cookies(response: Response, *, attrs: dict[str, object]) -> None:
    common = attrs
    for name, httponly in (("access", True), ("refresh", True), ("csrf", False)):
        response.delete_cookie(name, httponly=httponly, **common)
