"""파일 기록부 `files` (README "설계와 어긋나는 것" 16 · 이슈 #224·#226)

`POST /files` 가 MinIO 에만 넣고 감사 기록만 남겨서 이름·올린 사람·어느 문서인지가 서버에 없었다 — 내려받기
이름을 문서 본문(같이 편집하는 사람이 바꿀 수 있다)에 기대야 했고 자료실 목록을 만들 수 없었다. 03 에 없는 표.
기존 오브젝트(2026-10-02 이전 그림)는 행이 없고 백필하지 않는다 — 이름이 어디에도 없다.

Revision ID: 8c3f1d2e9b47
Revises: 6b2d8e4f1a73
Create Date: 2026-10-02 14:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8c3f1d2e9b47"
down_revision: str | None = "6b2d8e4f1a73"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "files",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("uploader_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("doc_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["uploader_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["doc_id"], ["documents.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_files_doc", "files", ["doc_id"])


def downgrade() -> None:
    op.drop_index("idx_files_doc", table_name="files")
    op.drop_table("files")
