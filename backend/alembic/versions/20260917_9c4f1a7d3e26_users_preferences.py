"""사용자 환경설정 한 칸 (이슈 #81 · README "설계와 어긋나는 것" 17)

알림 종류별 수신 여부와 시작 화면. null 이면 기본값(전부 켜짐, "/")이라 백필하지 않는다 — 15명 규모에서
종류가 늘어나기 전까지 별도 테이블을 두지 않는다.

Revision ID: 9c4f1a7d3e26
Revises: 7b3e9c2d1f05
Create Date: 2026-09-17 11:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9c4f1a7d3e26"
down_revision: str | None = "7b3e9c2d1f05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("preferences", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "preferences")
