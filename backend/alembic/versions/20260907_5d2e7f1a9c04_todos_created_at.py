"""todos.created_at — 오늘 할 일 목록 정렬 기준 (04 §2 · FR-HOM-05)

Revision ID: 5d2e7f1a9c04
Revises: 3c1d9a4f2b7e
Create Date: 2026-09-07 16:30:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5d2e7f1a9c04"
down_revision: str | None = "3c1d9a4f2b7e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "todos",
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("idx_todos_user", "todos", ["user_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_todos_user", table_name="todos")
    op.drop_column("todos", "created_at")
