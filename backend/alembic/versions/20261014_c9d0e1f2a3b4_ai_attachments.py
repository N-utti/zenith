"""AI 첨부 (README "설계와 어긋나는 것" 51 · 두 번째 계획 D1)

03 에 없는 표. 올린 파일의 평문을 서버가 뽑아 두고, 원본은 MinIO `ai/{user_id}/{id}/` 에. 7일 뒤 배치가 지운다.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-10-14 22:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9d0e1f2a3b4"
down_revision: str | None = "b8c9d0e1f2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("idx_ai_attachments_user", "ai_attachments", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_ai_attachments_user", table_name="ai_attachments")
    op.drop_table("ai_attachments")
