"""Alembic 실행 환경 — 비동기 엔진(asyncpg)으로 마이그레이션을 돌린다."""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

import app.models  # noqa: F401 — Base.metadata 에 테이블을 등록한다
from alembic import context
from app.config import settings
from app.db import Base

config = context.config
if config.config_file_name is not None:
    # 기본값(True)은 이미 만들어진 로거를 전부 꺼 버린다 — 같은 프로세스에서 마이그레이션을 돌리면(테스트)
    # 앱 로그(zenith.*)가 그 뒤로 말없이 사라진다.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# 테스트가 다른 DB(zenith_test)를 넘길 수 있게 ini 값이 있으면 그것을, 없으면 설정을 쓴다.
# configparser 보간 때문에 % 는 %% 로.
if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
