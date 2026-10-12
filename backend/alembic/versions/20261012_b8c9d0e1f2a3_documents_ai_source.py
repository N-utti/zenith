"""문서별 「AI 근거로 쓰기」 스위치 — `documents.ai_source` (README "설계와 어긋나는 것" 43)

기본 true(사람이 쓴 문서). AI 답변을 저장한 문서는 만들 때 false 로 들어온다(프론트).
AI 검색 도구는 true 인 문서만 근거로 쓴다 — 「AI 에 보내지 않을 문서」를 빼는 수단이기도 하다.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-10-12 17:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8c9d0e1f2a3"
down_revision: str | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("ai_source", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("documents", "ai_source")
