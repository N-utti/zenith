"""CRM 담당자·안건 지우기, 지운 기관 되살리기, 가져오기 되돌리기 (README "설계와 어긋나는 것" 32 추가)

- `crm_imports` — 반영된 CSV 가져오기 한 번(가져온 사람·시각·되돌린 시각).
- `crm_orgs.deleted_reason`(지운 기관 목록) · `crm_orgs.import_id`.
- `crm_contacts.created_by`·`deleted_at`·`import_id` — 기존 행의 created_by 는 NULL(임원만 지운다).
- `crm_deals.deleted_at`.

Revision ID: b5c8e1f3a7d2
Revises: b7c8d9e0f1a2
Create Date: 2026-10-02 23:30:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5c8e1f3a7d2"
down_revision: str | None = "b7c8d9e0f1a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "crm_imports",
        sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_crm_imports_user", "crm_imports", ["user_id", sa.text("created_at DESC")])
    op.add_column("crm_orgs", sa.Column("deleted_reason", sa.Text(), nullable=True))
    op.add_column(
        "crm_orgs", sa.Column("import_id", UUID, sa.ForeignKey("crm_imports.id"), nullable=True)
    )
    op.add_column(
        "crm_contacts", sa.Column("created_by", UUID, sa.ForeignKey("users.id"), nullable=True)
    )
    op.add_column(
        "crm_contacts", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "crm_contacts", sa.Column("import_id", UUID, sa.ForeignKey("crm_imports.id"), nullable=True)
    )
    op.add_column("crm_deals", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # 지운 표시·가져오기 기록이 사라진다 — 실행 전에 사람 확인(루트 CLAUDE.md §안전 가드레일)
    op.drop_column("crm_deals", "deleted_at")
    op.drop_column("crm_contacts", "import_id")
    op.drop_column("crm_contacts", "deleted_at")
    op.drop_column("crm_contacts", "created_by")
    op.drop_column("crm_orgs", "import_id")
    op.drop_column("crm_orgs", "deleted_reason")
    op.drop_table("crm_imports")
