"""메시지 고치기 (README "설계와 어긋나는 것" 27 · 이슈 #264)

`messages.edited_at` — 본문을 고친 시각. NULL 이면 고친 적 없음. 지우기는 행을 지우므로 칸이 없다.

Revision ID: b7c3e9a2d4f1
Revises: 9d4e2f6a1c58
Create Date: 2026-10-02 18:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c3e9a2d4f1"
down_revision: str | None = "9d4e2f6a1c58"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "edited_at")
