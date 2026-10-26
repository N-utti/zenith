"""게시글 고정 `posts.pinned` (README "설계와 어긋나는 것" 14 (g), 프론트 #528)

03 에 없는 칸. 기본 false — 기존 글은 전부 고정 아님. 목록은 (pinned desc, created_at desc, id desc).

Revision ID: a2b3c4d5e6f7
Revises: f0a1b2c3d4e5
Create Date: 2026-10-26 11:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2b3c4d5e6f7"
down_revision: str | None = "f0a1b2c3d4e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "posts",
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("posts", "pinned")
