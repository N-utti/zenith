"""협업 공간 업무에 시작일 `project_tasks.start_date` (README "설계와 어긋나는 것" 40, 프론트 #520)

일정 탭의 간트 막대가 시작일부터 마감일까지라 마감일만으로는 부족하다. 기존 행은 NULL — 프론트는 한쪽만 있으면
하루짜리 막대로 그린다.

Revision ID: f0a1b2c3d4e5
Revises: d0e1f2a3b4c5
Create Date: 2026-10-26 10:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f0a1b2c3d4e5"
down_revision: str | None = "d0e1f2a3b4c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("project_tasks", sa.Column("start_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("project_tasks", "start_date")
