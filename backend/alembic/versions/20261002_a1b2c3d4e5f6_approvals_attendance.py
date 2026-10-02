"""전자결재·근태 (README "설계와 어긋나는 것" 35·36)

결재 3표(approval_documents·approval_steps·approval_delegations) + 근태 6표(leave_requests·work_arrangements·
overtime_requests·att_corrections·holidays·att_closings). 근태 신청 4표에는 status/approver_id 가 없다 —
13 §7.2 대로 `approval_id` 의 결재 문서가 상태를 든다. 휴가 종류·결재 유형은 코드 상수(표 없음).

Revision ID: a1b2c3d4e5f6
Revises: e4a7c1d9b2f6
Create Date: 2026-10-02 23:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "e4a7c1d9b2f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def _id() -> sa.Column:
    return sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
    )


def _user(name: str = "user_id", nullable: bool = False) -> sa.Column:
    return sa.Column(name, UUID, sa.ForeignKey("users.id"), nullable=nullable)


def _approval() -> sa.Column:
    return sa.Column(
        "approval_id", UUID, sa.ForeignKey("approval_documents.id"), nullable=False, unique=True
    )


def upgrade() -> None:
    op.create_table(
        "approval_documents",
        _id(),
        sa.Column("type_code", sa.Text(), nullable=False),
        _user("drafter_id"),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),
        sa.Column("subject", postgresql.JSONB(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
    )
    op.create_index("idx_apv_docs_drafter", "approval_documents", ["drafter_id", "status"])

    op.create_table(
        "approval_steps",
        _id(),
        sa.Column("doc_id", UUID, sa.ForeignKey("approval_documents.id"), nullable=False),
        sa.Column("step_no", sa.Integer(), nullable=False),
        _user("approver_id"),
        _user("acted_by_id", nullable=True),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("acted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_index("uq_apv_steps_doc_no", "approval_steps", ["doc_id", "step_no"], unique=True)
    op.create_index("idx_apv_steps_approver", "approval_steps", ["approver_id"])

    op.create_table(
        "approval_delegations",
        _id(),
        _user("owner_id"),
        _user("delegate_id"),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("type_code", sa.Text(), nullable=True),
        _created_at(),
    )
    op.create_index("idx_apv_delegations_owner", "approval_delegations", ["owner_id", "start_date"])

    op.create_table(
        "leave_requests",
        _id(),
        _user(),
        sa.Column("type_code", sa.Text(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("days", sa.Float(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        _approval(),
        _created_at(),
    )
    op.create_index("idx_leave_requests_user", "leave_requests", ["user_id", "start_date"])

    op.create_table(
        "work_arrangements",
        _id(),
        _user(),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        _approval(),
        _created_at(),
    )
    op.create_index("idx_work_arrangements_user", "work_arrangements", ["user_id", "start_date"])

    op.create_table(
        "overtime_requests",
        _id(),
        _user(),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.Text(), nullable=False),
        sa.Column("end_time", sa.Text(), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False),
        sa.Column("night_minutes", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        _approval(),
        _created_at(),
    )
    op.create_index("idx_overtime_requests_user", "overtime_requests", ["user_id", "work_date"])

    op.create_table(
        "att_corrections",
        _id(),
        _user(),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("after", postgresql.JSONB(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        _approval(),
        _created_at(),
    )
    op.create_index("idx_att_corrections_user", "att_corrections", ["user_id", "work_date"])

    op.create_table(
        "holidays",
        sa.Column("date", sa.Date(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
    )

    op.create_table(
        "att_closings",
        sa.Column("month", sa.Text(), primary_key=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=False),
        _user("closed_by"),
    )


def downgrade() -> None:
    op.drop_table("att_closings")
    op.drop_table("holidays")
    for table in ("att_corrections", "overtime_requests", "work_arrangements", "leave_requests"):
        op.drop_table(table)  # 인덱스는 표와 같이 지워진다
    op.drop_table("approval_delegations")
    op.drop_table("approval_steps")
    op.drop_table("approval_documents")
