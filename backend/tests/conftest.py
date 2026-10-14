import asyncio
import os
import socket
import uuid
from collections.abc import AsyncIterator, Callable, Iterator
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

from app import storage  # noqa: E402
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
    # 여러 세션이 동시에 돌 때 DB 이름을 비킨다(ZENITH_TEST_DB). 테스트는 DB 를 만들고 마이그레이션하므로
    # zenith_test* 가 아닌 이름(실 DB)은 거부한다.
    name = os.environ.get("ZENITH_TEST_DB", "zenith_test")
    if not name.startswith("zenith_test"):
        pytest.fail(f"ZENITH_TEST_DB 는 zenith_test 로 시작해야 한다: {name!r}")
    url = make_url(settings.database_url).set(database=name)

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


def share_session(app: FastAPI, app_db: AsyncSession, monkeypatch, module) -> None:
    """WebSocket 핸들러(realtime/*)는 요청 의존성이 아니라 `session_scope()` 로 자기 세션을 짧게 연다 —
    테스트 트랜잭션 안의 세션을 대신 쓰게 한다. 공유 세션은 한 태스크씩(락) — 서버 쪽 처리와 테스트의
    HTTP 호출이 겹치면 세션이 깨진다."""
    lock = asyncio.Lock()

    class Scope:
        async def __aenter__(self):
            await lock.acquire()
            return app_db

        async def __aexit__(self, *exc):
            lock.release()
            return False  # 닫지 않는다 — 트랜잭션은 conftest 가 끝에 되돌린다

    async def locked_get_db():
        async with lock:
            yield app_db

    monkeypatch.setattr(module, "session_scope", lambda: Scope())
    app.dependency_overrides[get_db] = locked_get_db


async def login(client: AsyncClient, email: str, password: str = PASSWORD):
    return await client.post("/api/auth/login", json={"email": email, "password": password})


def csrf(client: AsyncClient) -> dict[str, str]:
    """상태 변경 요청에 붙일 이중 제출 헤더 — 브라우저의 lib/api.ts 가 하는 일."""
    return {"X-CSRF-Token": client.cookies.get("csrf") or ""}


@pytest.fixture
def minio_bucket(monkeypatch) -> Iterator[str]:
    """테스트 전용 버킷 — 끝나면 이 테스트가 만든 오브젝트를 지운다."""
    host, _, port = settings.minio_endpoint.partition(":")
    try:
        socket.create_connection((host, int(port or 9000)), timeout=1).close()
    except OSError as e:
        if os.getenv("CI"):
            pytest.fail(f"CI 는 MinIO 를 띄운다(ci.yml) — 붙을 수 없다: {e}")
        pytest.skip(f"MinIO 에 붙을 수 없어 첨부 테스트를 건너뛴다: {e}")
    bucket = "zenith-test"
    monkeypatch.setattr(settings, "minio_bucket", bucket)
    storage._ensured.discard(bucket)
    storage._client.cache_clear()
    yield bucket
    client = storage._client()
    if client.bucket_exists(bucket):
        for obj in list(client.list_objects(bucket, recursive=True)):
            client.remove_object(bucket, obj.object_name)


@pytest.fixture(autouse=True)
def _embedding_off(monkeypatch):
    """개발 PC 의 .env 에 EMBED_URL·AI_RULES_FOLDER 가 있어도 테스트는 실제 Ollama 를 부르거나 규정을 넣지 않는다 — 켜는 테스트는 test_embed 의
    fake_embedding 이 이 뒤에 덮어쓴다."""
    monkeypatch.setattr(settings, "embed_url", None)
    monkeypatch.setattr(settings, "ai_rules_folder", None)  # 규정 폴더(README 46)도 — 켜는 테스트가 직접 넣는다
