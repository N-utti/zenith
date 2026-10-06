"""채팅 첨부 업로드 기록부 (README "설계와 어긋나는 것" 15(h) · 이슈 #324)

`channel_uploads` — board_uploads(c3d4e5f6a7b8)와 같다. 메시지에 싣는 url 은 올린 사람 본인 것만 받는다.
표가 생기기 전에 올린 파일은 행이 없다 — 이미 메시지에 실린 것은 그대로 받아지고, 새로 보내려면 다시 올린다.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-10-06 14:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: str | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "channel_uploads",
        sa.Column("file_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "channel_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("channels.id"),
            nullable=False,
        ),
        sa.Column(
            "uploader_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False
        ),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("channel_uploads")
