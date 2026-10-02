"""문서 댓글 고치기 (README "설계와 어긋나는 것" 29 · 이슈 #274)

`doc_comments.edited_at` — 본문을 고친 시각. NULL 이면 고친 적 없음(메시지의 `edited_at` 과 같은 뜻).

Revision ID: c8d1f4a7e2b9
Revises: b7c3e9a2d4f1
Create Date: 2026-10-02 20:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8d1f4a7e2b9"
down_revision: str | None = "b7c3e9a2d4f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "doc_comments", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("doc_comments", "edited_at")
