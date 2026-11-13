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
# 외부 호스팅(infra/hosted/tenant.sh)이 새 회사를 만들 때: 데모 계정·개발팀 대신 그 회사 임원 계정 하나만 만든다.
WORKSPACE = os.environ.get("SEED_WORKSPACE", "제니스")
# 로그인이 소문자로 찾는다(routers/auth.py) — 대문자가 섞여 저장되면 그 계정은 영영 못 들어온다.
ADMIN_EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "").strip().lower() or None
if ADMIN_EMAIL:
    # 인터넷에 열리는 서버다 — 알려진 기본 비밀번호(zenith1234)로 임원 계정이 생기지 않게 한다.
    if "SEED_PASSWORD" not in os.environ:
        raise SystemExit("SEED_ADMIN_EMAIL 을 주면 SEED_PASSWORD 도 줘야 한다")
    USERS = [(os.environ.get("SEED_ADMIN_NAME", "관리자"), ADMIN_EMAIL, "exec")]


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
        # 회사 모드로 다시 돌릴 때(tenant.sh REATTACH) 이름을 다르게 줘도 워크스페이스를 하나 더 만들지 않는다 —
        # 라우터가 `select(Workspace.id).limit(1)` 로 집어서 둘이면 어느 쪽이 쓰일지 모른다.
        ws = None
        if ADMIN_EMAIL:
            ws = (await db.execute(select(Workspace).limit(1))).scalar_one_or_none()
        ws = ws or await get_or_create(db, Workspace, name=WORKSPACE)
        for name, min_role in BOARDS:
            await get_or_create(db, Board, defaults={"min_role": min_role}, name=name)
        for name in CHANNELS:
            # 공개 채널만 — 같은 이름의 비공개 채널(README 12)을 시드 채널로 오인하지 않게
            await get_or_create(db, Channel, ws_id=ws.id, name=name, is_dm=False, is_private=False)
        # 문서는 폴더 안에만 산다(03 documents.folder_id NOT NULL). 루트 폴더 하나로 시작한다.
        await get_or_create(db, Folder, ws_id=ws.id, parent_id=None, title=ROOT_FOLDER)
        team = None if ADMIN_EMAIL else await get_or_create(db, Team, name="개발팀")
        pw_hash = hash_password(PASSWORD)
        for name, email, role in USERS:
            user = await get_or_create(
                db,
                User,
                defaults={
                    "name": name,
                    "role": role,
                    "pw_hash": pw_hash,
                    # 회사 개설(tenant.sh): 운영자가 화면에서 본 초기 비밀번호다 — 첫 로그인 때 바꾸게 한다
                    "must_change_password": bool(ADMIN_EMAIL),
                    "team_id": team and team.id,
                },
                email=email,
            )
            if team and role == "lead":
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
