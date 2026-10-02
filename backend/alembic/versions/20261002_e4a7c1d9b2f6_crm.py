"""CRM 주소록·안건 (README "설계와 어긋나는 것" 32 · /crm/*)

03 에 없는 표 9개 — 기관(`crm_orgs`, soft delete)·사내 창구·담당자(개인정보 삭제 `erased`)·이직 이력·
안건(`version` 낙관적 잠금)·안건 이력·활동(soft delete)·활동 참석자(외부·사내). 프론트 목(`mocks/crmDb.ts`) 역설계.

Revision ID: e4a7c1d9b2f6
Revises: f2a3b4c5d6e7
Create Date: 2026-10-02 23:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4a7c1d9b2f6"
down_revision: str | None = "f2a3b4c5d6e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def _id() -> sa.Column:
    return sa.Column("id", UUID, primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _at(name: str = "created_at", nullable: bool = False) -> sa.Column:
    return sa.Column(
        name,
        sa.DateTime(timezone=True),
        nullable=nullable,
        server_default=None if nullable else sa.text("now()"),
    )


def _text(name: str, default: str | None = None, nullable: bool = False) -> sa.Column:
    return sa.Column(name, sa.Text(), nullable=nullable, server_default=default)


def _fk(name: str, target: str, nullable: bool = False, pk: bool = False) -> sa.Column:
    return sa.Column(name, UUID, sa.ForeignKey(target), nullable=nullable, primary_key=pk)


def upgrade() -> None:
    op.create_table(
        "crm_orgs",
        _id(),
        _text("name"),
        _text("name_norm"),
        _text("org_type"),
        _text("memo", ""),
        _at(),
        _at("deleted_at", nullable=True),
    )
    op.create_table(
        "crm_org_owners",
        _fk("org_id", "crm_orgs.id", pk=True),
        _fk("user_id", "users.id", pk=True),
    )
    op.create_table(
        "crm_contacts",
        _id(),
        _fk("org_id", "crm_orgs.id"),
        _text("name"),
        _text("title", ""),
        _text("phone", ""),
        _text("email", ""),
        _text("memo", ""),
        sa.Column("erased", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        _at(),
    )
    op.create_index("idx_crm_contacts_org", "crm_contacts", ["org_id"])
    op.create_table(
        "crm_contact_moves",
        _id(),
        _fk("contact_id", "crm_contacts.id"),
        _fk("from_org_id", "crm_orgs.id"),
        _fk("to_org_id", "crm_orgs.id"),
        _at("moved_at"),
    )
    op.create_index("idx_crm_contact_moves_contact", "crm_contact_moves", ["contact_id"])
    op.create_table(
        "crm_deals",
        _id(),
        _text("kind"),
        _text("name"),
        _fk("org_id", "crm_orgs.id"),
        _fk("owner_id", "users.id", nullable=True),
        _text("stage"),
        sa.Column("amount_krw", sa.BigInteger(), nullable=True),
        sa.Column("target_date", sa.Date(), nullable=True),
        _text("next_action", ""),
        sa.Column("next_action_due", sa.Date(), nullable=True),
        _text("status", "open"),
        _text("drop_reason", nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        _at("closed_at", nullable=True),
        _at(),
    )
    op.create_index("idx_crm_deals_org", "crm_deals", ["org_id"])
    op.create_table(
        "crm_deal_events",
        _id(),
        _fk("deal_id", "crm_deals.id"),
        _fk("actor_id", "users.id"),
        _text("from_stage", nullable=True),
        _text("to_stage"),
        _text("action"),
        _text("reason", nullable=True),
        _at(),
    )
    op.create_index(
        "idx_crm_deal_events_deal", "crm_deal_events", ["deal_id", sa.text("created_at DESC")]
    )
    op.create_table(
        "crm_activities",
        _id(),
        _text("kind"),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        _fk("org_id", "crm_orgs.id"),
        _fk("deal_id", "crm_deals.id", nullable=True),
        _fk("author_id", "users.id"),
        _text("body"),
        _at(),
        _at("deleted_at", nullable=True),
    )
    op.create_index(
        "idx_crm_activities_org", "crm_activities", ["org_id", sa.text("occurred_at DESC")]
    )
    op.create_index("idx_crm_activities_deal", "crm_activities", ["deal_id"])
    op.create_table(
        "crm_activity_contacts",
        _fk("activity_id", "crm_activities.id", pk=True),
        _fk("contact_id", "crm_contacts.id", pk=True),
    )
    op.create_table(
        "crm_activity_users",
        _fk("activity_id", "crm_activities.id", pk=True),
        _fk("user_id", "users.id", pk=True),
    )


def downgrade() -> None:
    # 표를 지우면 CRM 데이터가 전부 사라진다 — 실행 전에 사람 확인(루트 CLAUDE.md §안전 가드레일)
    for table in (
        "crm_activity_users",
        "crm_activity_contacts",
        "crm_activities",
        "crm_deal_events",
        "crm_deals",
        "crm_contact_moves",
        "crm_contacts",
        "crm_org_owners",
        "crm_orgs",
    ):
        op.drop_table(table)  # 인덱스는 표와 함께 사라진다
