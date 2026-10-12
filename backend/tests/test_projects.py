"""협업 공간 — 프로젝트·업무 (README 40 · /api/projects). 실 Postgres 위에서 정상 경로·권한 거부(403+감사)·422·404."""

from collections.abc import Callable

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditEvent, ProjectTask, User
from tests.conftest import PW_HASH, Users, csrf, login

API = "/api"


async def _as(client: AsyncClient, email: str) -> dict[str, str]:
    r = await login(client, email)
    assert r.status_code == 204, r.text
    return csrf(client)


async def _project(client: AsyncClient, h: dict, name: str = "제니스 파일럿 도입", **kw) -> dict:
    r = await client.post(f"{API}/projects", json={"name": name, **kw}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def _task(
    client: AsyncClient, h: dict, project_id: str, title: str = "계정 발급", **kw
) -> dict:
    r = await client.post(
        f"{API}/projects/{project_id}/tasks", json={"title": title, **kw}, headers=h
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_requires_login(client: AsyncClient, users: Users) -> None:
    r = await client.get(f"{API}/projects")
    assert r.status_code == 401
    assert r.json()["code"] == "AUTH_REQUIRED"


async def test_project_crud_and_counts(
    client: AsyncClient, make_client: Callable[[], AsyncClient], users: Users, app_db
) -> None:
    """만들기(다듬기·기본값)·목록 순서·업무 수·can_delete·고치기·null 거부·없는 것 404."""
    h = await _as(client, "sujin@zenith.co.kr")
    first = await _project(client, h, "  사무실 이전  ", description=" 견적부터 입주까지 ")
    assert first["name"] == "사무실 이전"
    assert first["description"] == "견적부터 입주까지"
    assert first["created_by"] == {"id": str(users.member.id), "name": "김수진"}
    assert first["task_count"] == 0 and first["done_count"] == 0
    assert first["can_delete"] is True

    second = await _project(client, h)
    await _task(client, h, second["id"], stage="done")
    await _task(client, h, second["id"], title="교육 일정", stage="doing")

    r = await client.get(f"{API}/projects", headers=h)
    assert r.status_code == 200
    items = r.json()["items"]
    assert [p["id"] for p in items] == [second["id"], first["id"]]  # 최근 것부터
    assert items[0]["task_count"] == 2 and items[0]["done_count"] == 1

    # 다른 사원은 보지만 지우진 못한다. 임원은 지운다.
    async with make_client() as lead, make_client() as boss:
        h_lead = await _as(lead, "donghyun@zenith.co.kr")
        r = await lead.get(f"{API}/projects/{first['id']}", headers=h_lead)
        assert r.status_code == 200 and r.json()["can_delete"] is False
        h_exec = await _as(boss, "jaeho@zenith.co.kr")
        r = await boss.get(f"{API}/projects/{first['id']}", headers=h_exec)
        assert r.json()["can_delete"] is True
        r = await lead.patch(
            f"{API}/projects/{first['id']}", json={"description": ""}, headers=h_lead
        )
        assert r.status_code == 200 and r.json()["description"] == ""

    r = await client.patch(f"{API}/projects/{first['id']}", json={"name": None}, headers=h)
    assert r.status_code == 422
    r = await client.patch(f"{API}/projects/{first['id']}", json={"name": "   "}, headers=h)
    assert r.status_code == 422
    r = await client.post(f"{API}/projects", json={"name": "x" * 81}, headers=h)
    assert r.status_code == 422

    missing = "00000000-0000-0000-0000-000000000000"
    for call in (
        client.get(f"{API}/projects/{missing}", headers=h),
        client.patch(f"{API}/projects/{missing}", json={"name": "a"}, headers=h),
        client.delete(f"{API}/projects/{missing}", headers=h),
        client.get(f"{API}/projects/{missing}/tasks", headers=h),
        client.post(f"{API}/projects/{missing}/tasks", json={"title": "a"}, headers=h),
    ):
        r = await call
        assert r.status_code == 404, r.text
        assert r.json()["code"] == "NOT_FOUND"


async def test_delete_project_permission_and_cascade(
    client: AsyncClient, make_client: Callable[[], AsyncClient], users: Users, app_db: AsyncSession
) -> None:
    """만든 사람·임원만. 남이 지우면 403 + acl.denied. 지우면 업무가 같이 사라지고 감사 projects.deleted."""
    h = await _as(client, "sujin@zenith.co.kr")
    project = await _project(client, h)
    task = await _task(client, h, project["id"])

    async with make_client() as lead:
        h_lead = await _as(lead, "donghyun@zenith.co.kr")
        r = await lead.delete(f"{API}/projects/{project['id']}", headers=h_lead)
    assert r.status_code == 403
    assert r.json()["code"] == "FORBIDDEN"
    denied = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "acl.denied")))
        .scalars()
        .all()
    )
    assert len(denied) == 1
    assert denied[0].actor_id == users.lead.id
    assert str(denied[0].target_id) == project["id"]
    assert denied[0].detail["reason"] == "delete"

    async with make_client() as boss:
        h_exec = await _as(boss, "jaeho@zenith.co.kr")
        r = await boss.delete(f"{API}/projects/{project['id']}", headers=h_exec)
    assert r.status_code == 204
    assert (await app_db.get(ProjectTask, task["id"])) is None
    r = await client.get(f"{API}/projects/{project['id']}", headers=h)
    assert r.status_code == 404
    r = await client.get(f"{API}/project-tasks/{task['id']}", headers=h)
    assert r.status_code == 405  # 업무 하나 읽기는 없다
    r = await client.delete(f"{API}/project-tasks/{task['id']}", headers=h)
    assert r.status_code == 404
    logged = (
        (await app_db.execute(select(AuditEvent).where(AuditEvent.kind == "projects.deleted")))
        .scalars()
        .all()
    )
    assert len(logged) == 1
    assert logged[0].actor_id == users.exec.id
    assert logged[0].detail == {"name": "제니스 파일럿 도입", "tasks": 1}

    # 만든 사람 본인은 지운다
    mine = await _project(client, h, "내 것")
    r = await client.delete(f"{API}/projects/{mine['id']}", headers=h)
    assert r.status_code == 204


async def test_task_crud_and_validation(
    client: AsyncClient, users: Users, app_db: AsyncSession
) -> None:
    """기본값·담당자 이름·단계 옮기기·null 비우기·검증 422(단계·중요도·날짜·비활성 담당자)·지우기."""
    h = await _as(client, "sujin@zenith.co.kr")
    project = await _project(client, h)

    task = await _task(client, h, project["id"], title=" 계정 발급 ")
    assert task["title"] == "계정 발급"
    assert task["stage"] == "todo" and task["priority"] == "normal"
    assert task["assignee"] is None and task["due_date"] is None and task["note"] == ""
    assert task["project_id"] == project["id"]

    full = await _task(
        client,
        h,
        project["id"],
        title="교육 일정",
        stage="doing",
        assignee_id=str(users.lead.id),
        due_date="2026-10-20",
        priority="high",
        note=" 팀별로 ",
    )
    assert full["assignee"] == {"id": str(users.lead.id), "name": "박동현"}
    assert full["due_date"] == "2026-10-20" and full["note"] == "팀별로"

    r = await client.get(f"{API}/projects/{project['id']}/tasks", headers=h)
    assert [t["id"] for t in r.json()["items"]] == [task["id"], full["id"]]  # 만든 순

    other = await _project(client, h, "다른 프로젝트")
    await _task(client, h, other["id"], title="남의 업무")
    r = await client.get(f"{API}/projects/{project['id']}/tasks", headers=h)
    assert len(r.json()["items"]) == 2  # 다른 프로젝트 업무는 섞이지 않는다

    # 단계만 옮긴다 — 나머지는 그대로, 프로젝트의 done_count 가 따라온다
    r = await client.patch(f"{API}/project-tasks/{full['id']}", json={"stage": "done"}, headers=h)
    assert r.status_code == 200
    assert r.json()["stage"] == "done" and r.json()["assignee"]["name"] == "박동현"
    r = await client.get(f"{API}/projects/{project['id']}", headers=h)
    assert r.json()["task_count"] == 2 and r.json()["done_count"] == 1
    # 담당자·마감은 null 로 비운다, 제목은 못 비운다
    r = await client.patch(
        f"{API}/project-tasks/{full['id']}", json={"assignee_id": None, "due_date": None}, headers=h
    )
    assert r.status_code == 200
    assert r.json()["assignee"] is None and r.json()["due_date"] is None
    r = await client.patch(f"{API}/project-tasks/{full['id']}", json={"title": None}, headers=h)
    assert r.status_code == 422

    for bad in (
        {"stage": "archived"},
        {"priority": "urgent"},
        {"due_date": "2026-13-01"},
        {"title": "x" * 121},
        {"note": "x" * 2001},
        {"assignee_id": "00000000-0000-0000-0000-000000000000"},
    ):
        r = await client.patch(f"{API}/project-tasks/{task['id']}", json=bad, headers=h)
        assert r.status_code == 422, (bad, r.text)
        assert r.json()["code"] == "VALIDATION"

    # 비활성(퇴사) 사용자는 담당자가 못 된다
    gone = User(
        name="퇴사자", email="gone@zenith.co.kr", pw_hash=PW_HASH, role="member", active=False
    )
    app_db.add(gone)
    await app_db.flush()
    r = await client.post(
        f"{API}/projects/{project['id']}/tasks",
        json={"title": "a", "assignee_id": str(gone.id)},
        headers=h,
    )
    assert r.status_code == 422
    assert "담당자" in r.json()["detail"]
    r = await client.patch(
        f"{API}/project-tasks/{task['id']}", json={"assignee_id": str(gone.id)}, headers=h
    )
    assert r.status_code == 422

    r = await client.delete(f"{API}/project-tasks/{task['id']}", headers=h)
    assert r.status_code == 204
    r = await client.get(f"{API}/projects/{project['id']}", headers=h)
    assert r.json()["task_count"] == 1 and r.json()["done_count"] == 1
