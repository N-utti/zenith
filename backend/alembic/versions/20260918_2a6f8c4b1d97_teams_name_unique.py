"""팀 이름 유일 (04 §9 · README "설계와 어긋나는 것" 18(b))

팀을 만드는 경로가 생기면서 같은 이름의 팀이 둘 생길 수 있게 됐다 — 배정 화면에서 구분이 안 된다.
공개 채널 이름(7b3e9c2d1f05)과 같은 방식: 사전 검사와 commit 사이의 경합은 이 인덱스가 막고
errors.py 의 IntegrityError 핸들러가 409 로 돌려준다. 03 ERD 에는 없는 제약이다.

**배포 전 사람 확인**(루트 CLAUDE.md §안전 가드레일) — 이미 같은 이름의 팀이 있으면 이 upgrade 가 실패하고,
compose 의 `alembic upgrade head && uvicorn` 체인 때문에 api 가 크래시 루프에 빠진다(전면 장애):

    select name, count(*) from teams group by name having count(*) > 1;   -- 0행이어야 한다
    select version_num from alembic_version;                              -- 한 번에 몇 개가 올라가는지

0행이 아니면 소속(`users.team_id`)을 한쪽으로 옮기고 중복 팀을 지운 뒤 배포한다(그 정리는 데이터 삭제라
따로 사람 확인). downgrade 는 인덱스만 떨구므로 안전하지만, 되돌린 사이에 중복이 생기면 재-upgrade 가
같은 이유로 실패한다.

Revision ID: 2a6f8c4b1d97
Revises: 9c4f1a7d3e26
Create Date: 2026-09-18 10:00:00

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2a6f8c4b1d97"
down_revision: str | None = "9c4f1a7d3e26"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("uq_teams_name", "teams", ["name"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_teams_name", table_name="teams")
