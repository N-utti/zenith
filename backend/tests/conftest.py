import asyncio
import os
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

# JWT_SECRET 은 기본값이 없다(app/config.py). 테스트는 .env 없이도 돌아야 하므로 여기서 먼저 채운다.
os.environ.setdefault("JWT_SECRET", "test-only-secret-0123456789abcdef0123456789abcdef")

import alembic.command  # noqa: E402
import alembic.config  # noqa: E402
import asyncpg  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import get_db  # noqa: E402
from app.deps import current_user  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Team, User  # noqa: E402
from app.security import hash_password  # noqa: E402

BACKEND = Path(__file__).resolve().parent.parent
PASSWORD = "zenith1234"
PW_HASH = hash_password(PASSWORD)  # argon2 는 일부러 느리다 — 한 번만 만든다


@pytest.fixture
def app() -> FastAPI:
    return create_app()


def _client(app: FastAPI) -> AsyncClient:
    # https: Secure 쿠키(기본값)가 쿠키 항아리에서 되돌아오게.
    return AsyncClient(transport=ASGITransport(app=app), base_url="https://test")


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with _client(app) as c:
        yield c


@pytest.fixture
def make_client(app: FastAPI) -> Callable[[], AsyncClient]:
    """같은 앱에 붙는 두 번째 브라우저 — 세션이 여러 개일 때."""
    return lambda: _client(app)


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


# ── 실제 Postgres 위의 테스트 ────────────────────────────────────────────
# zenith_test DB 를 만들고 마이그레이션한 뒤, 테스트마다 트랜잭션을 세이브포인트로 감싸 되돌린다.


@pytest.fixture(scope="session")
def test_db_url() -> str:
    url = make_url(settings.database_url).set(database="zenith_test")

    async def prepare() -> None:
        try:
            conn = await asyncpg.connect(
                host=url.host,
                port=url.port or 5432,
                user=url.username,
                password=url.password,
                database="postgres",
                timeout=3,
            )
        except (OSError, asyncpg.PostgresError, TimeoutError) as e:
            pytest.skip(f"Postgres 에 붙을 수 없어 DB 테스트를 건너뛴다: {e}")
        try:
            exists = await conn.fetchval(
                "select 1 from pg_database where datname = $1", url.database
            )
            if not exists:
                await conn.execute(f'create database "{url.database}"')
        finally:
            await conn.close()

    asyncio.run(prepare())
    rendered = url.render_as_string(hide_password=False)
    cfg = alembic.config.Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", rendered.replace("%", "%%"))
    alembic.command.upgrade(cfg, "head")
    return rendered


@pytest.fixture
async def db(test_db_url: str) -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(test_db_url)
    async with engine.connect() as conn:
        trans = await conn.begin()
        session = AsyncSession(
            bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
        )
        try:
            yield session
        finally:
            await session.close()
            await trans.rollback()
    await engine.dispose()


@pytest.fixture
async def app_db(app: FastAPI, db: AsyncSession) -> AsyncSession:
    """앱의 get_db 를 테스트 세션으로 바꿔 끼운다. 앱이 commit 해도 바깥 트랜잭션은 끝에 롤백된다."""

    async def override() -> AsyncIterator[AsyncSession]:
        yield db

    app.dependency_overrides[get_db] = override
    return db


@dataclass
class Users:
    member: User
    lead: User
    exec: User
    team: Team


@pytest.fixture
async def users(app_db: AsyncSession) -> Users:
    """07 §1: 등급별 계정 3개. 비밀번호는 전부 PASSWORD."""
    team = Team(name="개발팀")
    app_db.add(team)
    await app_db.flush()

    def mk(name: str, email: str, role: str) -> User:
        return User(
            name=name, email=email, pw_hash=PW_HASH, role=role, team_id=team.id, active=True
        )

    member = mk("김수진", "sujin@zenith.co.kr", "member")
    lead = mk("박동현", "donghyun@zenith.co.kr", "lead")
    exec_ = mk("최재호", "jaeho@zenith.co.kr", "exec")
    app_db.add_all([member, lead, exec_])
    await app_db.flush()
    team.lead_id = lead.id
    await app_db.flush()
    for row in (member, lead, exec_, team):
        await app_db.refresh(row)  # 서버 기본값(created_at 등)을 읽어 둔다
    return Users(member, lead, exec_, team)


async def login(client: AsyncClient, email: str, password: str = PASSWORD):
    return await client.post("/api/auth/login", json={"email": email, "password": password})


def csrf(client: AsyncClient) -> dict[str, str]:
    """상태 변경 요청에 붙일 이중 제출 헤더 — 브라우저의 lib/api.ts 가 하는 일."""
    return {"X-CSRF-Token": client.cookies.get("csrf") or ""}
