"""게시글 첨부 업로드 기록부 (README "설계와 어긋나는 것" 34 · 이슈 #309)

`board_uploads` — file_id 마다 어느 게시판에 누가 올렸나. 글에 새로 싣는 url 은 올린 사람 본인 것만 받는다.
표가 생기기 전에 올린 파일은 행이 없다 — 이미 글에 실린 것은 그대로 받아지고, 새로 붙이려면 다시 올린다.

Revision ID: c3d4e5f6a7b8
Revises: b5c8e1f3a7d2
Create Date: 2026-10-06 10:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a7b8"
down_revision: str | None = "b5c8e1f3a7d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "board_uploads",
        sa.Column("file_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "board_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("boards.id"), nullable=False
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
    op.drop_table("board_uploads")
