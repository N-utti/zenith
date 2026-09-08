"""공개 채널 이름 유일 (04 §5 · README "설계와 어긋나는 것" 12)

사전 검사와 commit 사이의 경합은 이 인덱스가 막고 errors.py 의 IntegrityError 핸들러가 409 로 돌려준다.
DM(is_dm) 은 이름이 비어 있어 제외한다.

Revision ID: 7b3e9c2d1f05
Revises: 5d2e7f1a9c04
Create Date: 2026-09-08 14:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7b3e9c2d1f05"
down_revision: str | None = "5d2e7f1a9c04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "uq_channels_public_name",
        "channels",
        ["name"],
        unique=True,
        postgresql_where=sa.text("NOT is_dm"),
    )


def downgrade() -> None:
    op.drop_index("uq_channels_public_name", table_name="channels")
