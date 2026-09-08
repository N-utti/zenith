from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


def session_scope() -> AsyncSession:
    """요청 밖(WebSocket 핸들러)에서 짧게 열고 닫는 세션. 테스트는 각 모듈의 이 이름을 바꿔 끼운다."""
    return SessionLocal()
