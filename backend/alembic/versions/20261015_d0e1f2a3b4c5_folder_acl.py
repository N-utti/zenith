"""폴더 열람 권한 — `folders.min_role` + `folder_members` (README "설계와 어긋나는 것" 57)

폴더마다 최소 등급(member·lead·exec, 기본 member)과 사람 지정 목록. 문서는 자기 폴더를 따르고, 조상 폴더 중
하나라도 막히면 그 아래는 안 보인다. 임원만 바꾼다. 기존 폴더는 전부 member(지금과 같은 「전원 열람」).

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-10-15 22:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d0e1f2a3b4c5"
down_revision: str | None = "c9d0e1f2a3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "folders",
        sa.Column("min_role", sa.Text(), nullable=False, server_default="member"),
    )
    # 오타 값이 들어가면 fail-closed 라 임원도 못 보고 PATCH 도 404 — DB 에서 막는다(보안 리뷰)
    op.create_check_constraint(
        "ck_folders_min_role", "folders", "min_role IN ('member', 'lead', 'exec')"
    )
    op.create_table(
        "folder_members",
        sa.Column(
            "folder_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("folders.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("folder_members")
    op.drop_constraint("ck_folders_min_role", "folders", type_="check")
    op.drop_column("folders", "min_role")
