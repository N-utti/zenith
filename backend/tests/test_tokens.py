"""app/security.py 단위 — DB 없이 돈다."""

import uuid
from datetime import timedelta

import pytest

from app.errors import ApiError
from app.security import create_token, csrf_token, decode_token

USER = uuid.uuid4()
SID = uuid.uuid4()
JTI = uuid.uuid4()


def test_access_roundtrip() -> None:
    token = create_token(user_id=USER, session_id=SID, kind="access", ttl=timedelta(minutes=15))
    claims = decode_token(token, "access")
    assert (claims.user_id, claims.session_id, claims.jti) == (USER, SID, None)


def test_refresh_carries_jti() -> None:
    token = create_token(
        user_id=USER, session_id=SID, kind="refresh", ttl=timedelta(days=14), jti=JTI
    )
    assert decode_token(token, "refresh").jti == JTI


def test_refresh_token_is_not_an_access_token() -> None:
    token = create_token(
        user_id=USER, session_id=SID, kind="refresh", ttl=timedelta(days=14), jti=JTI
    )
    with pytest.raises(ApiError) as e:
        decode_token(token, "access")
    assert e.value.code == "AUTH_INVALID"


def test_expired_token() -> None:
    token = create_token(user_id=USER, session_id=SID, kind="access", ttl=timedelta(seconds=-1))
    with pytest.raises(ApiError) as e:
        decode_token(token, "access")
    assert (e.value.status_code, e.value.code) == (401, "AUTH_EXPIRED")


def test_garbage_token_is_401() -> None:
    with pytest.raises(ApiError) as e:
        decode_token("not.a.jwt", "access")
    assert e.value.code == "AUTH_INVALID"


def test_csrf_token_is_stable_per_session_and_unforgeable_by_guess() -> None:
    assert csrf_token(SID) == csrf_token(SID)
    assert csrf_token(SID) != csrf_token(uuid.uuid4())
    assert len(csrf_token(SID)) == 64  # sha256 hex
