"""채널 연 사람 (README "설계와 어긋나는 것" 39 · 이슈 #349)

`channels.created_by` — 비공개 채널은 연 사람이 지운다. 이 칸 전의 행은 NULL(멤버인 임원이 지운다).

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-06 18:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: str | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "channels",
        sa.Column(
            "created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True
        ),
    )


def downgrade() -> None:
    op.drop_column("channels", "created_by")
