"""개인 일정 (README "설계와 어긋나는 것" 31 · 홈 캘린더 /me/events)

`events` — 03 에 없는 표. 홈 캘린더의 개인 일정(`/me/todos` 와 같은 꼴). 시각은 "HH:MM" 문자열(없으면 NULL).

Revision ID: d9e2a5b8c3f4
Revises: c8d1f4a7e2b9
Create Date: 2026-10-02 21:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9e2a5b8c3f4"
down_revision: str | None = "c8d1f4a7e2b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("time", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("idx_events_user_date", "events", ["user_id", "date"])


def downgrade() -> None:
    op.drop_index("idx_events_user_date", table_name="events")
    op.drop_table("events")
