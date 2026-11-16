"""근태 담당자·대표, 결근 확정 (README "설계와 어긋나는 것" 76)

03 에 없는 것. `workspaces.attendance_manager_id`·`ceo_id`(둘 다 NULL = 예전 규칙 그대로)와 `att_absences`.

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-11-16 20:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e6f7a8b9c0d1"
down_revision: str | None = "d5e6f7a8b9c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspaces",
        sa.Column("attendance_manager_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.add_column(
        "workspaces", sa.Column("ceo_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True)
    )
    op.create_table(
        "att_absences",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("set_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.UniqueConstraint("user_id", "work_date", name="uq_att_absences_user_date"),
    )


def downgrade() -> None:
    # 주의: 되돌리면 결근 확정 기록이 지워진다 — 실행 전에 사람이 확인한다(루트 CLAUDE.md 안전 가드레일)
    op.drop_table("att_absences")
    op.drop_column("workspaces", "ceo_id")
    op.drop_column("workspaces", "attendance_manager_id")
