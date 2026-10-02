"""개발 시드. 03-ERD §2.5(워크스페이스 1 · 게시판 3 · 기본 채널 2) + 조직 1팀 + 데모 계정 3명.

데모 계정·비밀번호는 프론트 목(frontend/src/mocks/accounts.ts)과 같다. 몇 번 실행해도 결과가 같다(멱등).
2026 법정공휴일도 깐다(프론트 목 holidaysDb.ts 와 같은 목록) — 실제로는 임원이 관보 확정 뒤 연초에 등록한다.
휴가 종류·결재 유형은 표가 아니라 코드 상수다(routers/attendance.py·approvals.py).
"""

import asyncio
import os
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Base, SessionLocal
from app.models import Board, Channel, Folder, Holiday, Team, User, Workspace
from app.routers import channels
from app.security import hash_password

PASSWORD = os.environ.get("SEED_PASSWORD", "zenith1234")
BOARDS = [("전체공지", "member"), ("팀장 회의록", "lead"), ("경영 보고", "exec")]
CHANNELS = ["공지사항", "일반"]
ROOT_FOLDER = "회사 위키"
HOLIDAYS_2026 = {
    "2026-01-01": "신정",
    "2026-02-16": "설날 연휴",
    "2026-02-17": "설날",
    "2026-02-18": "설날 연휴",
    "2026-03-02": "삼일절 대체공휴일",
    "2026-05-05": "어린이날",
    "2026-05-25": "부처님오신날 대체공휴일",
    "2026-06-03": "지방선거",
    "2026-08-17": "광복절 대체공휴일",
    "2026-09-24": "추석 연휴",
    "2026-09-25": "추석",
    "2026-10-05": "개천절 대체공휴일",
    "2026-10-09": "한글날",
    "2026-12-25": "성탄절",
}
USERS = [
    ("김수진", "sujin@zenith.co.kr", "member"),
    ("박동현", "donghyun@zenith.co.kr", "lead"),
    ("최재호", "jaeho@zenith.co.kr", "exec"),
]


async def get_or_create[T: Base](
    db: AsyncSession, model: type[T], defaults: dict | None = None, **keys
) -> T:
    obj = (await db.execute(select(model).filter_by(**keys))).scalar_one_or_none()
    if obj is None:
        obj = model(**keys, **(defaults or {}))
        db.add(obj)
        await db.flush()
    return obj


async def main() -> None:
    async with SessionLocal() as db:
        ws = await get_or_create(db, Workspace, name="제니스")
        for name, min_role in BOARDS:
            await get_or_create(db, Board, defaults={"min_role": min_role}, name=name)
        for name in CHANNELS:
            # 공개 채널만 — 같은 이름의 비공개 채널(README 12)을 시드 채널로 오인하지 않게
            await get_or_create(db, Channel, ws_id=ws.id, name=name, is_dm=False, is_private=False)
        # 문서는 폴더 안에만 산다(03 documents.folder_id NOT NULL). 루트 폴더 하나로 시작한다.
        await get_or_create(db, Folder, ws_id=ws.id, parent_id=None, title=ROOT_FOLDER)
        team = await get_or_create(db, Team, name="개발팀")
        pw_hash = hash_password(PASSWORD)
        for name, email, role in USERS:
            user = await get_or_create(
                db,
                User,
                defaults={"name": name, "role": role, "pw_hash": pw_hash, "team_id": team.id},
                email=email,
            )
            if role == "lead":
                team.lead_id = user.id
        for day, name in HOLIDAYS_2026.items():
            await get_or_create(
                db, Holiday, defaults={"name": name, "kind": "public"}, date=date.fromisoformat(day)
            )
        # 공개 채널은 전원 멤버(04 §5, README 12). 이미 들어 있으면 건너뛴다.
        for user_id in (await db.execute(select(User.id))).scalars():
            await channels.join_public_channels(db, user_id)
        await db.commit()
    print(
        f"seeded: workspace 1, boards {len(BOARDS)}, channels {len(CHANNELS)}, "
        f"folder 1, users {len(USERS)}, holidays {len(HOLIDAYS_2026)}"
    )


if __name__ == "__main__":
    asyncio.run(main())
