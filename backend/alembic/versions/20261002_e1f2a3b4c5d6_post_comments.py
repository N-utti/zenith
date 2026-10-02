"""게시글 댓글 (README "설계와 어긋나는 것" 33 · 이슈 #292)

`post_comments` — 03 에 없는 표. 문서 댓글(`doc_comments`)에서 블록 칸을 뺀 모양. 글을 지우면 DB 가 같이 지운다
(ON DELETE CASCADE — 글 삭제는 행 삭제라 휴지통이 없다).

Revision ID: e1f2a3b4c5d6
Revises: d9e2a5b8c3f4
Create Date: 2026-10-02 22:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1f2a3b4c5d6"
down_revision: str | None = "d9e2a5b8c3f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "post_comments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "post_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("posts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_post_comments_post", "post_comments", ["post_id", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_post_comments_post", table_name="post_comments")
    op.drop_table("post_comments")
