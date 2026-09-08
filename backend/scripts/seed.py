"""개발 시드. 03-ERD §2.5(워크스페이스 1 · 게시판 3 · 기본 채널 2) + 조직 1팀 + 데모 계정 3명.

데모 계정·비밀번호는 프론트 목(frontend/src/mocks/accounts.ts)과 같다. 몇 번 실행해도 결과가 같다(멱등).
휴가 종류·공휴일 시드는 근태 테이블이 들어올 때 함께 온다.
"""

import asyncio
import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Base, SessionLocal
from app.models import Board, Channel, Folder, Team, User, Workspace
from app.routers import channels
from app.security import hash_password

PASSWORD = os.environ.get("SEED_PASSWORD", "zenith1234")
BOARDS = [("전체공지", "member"), ("팀장 회의록", "lead"), ("경영 보고", "exec")]
CHANNELS = ["공지사항", "일반"]
ROOT_FOLDER = "회사 위키"
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
            await get_or_create(db, Channel, ws_id=ws.id, name=name)
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
        # 공개 채널은 전원 멤버(04 §5, README 12). 이미 들어 있으면 건너뛴다.
        for user_id in (await db.execute(select(User.id))).scalars():
            await channels.join_public_channels(db, user_id)
        await db.commit()
    print(
        f"seeded: workspace 1, boards {len(BOARDS)}, channels {len(CHANNELS)}, "
        f"folder 1, users {len(USERS)}"
    )


if __name__ == "__main__":
    asyncio.run(main())
