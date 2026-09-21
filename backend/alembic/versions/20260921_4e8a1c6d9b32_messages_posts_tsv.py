"""messages·posts 에 검색용 tsv 생성 컬럼 + GIN (04 §7 · README "설계와 어긋나는 것" 13(d))

⌘K 검색이 to_tsvector 를 즉석에서 만들어 순차 스캔하던 것을, DB 가 본문에서 만들어 저장하는 컬럼으로 바꾼다.
생성 컬럼이라 앱의 쓰기 경로는 바뀌지 않고, 기존 행도 이 마이그레이션이 채운다.

운영 메모: ADD COLUMN … STORED 는 표를 다시 쓰며 그동안 ACCESS EXCLUSIVE 잠금을 쥔다(메시지 6만 건에 1초 남짓).
api 가 `alembic upgrade head && uvicorn` 으로 뜨므로 그 사이 api 요청은 없다. 다만 `backup` 컨테이너의 pg_dump 와
겹치면 덤프가 끝날 때까지 잠금을 기다린다(작은 DB 라 수 초). 실패해도 한 트랜잭션이라 부분 상태 없이 되돌아가고,
재기동이 다시 시도한다.

Revision ID: 4e8a1c6d9b32
Revises: 2a6f8c4b1d97
Create Date: 2026-09-21 17:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4e8a1c6d9b32"
down_revision: str | None = "2a6f8c4b1d97"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column(
            "tsv",
            postgresql.TSVECTOR(),
            sa.Computed("to_tsvector('simple', body)", persisted=True),
            nullable=True,
        ),
    )
    op.create_index("idx_messages_tsv", "messages", ["tsv"], postgresql_using="gin")
    op.add_column(
        "posts",
        sa.Column(
            "tsv",
            postgresql.TSVECTOR(),
            sa.Computed(
                "to_tsvector('simple', title) || to_tsvector('simple', body)", persisted=True
            ),
            nullable=True,
        ),
    )
    op.create_index("idx_posts_tsv", "posts", ["tsv"], postgresql_using="gin")


def downgrade() -> None:
    op.drop_index("idx_posts_tsv", table_name="posts", postgresql_using="gin")
    op.drop_column("posts", "tsv")
    op.drop_index("idx_messages_tsv", table_name="messages", postgresql_using="gin")
    op.drop_column("messages", "tsv")
