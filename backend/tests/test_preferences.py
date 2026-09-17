"""04 밖 — 사용자 환경설정 `GET/PATCH /me/preferences` (이슈 #81).

읽고 쓰는 것만이 아니라, 끈 종류의 알림 행이 **만들어지지 않는지**까지 본다(문서 댓글 멘션·새 글).
채팅 소켓 멘션은 test_ws.py 가 같은 기준으로 확인한다.
"""

from httpx import AsyncClient
from sqlalchemy import select, update

from app.models import Board, Document, Folder, Notification, User, Workspace
from app.prefs import wants

from .conftest import Users, csrf, login

DEFAULTS = {
    "notifications": {
        "mention": True,
        "comment": True,
        "reply": True,
        "post": True,
        "attendance": True,
        "approval": True,
    },
    "start_page": "/",
}


async def test_defaults_and_partial_patch(client: AsyncClient, users: Users) -> None:
    """설정한 적 없으면 전부 켜짐·"/". PATCH 는 준 것만 덮어쓰고 전체를 돌려준다."""
    await login(client, "sujin@zenith.co.kr")
    assert (await client.get("/api/me/preferences")).json() == DEFAULTS

    r = await client.patch(
        "/api/me/preferences",
        json={"notifications": {"mention": False}, "start_page": "/docs"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert r.json() == {
        "notifications": {**DEFAULTS["notifications"], "mention": False},
        "start_page": "/docs",
    }

    # 두 번째 PATCH 가 첫 번째를 지우지 않는다
    r = await client.patch(
        "/api/me/preferences", json={"notifications": {"post": False}}, headers=csrf(client)
    )
    assert r.json()["notifications"] == {
        **DEFAULTS["notifications"],
        "mention": False,
        "post": False,
    }
    assert r.json()["start_page"] == "/docs"
    assert (await client.get("/api/me/preferences")).json() == r.json()  # 다시 읽어도 같다


async def test_unknown_values_are_422(client: AsyncClient, users: Users) -> None:
    await login(client, "sujin@zenith.co.kr")
    for body in (
        {"notifications": {"멘션": False}},  # 모르는 종류
        {"start_page": "/admin"},  # 허용 밖 화면
        {"theme": "dark"},  # 서버가 안 받는 키(기기별 값)
        {"notifications": {"mention": "언젠가"}},  # 참/거짓이 아닌 값
    ):
        r = await client.patch("/api/me/preferences", json=body, headers=csrf(client))
        assert r.status_code == 422, (body, r.text)
    assert (await client.get("/api/me/preferences")).json() == DEFAULTS  # 아무것도 안 바뀌었다

    # null 은 "안 준 것"과 같다 — 프론트가 Optional 필드를 그대로 직렬화해도 500 이 아니다
    for body in ({"notifications": None}, {"start_page": None}, {}):
        r = await client.patch("/api/me/preferences", json=body, headers=csrf(client))
        assert (r.status_code, r.json()) == (200, DEFAULTS), (body, r.text)


async def test_preferences_are_per_user(client, make_client, users: Users) -> None:
    await login(client, "sujin@zenith.co.kr")
    r = await client.patch(
        "/api/me/preferences", json={"start_page": "/chat"}, headers=csrf(client)
    )
    assert r.status_code == 200, r.text
    async with make_client() as other:
        await login(other, "donghyun@zenith.co.kr")
        assert (await other.get("/api/me/preferences")).json() == DEFAULTS
        await other.patch("/api/me/preferences", json={"start_page": "/docs"}, headers=csrf(other))
    # 남의 PATCH 가 내 값을 덮어쓰지 않는다(update 의 where 절이 빠지면 여기서 걸린다)
    assert (await client.get("/api/me/preferences")).json()["start_page"] == "/chat"


async def test_stale_stored_value_still_reads(client: AsyncClient, users: Users, app_db) -> None:
    """스키마에서 빠진 옛 키·옛 값이 남아 있어도 읽기·쓰기가 막히지 않는다(app/prefs.py `merged`)."""
    await app_db.execute(
        update(User)
        .where(User.id == users.member.id)
        .values(
            preferences={"notifications": {"mention": False, "옛키": True}, "start_page": "/옛"}
        )
    )
    await login(client, "sujin@zenith.co.kr")
    assert (await client.get("/api/me/preferences")).json() == DEFAULTS  # 통째로 기본값

    r = await client.patch(
        "/api/me/preferences", json={"start_page": "/docs"}, headers=csrf(client)
    )
    assert (r.status_code, r.json()["start_page"]) == (200, "/docs")


def test_wants_maps_attendance_and_approval_kinds() -> None:
    """근태·결재는 kind 가 여럿이라 묶음 하나로 받는다 — 접두사로 되돌린다(04 §10.5 · 13 §9.4)."""
    off = {"notifications": {"attendance": False, "approval": False, "mention": False}}
    assert wants(off, "att_late") is False and wants(off, "apv_request") is False
    assert wants(off, "post") is True  # 안 끈 종류
    assert wants(None, "att_late") is True  # 설정한 적 없으면 받는다


async def test_mention_off_makes_no_notification(client: AsyncClient, users: Users, app_db) -> None:
    """멘션을 끈 사람은 문서 댓글에서 @이름 으로 불려도 알림 행이 생기지 않는다."""
    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    root = Folder(ws_id=ws.id, parent_id=None, title="회사 위키")
    app_db.add(root)
    await app_db.flush()
    doc = Document(folder_id=root.id, title="기획서", updated_by=users.member.id)
    app_db.add(doc)
    await app_db.flush()

    await login(client, "donghyun@zenith.co.kr")  # 박동현이 멘션을 끈다
    await client.patch(
        "/api/me/preferences", json={"notifications": {"mention": False}}, headers=csrf(client)
    )

    await login(client, "sujin@zenith.co.kr")
    r = await client.post(
        f"/api/docs/{doc.id}/comments",
        json={"body": "@박동현 @최재호 확인 부탁해요."},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    notes = list((await app_db.execute(select(Notification))).scalars())
    assert [n.user_id for n in notes] == [users.exec.id]  # 최재호만


async def test_post_off_makes_no_notification(client: AsyncClient, users: Users, app_db) -> None:
    """새 글 알림을 끈 사람은 열람 가능한 게시판에 글이 올라와도 알림 행이 생기지 않는다."""
    board = Board(name="전체공지", min_role="member")
    app_db.add(board)
    await app_db.flush()

    await login(client, "sujin@zenith.co.kr")
    await client.patch(
        "/api/me/preferences", json={"notifications": {"post": False}}, headers=csrf(client)
    )

    await login(client, "jaeho@zenith.co.kr")
    r = await client.post(
        f"/api/boards/{board.id}/posts",
        json={"title": "전체 공지", "body": "모두"},
        headers=csrf(client),
    )
    assert r.status_code == 201, r.text
    notes = list((await app_db.execute(select(Notification))).scalars())
    assert [n.user_id for n in notes] == [users.lead.id]  # 김수진은 껐고 최재호는 글쓴이
