"""04-API §1 — 쿠키 JWT. DB 대신 가짜 세션을 끼워 로그인 → /me 왕복을 본다."""

import uuid
from datetime import timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.db import get_db
from app.errors import ApiError
from app.security import create_token, decode_token, hash_password

from .conftest import make_user


class FakeDB:
    def __init__(self, user) -> None:
        self.user = user

    async def execute(self, _stmt):
        user = self.user

        class Result:
            def scalar_one_or_none(self):
                return user

        return Result()

    async def get(self, _model, id_):
        return self.user if id_ == self.user.id else None


@pytest.fixture
def seeded(app: FastAPI):
    user = make_user()
    user.pw_hash = hash_password("zenith1234")

    async def fake_get_db():
        yield FakeDB(user)

    app.dependency_overrides[get_db] = fake_get_db
    return user


USER_ID = uuid.uuid4()


def test_token_roundtrip() -> None:
    token = create_token(str(USER_ID), "access", timedelta(minutes=15))
    assert decode_token(token, "access") == USER_ID


def test_refresh_token_is_not_an_access_token() -> None:
    token = create_token(str(USER_ID), "refresh", timedelta(days=14))
    with pytest.raises(ApiError) as e:
        decode_token(token, "access")
    assert e.value.code == "AUTH_INVALID"


def test_malformed_subject_is_401_not_500() -> None:
    token = create_token("not-a-uuid", "access", timedelta(minutes=15))
    with pytest.raises(ApiError) as e:
        decode_token(token, "access")
    assert e.value.status_code == 401
    assert e.value.code == "AUTH_INVALID"


def test_expired_token() -> None:
    token = create_token(str(USER_ID), "access", timedelta(seconds=-1))
    with pytest.raises(ApiError) as e:
        decode_token(token, "access")
    assert e.value.status_code == 401
    assert e.value.code == "AUTH_EXPIRED"


async def test_me_requires_login(client: AsyncClient) -> None:
    r = await client.get("/api/me")
    assert r.status_code == 401
    assert r.json() == {"detail": "로그인이 필요합니다.", "code": "AUTH_REQUIRED"}


async def test_login_sets_httponly_cookies_then_me(client: AsyncClient, seeded) -> None:
    r = await client.post(
        "/api/auth/login", json={"email": "Sujin@zenith.co.kr ", "password": "zenith1234"}
    )
    assert r.status_code == 204
    assert r.content == b""
    cookies = r.headers.get_list("set-cookie")
    assert sorted(c.split("=", 1)[0] for c in cookies) == ["access", "refresh"]
    for c in cookies:
        assert "HttpOnly" in c and "SameSite=lax" in c and "Path=/" in c

    r = await client.get("/api/me")  # 쿠키 항아리가 access 를 다시 보낸다
    assert r.status_code == 200
    assert r.json() == {
        "id": str(seeded.id),
        "name": "김수진",
        "email": "sujin@zenith.co.kr",
        "role": "member",
        "avatar": None,
    }


async def test_cookie_for_another_user_id_is_rejected(client: AsyncClient, seeded) -> None:
    client.cookies.set("access", create_token(str(uuid.uuid4()), "access", timedelta(minutes=15)))
    r = await client.get("/api/me")
    assert r.status_code == 401
    assert r.json()["code"] == "AUTH_INVALID"


async def test_inactive_account_is_locked_out_everywhere(client: AsyncClient, seeded) -> None:
    r = await client.post(
        "/api/auth/login", json={"email": "sujin@zenith.co.kr", "password": "zenith1234"}
    )
    assert r.status_code == 204
    seeded.active = False  # 로그인 뒤 비활성화 — 살아 있는 쿠키도 막혀야 한다
    assert (await client.get("/api/me")).status_code == 401
    assert (await client.post("/api/auth/refresh")).status_code == 401
    r = await client.post(
        "/api/auth/login", json={"email": "sujin@zenith.co.kr", "password": "zenith1234"}
    )
    assert r.status_code == 401
    assert r.json()["code"] == "AUTH_INVALID"


async def test_login_wrong_password(client: AsyncClient, seeded) -> None:
    r = await client.post(
        "/api/auth/login", json={"email": "sujin@zenith.co.kr", "password": "nope"}
    )
    assert r.status_code == 401
    assert r.json()["code"] == "AUTH_INVALID"


async def test_refresh_reissues_and_logout_clears(client: AsyncClient, seeded) -> None:
    await client.post(
        "/api/auth/login", json={"email": "sujin@zenith.co.kr", "password": "zenith1234"}
    )
    r = await client.post("/api/auth/refresh")
    assert r.status_code == 204
    assert len(r.headers.get_list("set-cookie")) == 2

    r = await client.post("/api/auth/logout")
    assert r.status_code == 204
    assert all("Max-Age=0" in c for c in r.headers.get_list("set-cookie"))
    assert (await client.get("/api/me")).status_code == 401
