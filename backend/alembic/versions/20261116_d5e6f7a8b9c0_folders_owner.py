"""개인 폴더 `folders.owner_id` (README "설계와 어긋나는 것" 72)

03 에 없는 칸. NULL = 지금까지의 폴더(등급·사람 지정을 따른다). 값이 있으면 그 사람만 본다(임원도 못 본다).

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-11-16 17:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5e6f7a8b9c0"
down_revision: str | None = "c4d5e6f7a8b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "folders",
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
    )


def downgrade() -> None:
    # 주의: 되돌리면 개인 폴더가 전원 열람이 된다 — 실행 전에 사람이 확인한다(루트 CLAUDE.md 안전 가드레일)
    op.drop_column("folders", "owner_id")
