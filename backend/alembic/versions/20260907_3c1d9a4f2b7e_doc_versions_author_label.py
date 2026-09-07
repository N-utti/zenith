"""doc_versions author/label + 버전·댓글 조회 인덱스 (04 §3 문서 API)

Revision ID: 3c1d9a4f2b7e
Revises: 7879acd6512d
Create Date: 2026-09-07 14:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3c1d9a4f2b7e"
down_revision: str | None = "7879acd6512d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("doc_versions", sa.Column("author_id", sa.UUID(), nullable=True))
    op.add_column("doc_versions", sa.Column("label", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_doc_versions_author_id_users", "doc_versions", "users", ["author_id"], ["id"]
    )
    op.create_index(
        "idx_doc_versions_doc",
        "doc_versions",
        ["doc_id", sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_index("idx_doc_comments_doc", "doc_comments", ["doc_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_doc_comments_doc", table_name="doc_comments")
    op.drop_index("idx_doc_versions_doc", table_name="doc_versions")
    op.drop_constraint("fk_doc_versions_author_id_users", "doc_versions", type_="foreignkey")
    op.drop_column("doc_versions", "label")
    op.drop_column("doc_versions", "author_id")
