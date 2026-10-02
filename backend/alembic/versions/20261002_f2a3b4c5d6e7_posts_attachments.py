"""게시글 첨부 (README "설계와 어긋나는 것" 34 · 이슈 #299)

`posts.attachments` JSONB — 채팅 `messages.attachments` 와 같은 모양 `[{url, name, size, content_type}]`.
오브젝트는 MinIO `boards/{board_id}/{file_id}/{name}` 에 있고 여기는 글에 실린 목록만.

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-10-02 23:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a3b4c5d6e7"
down_revision: str | None = "e1f2a3b4c5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("posts", sa.Column("attachments", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("posts", "attachments")
