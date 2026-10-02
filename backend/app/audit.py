"""감사 기록 (04 §9 /admin/audit · 11 §7.4). 쓰기만 있고 수정·삭제는 없다. commit 은 호출한 쪽이 한다."""

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import (
    HTTPConnection,  # Request 와 WebSocket 의 공통 부모 — headers·client 만 쓴다
)

from app.models import AuditEvent


def client_ip(request: HTTPConnection) -> str | None:
    # Caddy 뒤에서는 X-Forwarded-For 의 첫 값이 실제 클라이언트다.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def record(
    db: AsyncSession,
    kind: str,
    *,
    request: HTTPConnection | None = None,
    actor_id: uuid.UUID | None = None,
    target_id: uuid.UUID | None = None,
    detail: dict | None = None,
    at: datetime | None = None,
) -> None:
    """`at` 을 안 주면 DB 의 now()(트랜잭션 시작 시각). 순서가 뜻을 갖는 기록(월 마감 이력)은 앱 시각을 준다."""
    db.add(
        AuditEvent(
            kind=kind,
            **({"at": at} if at else {}),  # None 을 넘기면 server_default 대신 NULL 이 들어간다
            actor_id=actor_id,
            target_id=target_id,
            ip=client_ip(request) if request else None,
            user_agent=request.headers.get("user-agent") if request else None,
            detail=detail,
        )
    )


async def count_since(
    db: AsyncSession,
    kind: str,
    since: datetime,
    *,
    ip: str | None = None,
    **detail_match: str,
) -> int:
    """since 이후 kind 기록 수. ip 는 컬럼, detail_match 는 detail JSON 의 최상위 문자열 필드와 비교한다."""
    stmt = (
        select(func.count())
        .select_from(AuditEvent)
        .where(AuditEvent.kind == kind, AuditEvent.at >= since)
    )
    if ip is not None:
        stmt = stmt.where(AuditEvent.ip == ip)
    for key, value in detail_match.items():
        stmt = stmt.where(AuditEvent.detail[key].astext == value)
    return (await db.execute(stmt)).scalar_one()
