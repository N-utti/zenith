"""AI 대화 저장 — `ai_messages.created_at` (README "설계와 어긋나는 것" 41)

03 의 ai_messages 에는 순서 칸이 없었다. 대화를 이어 보내려면 메시지 순서가 필요하다.
칸 전의 행은 없다(대화 저장이 이번에 처음 켜진다).

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-10-12 14:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: str | None = "f6a7b8c9d0e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ai_messages",
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("idx_ai_messages_session", "ai_messages", ["session_id", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_ai_messages_session", table_name="ai_messages")
    op.drop_column("ai_messages", "created_at")
