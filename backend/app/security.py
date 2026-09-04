"""JWT(HS256) 발급·검증과 쿠키. 규약: 04-API §1, 쿠키 속성: 11 §7.2."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt
from fastapi import Response
from pwdlib import PasswordHash

from app.config import settings
from app.errors import ApiError

TokenKind = Literal["access", "refresh"]

_hasher = PasswordHash.recommended()  # argon2id


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, pw_hash: str) -> bool:
    return _hasher.verify(password, pw_hash)


def create_token(sub: str, kind: TokenKind, ttl: timedelta) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {"sub": sub, "kind": kind, "iat": now, "exp": now + ttl},
        settings.jwt_secret,
        algorithm="HS256",
    )


def decode_token(token: str, kind: TokenKind) -> uuid.UUID:
    """유효하면 sub(user id)를 돌려준다. 만료는 AUTH_EXPIRED, 위조·종류 불일치·깨진 sub는 AUTH_INVALID."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as e:
        raise ApiError(401, "AUTH_EXPIRED", "로그인이 만료되었습니다.") from e
    except jwt.InvalidTokenError as e:
        raise ApiError(401, "AUTH_INVALID", "유효하지 않은 토큰입니다.") from e
    if payload.get("kind") != kind:
        raise ApiError(401, "AUTH_INVALID", "유효하지 않은 토큰입니다.")
    try:
        return uuid.UUID(str(payload.get("sub")))
    except ValueError as e:
        raise ApiError(401, "AUTH_INVALID", "유효하지 않은 토큰입니다.") from e


def set_auth_cookies(response: Response, user_id: str) -> None:
    ttls: dict[TokenKind, timedelta] = {
        "access": timedelta(minutes=settings.access_ttl_minutes),
        "refresh": timedelta(days=settings.refresh_ttl_days),
    }
    for kind, ttl in ttls.items():
        # ponytail: 11 §7.2대로 둘 다 Path=/. refresh는 /api/auth로 좁히는 편이 낫지만 명세를 먼저 고친 뒤에.
        response.set_cookie(
            kind,
            create_token(user_id, kind, ttl),
            max_age=int(ttl.total_seconds()),
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
            path="/",
        )


def clear_auth_cookies(response: Response) -> None:
    for name in ("access", "refresh"):
        response.delete_cookie(
            name, path="/", httponly=True, secure=settings.cookie_secure, samesite="lax"
        )
