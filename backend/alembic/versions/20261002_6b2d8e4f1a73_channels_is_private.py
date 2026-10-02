"""비공개 채널 (README "설계와 어긋나는 것" 12 · 이슈 #221)

`channels.is_private` — 고른 사람만 멤버인 채널. 공개 채널 이름 유일 인덱스(7b3e9c2d1f05)의 조건을
`NOT is_dm` 에서 `NOT is_dm AND NOT is_private` 로 좁힌다: 비공개 채널과 같은 이름의 공개 채널이 409 로
막히면 안 보이는 채널이 있다는 사실이 샌다. 기존 행은 전부 공개(false)라 upgrade 가 실패할 데이터는 없다.

downgrade 는 컬럼을 떨구고 인덱스를 되돌린다 — 그 사이 같은 이름의 비공개 채널이 생겼으면 되돌린 인덱스
만들기가 실패한다(비공개 채널은 그때 공개 채널이 되므로 어차피 데이터 확인이 먼저다).

Revision ID: 6b2d8e4f1a73
Revises: 4e8a1c6d9b32
Create Date: 2026-10-02 10:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6b2d8e4f1a73"
down_revision: str | None = "4e8a1c6d9b32"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "channels",
        sa.Column("is_private", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.drop_index("uq_channels_public_name", table_name="channels")
    op.create_index(
        "uq_channels_public_name",
        "channels",
        ["name"],
        unique=True,
        postgresql_where=sa.text("NOT is_dm AND NOT is_private"),
    )


def downgrade() -> None:
    op.drop_index("uq_channels_public_name", table_name="channels")
    op.create_index(
        "uq_channels_public_name",
        "channels",
        ["name"],
        unique=True,
        postgresql_where=sa.text("NOT is_dm"),
    )
    op.drop_column("channels", "is_private")
