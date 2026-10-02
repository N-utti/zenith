"""DM 숨기기 (README "설계와 어긋나는 것" 26 · 이슈 #268)

`channel_members.hidden_at` — 내 목록에서 그 방을 치운 시각. NULL 이면 보인다. 새 메시지가 오거나
같은 상대와 DM 을 다시 열면 NULL 로 돌아간다. 멤버십 자체는 그대로다(DM 은 두 사람으로 고정이라 뺄 수 없다).

Revision ID: 9d4e2f6a1c58
Revises: 8c3f1d2e9b47
Create Date: 2026-10-02 16:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9d4e2f6a1c58"
down_revision: str | None = "8c3f1d2e9b47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "channel_members", sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("channel_members", "hidden_at")
