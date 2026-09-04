import os
import uuid
from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

# JWT_SECRET 은 기본값이 없다(app/config.py). 테스트는 .env 없이도 돌아야 하므로 여기서 먼저 채운다.
os.environ.setdefault("JWT_SECRET", "test-only-secret-0123456789abcdef0123456789abcdef")

from app.deps import current_user  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import User  # noqa: E402


@pytest.fixture
def app() -> FastAPI:
    return create_app()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    # https: Secure 쿠키(기본값)가 쿠키 항아리에서 되돌아오게.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as c:
        yield c


def make_user(role: str = "member") -> User:
    return User(
        id=uuid.uuid4(),
        name="김수진",
        email="sujin@zenith.co.kr",
        pw_hash="",
        role=role,
        avatar=None,
        active=True,
    )


@pytest.fixture
def member(app: FastAPI) -> User:
    """DB 없이 로그인 상태를 만든다 — current_user 를 통째로 바꿔 끼운다."""
    user = make_user()
    app.dependency_overrides[current_user] = lambda: user
    return user
