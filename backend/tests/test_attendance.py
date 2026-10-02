"""04 §10 근태 — 신청 4종 → 결재 연동, 일자 상태·집계, 월 마감, 휴일, 팀 그리드·리포트. 규칙은 프론트 목과 같다."""

from contextlib import asynccontextmanager
from datetime import date
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import AuditEvent, Holiday, Team, User
from app.routers.attendance import overtime_minutes

from .conftest import PW_HASH, Users, csrf, login


@asynccontextmanager
async def _as(make_client, email: str):
    async with make_client() as c:
        assert (await login(c, email)).status_code == 204
        yield c


@pytest.fixture
async def c(make_client, users: Users):
    async with (
        _as(make_client, "sujin@zenith.co.kr") as member,
        _as(make_client, "donghyun@zenith.co.kr") as lead,
        _as(make_client, "jaeho@zenith.co.kr") as exec_,
    ):
        yield SimpleNamespace(member=member, lead=lead, exec=exec_)


async def post(c: AsyncClient, url: str, json=None):
    return await c.post(url, json=json, headers=csrf(c))


async def _approve(c: AsyncClient, approval_inbox_owner: AsyncClient, title_prefix: str) -> dict:
    """받은 결재함에서 제목으로 찾아 승인."""
    inbox = (await approval_inbox_owner.get("/api/approvals?box=inbox")).json()["items"]
    doc = next(i for i in inbox if i["title"].startswith(title_prefix))
    full = (await approval_inbox_owner.get(f"/api/approvals/{doc['id']}")).json()
    version = full["steps"][full["current_step"] - 1]["version"]
    r = await post(
        approval_inbox_owner, f"/api/approvals/{doc['id']}/approve", {"version": version}
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_overtime_minutes() -> None:
    """10 §5.3 — 프론트 overtimeMinutes.test.ts 와 같은 값."""
    assert overtime_minutes("18:00", "21:00") == (180, 0)
    assert overtime_minutes("20:00", "01:00") == (300, 180)
    assert overtime_minutes("17:00", "19:00") == (60, 0)  # 18:00 이전은 안 센다
    assert overtime_minutes("17:00", "18:00") == (0, 0)
    assert overtime_minutes("18:00", "18:00") == (0, 0)  # 24시간으로 읽지 않는다
    assert overtime_minutes("22:00", "07:00") == (540, 480)
    # 쉬는 날은 18:00 바닥 없이 전 구간(근기법 휴일근로), 새벽도 야간
    assert overtime_minutes("09:00", "18:00", day_off=True) == (540, 0)
    assert overtime_minutes("04:00", "08:00", day_off=True) == (240, 120)


async def test_leave_flow(c, users: Users, app_db) -> None:
    """휴가 신청 = 결재 상신(팀장 한 단계). 승인되면 신청 상태·근태 달력이 따라오고, 잔여는 대기분까지 잡는다."""
    types = (await c.member.get("/api/leave-types")).json()["items"]
    assert [t["code"] for t in types] == [
        "annual",
        "half_am",
        "half_pm",
        "sick",
        "family",
        "official",
    ]
    bal = (await c.member.get("/api/leaves/balance")).json()
    assert bal["granted"] == 15 and bal["used"] == 0 and bal["grant_basis"] == "fiscal_year"

    r = await post(
        c.member,
        "/api/leaves",
        {"type_code": "annual", "start_date": "2030-03-04", "end_date": "2030-03-08"},
    )
    assert r.status_code == 201, r.text
    leave = r.json()
    assert leave["days"] == 5 and leave["status"] == "pending" and leave["decided_at"] is None
    # 대기분도 잔여를 잡는다 — 같은 해 11일 더는 15일을 넘는다
    r = await post(
        c.member,
        "/api/leaves",
        {"type_code": "annual", "start_date": "2030-03-11", "end_date": "2030-03-25"},
    )
    assert r.status_code == 422 and r.json()["code"] == "LEAVE_INSUFFICIENT"
    r = await post(c.member, "/api/leaves", {"type_code": "half_am", "start_date": "2030-03-11"})
    assert r.status_code == 201 and r.json()["days"] == 0.5
    assert r.json()["end_date"] == "2030-03-11"

    # 결재: 팀장 한 단계, 휴가 유형
    inbox = (await c.lead.get("/api/approvals?box=inbox")).json()["items"]
    assert {i["type_code"] for i in inbox} == {"leave"} and len(inbox) == 2
    doc = await _approve(c.member, c.lead, "[휴가] 연차")
    assert doc["status"] == "approved" and len(doc["steps"]) == 1

    mine = {i["id"]: i for i in (await c.member.get("/api/leaves?scope=me")).json()["items"]}
    assert mine[leave["id"]]["status"] == "approved" and mine[leave["id"]]["decided_at"]
    month = (await c.member.get("/api/attendance/me?month=2030-03")).json()
    by_day = {d["work_date"]: d for d in month["days"]}
    assert by_day["2030-03-04"]["status"] == "leave" and by_day["2030-03-04"]["worked_days"] == 0
    assert by_day["2030-03-11"]["status"] == "normal"  # 반차는 아직 대기
    assert "2030-03-09" not in by_day  # 주말은 행이 없다
    assert month["summary"]["leave_days"] == 5 and len(month["days"]) == 21

    # 홈 캘린더: 승인분만, 사유 없이
    cal = (await c.lead.get("/api/leaves?scope=all&from=2030-03-01&to=2030-03-31")).json()["items"]
    assert [(i["user"]["name"], i["start_date"]) for i in cal] == [("김수진", "2030-03-04")]
    assert "reason" not in cal[0]
    assert (await c.lead.get("/api/leaves?scope=all")).status_code == 422


async def test_leave_validation_and_cancel(c, users: Users) -> None:
    r = await post(c.member, "/api/leaves", {"type_code": "nope", "start_date": "2030-03-04"})
    assert r.status_code == 422
    r = await post(c.member, "/api/leaves", {"type_code": "sick", "start_date": "2030-03-04"})
    assert r.status_code == 422  # 차감 없는 휴가는 사유 필수
    r = await post(
        c.member,
        "/api/leaves",
        {"type_code": "annual", "start_date": "2030-03-09", "end_date": "2030-03-10"},
    )
    assert r.status_code == 422  # 주말뿐
    r = await post(
        c.member,
        "/api/leaves",
        {"type_code": "annual", "start_date": "2030-03-05", "end_date": "2030-03-04"},
    )
    assert r.status_code == 422

    sick = (
        await post(
            c.member,
            "/api/leaves",
            {"type_code": "sick", "start_date": "2030-03-04", "reason": "감기"},
        )
    ).json()
    assert sick["days"] == 0 and sick["reason"] == "감기"
    assert (await post(c.lead, f"/api/leaves/{sick['id']}/cancel")).status_code == 404
    r = await post(c.member, f"/api/leaves/{sick['id']}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "canceled"
    r = await post(c.member, f"/api/leaves/{sick['id']}/cancel")
    assert r.status_code == 409 and r.json()["code"] == "REQUEST_DECIDED"
    # 회수된 결재 문서는 팀장 결재함에서도 사라진다
    assert (await c.lead.get("/api/approvals?box=inbox")).json()["items"] == []

    annual = (
        await post(c.member, "/api/leaves", {"type_code": "annual", "start_date": "2030-03-05"})
    ).json()
    await _approve(c.member, c.lead, "[휴가]")
    r = await post(c.member, f"/api/leaves/{annual['id']}/cancel")
    assert r.status_code == 409 and r.json()["code"] == "REQUEST_DECIDED"


async def test_exec_request_is_approved_at_once(c) -> None:
    r = await post(c.exec, "/api/leaves", {"type_code": "annual", "start_date": "2030-03-04"})
    assert r.status_code == 201 and r.json()["status"] == "approved"


async def test_exceptions_flow(c, users: Users) -> None:
    """예외 근무·연장·정정: 신청 → 결재 → 승인되면 일자 상태·연장 분이 달력에 반영된다. 취소는 같은 모양."""
    r = await post(
        c.member,
        "/api/attendance/arrangements",
        {
            "kind": "trip",
            "start_date": "2030-03-04",
            "end_date": "2030-03-05",
            "reason": "부산 출장",
        },
    )
    assert r.status_code == 201, r.text
    trip = r.json()
    assert trip["status"] == "pending" and trip["kind"] == "trip"
    r = await post(
        c.member,
        "/api/attendance/arrangements",
        {"kind": "remote", "start_date": "2030-03-06", "end_date": "2030-03-06", "reason": " "},
    )
    assert r.status_code == 422  # 사유 필수

    r = await post(
        c.member,
        "/api/attendance/overtime",
        {"work_date": "2030-03-06", "start_time": "20:00", "end_time": "01:00", "reason": "장애"},
    )
    assert r.status_code == 201, r.text
    assert (r.json()["minutes"], r.json()["night_minutes"]) == (300, 180)
    r = await post(
        c.member,
        "/api/attendance/overtime",
        {"work_date": "2030-03-06", "start_time": "17:00", "end_time": "18:00", "reason": "x"},
    )
    assert r.status_code == 422
    r = await post(
        c.member,
        "/api/attendance/overtime",
        {"work_date": "2030-03-06", "start_time": "25:00", "end_time": "26:00", "reason": "x"},
    )
    assert r.status_code == 422

    r = await post(
        c.member,
        "/api/attendance/corrections",
        {"work_date": "2030-03-07", "after": {}, "reason": "x"},
    )
    assert r.status_code == 422  # 바꿀 내용 없음
    r = await post(
        c.member,
        "/api/attendance/corrections",
        {"work_date": "2030-03-07", "after": {"status": "field", "note": "현장"}, "reason": "누락"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["after"] == {"status": "field", "note": "현장"}

    for prefix in ("[출장]", "[연장근로]", "[근태 정정]"):
        await _approve(c.member, c.lead, prefix)

    days = {
        d["work_date"]: d
        for d in (await c.member.get("/api/attendance/me?month=2030-03")).json()["days"]
    }
    assert days["2030-03-04"]["status"] == "trip" and days["2030-03-05"]["status"] == "trip"
    assert (
        days["2030-03-06"]["overtime_minutes"] == 300 and days["2030-03-06"]["night_minutes"] == 180
    )
    assert days["2030-03-07"]["status"] == "field" and days["2030-03-07"]["note"] == "현장"

    ot = (await c.member.get("/api/attendance/overtime?from=2030-03-01&to=2030-03-31")).json()
    assert ot["summary"] == {"minutes": 300, "night_minutes": 180}
    assert (await c.member.get("/api/attendance/overtime?from=2031-01-01")).json()["items"] == []
    items = (await c.member.get("/api/attendance/arrangements?scope=me")).json()["items"]
    assert [i["status"] for i in items] == ["approved"]
    cal = (
        await c.lead.get("/api/attendance/arrangements?scope=all&from=2030-03-05&to=2030-03-05")
    ).json()["items"]
    assert [(i["user"]["name"], i["kind"]) for i in cal] == [("김수진", "trip")]
    assert len((await c.member.get("/api/attendance/corrections")).json()["items"]) == 1

    # 취소 — 처리된 것은 409, 대기 중은 canceled, 남의 것·없는 것 404
    r = await post(c.member, f"/api/attendance/arrangements/{trip['id']}/cancel")
    assert r.status_code == 409 and r.json()["code"] == "REQUEST_DECIDED"
    remote = (
        await post(
            c.member,
            "/api/attendance/arrangements",
            {
                "kind": "remote",
                "start_date": "2030-03-08",
                "end_date": "2030-03-08",
                "reason": "이사",
            },
        )
    ).json()
    assert (
        await post(c.lead, f"/api/attendance/arrangements/{remote['id']}/cancel")
    ).status_code == 404
    r = await post(c.member, f"/api/attendance/arrangements/{remote['id']}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "canceled"
    assert (await post(c.member, f"/api/attendance/nope/{remote['id']}/cancel")).status_code == 422


async def test_rejected_and_force_closed_requests(c) -> None:
    """반려된 신청은 rejected, 임원이 강제 종결한 신청도 승인되지 않았으므로 rejected 로 보인다."""
    await post(c.member, "/api/leaves", {"type_code": "annual", "start_date": "2030-03-04"})
    await post(c.member, "/api/leaves", {"type_code": "annual", "start_date": "2030-03-05"})
    inbox = (await c.lead.get("/api/approvals?box=inbox")).json()["items"]
    first, second = sorted(inbox, key=lambda i: i["title"])
    await post(c.lead, f"/api/approvals/{first['id']}/reject", {"version": 1, "reason": "바쁨"})
    await post(c.exec, f"/api/approvals/{second['id']}/force-close", {"reason": "정리"})
    items = (await c.member.get("/api/leaves?scope=me")).json()["items"]
    assert {i["status"] for i in items} == {"rejected"}
    assert (await c.member.get("/api/leaves/balance")).json()["used"] == 0


async def test_month_closing(c, users: Users, app_db) -> None:
    """마감·해제는 임원만(403+감사). 마감된 달엔 신청 409, 승인도 409. 해제는 사유 필수, 이력은 최신순."""
    r = await post(c.member, "/api/attendance/close", {"month": "2025-01"})
    assert r.status_code == 403
    denied = await app_db.scalar(
        select(AuditEvent).where(
            AuditEvent.kind == "acl.denied", AuditEvent.actor_id == users.member.id
        )
    )
    assert denied is not None
    assert (await post(c.exec, "/api/attendance/close", {"month": "2999-01"})).status_code == 422
    assert (await post(c.exec, "/api/attendance/close", {"month": "2025-13"})).status_code == 422

    # 2월에 대기 중인 신청 하나를 만들어 두고 1·2월을 마감
    r = await post(c.member, "/api/leaves", {"type_code": "annual", "start_date": "2025-02-03"})
    assert r.status_code == 201
    for month in ("2025-01", "2025-02"):
        r = await post(c.exec, "/api/attendance/close", {"month": month})
        assert r.status_code == 200, r.text
    closing = r.json()
    assert closing["status"] == "closed" and closing["closed_by"]["name"] == "최재호"
    r = await post(c.exec, "/api/attendance/close", {"month": "2025-01"})
    assert r.status_code == 409 and r.json()["code"] == "ALREADY_CLOSED"

    # TC-ATT-16: 마감된 달에 걸치는 신청은 409 — 가운데 달만 걸려도
    r = await post(c.member, "/api/leaves", {"type_code": "annual", "start_date": "2025-01-06"})
    assert r.status_code == 409 and r.json()["code"] == "MONTH_CLOSED"
    r = await post(
        c.member,
        "/api/attendance/arrangements",
        {"kind": "trip", "start_date": "2024-12-30", "end_date": "2025-03-03", "reason": "장기"},
    )
    assert r.status_code == 409
    for url, body in (
        ("overtime", {"work_date": "2025-01-06", "start_time": "18:00", "end_time": "20:00"}),
        ("corrections", {"work_date": "2025-01-06", "after": {"note": "x"}}),
    ):
        r = await post(c.member, f"/api/attendance/{url}", {**body, "reason": "x"})
        assert r.status_code == 409, url
    # 마감 전에 낸 신청도 마감 뒤에는 승인할 수 없다(반려는 된다)
    doc = (await c.lead.get("/api/approvals?box=inbox")).json()["items"][0]
    r = await post(c.lead, f"/api/approvals/{doc['id']}/approve", {"version": 1})
    assert r.status_code == 409 and r.json()["code"] == "MONTH_CLOSED"

    # 해제 — 사유 필수, 이력 최신순
    r = await post(c.exec, "/api/attendance/reopen", {"month": "2025-02", "reason": " "})
    assert r.status_code == 422
    r = await post(c.exec, "/api/attendance/reopen", {"month": "2025-02", "reason": "정정 반영"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "open" and body["closed_at"] is None
    assert [(h["action"], h.get("reason")) for h in body["history"]] == [
        ("reopen", "정정 반영"),
        ("close", None),
    ]
    r = await post(c.exec, "/api/attendance/reopen", {"month": "2025-02", "reason": "x"})
    assert r.status_code == 409 and r.json()["code"] == "NOT_CLOSED"
    r = await post(c.lead, f"/api/approvals/{doc['id']}/approve", {"version": 1})
    assert r.status_code == 200

    # 조회는 누구나 — 한 달·한 해
    assert (await c.member.get("/api/attendance/closings/2025-01")).json()["status"] == "closed"
    year = (await c.member.get("/api/attendance/closings?year=2025")).json()["items"]
    assert [m["status"] for m in year[:3]] == ["closed", "open", "open"] and len(year) == 12
    assert (await c.member.get("/api/attendance/closings/2025-1")).status_code == 422


async def test_holidays(c, users: Users, app_db) -> None:
    """휴일: 임원만. 넣으면 그날 근무일이 빠지고 휴가 차감에서도 빠진다. 회사 휴일만 이름 고치기·지우기(#286)."""
    assert (await c.member.get("/api/admin/holidays?year=2030")).status_code == 403
    r = await post(
        c.exec,
        "/api/admin/holidays",
        {"date": "2030-03-05", "name": " 창립기념일 ", "kind": "company"},
    )
    assert r.status_code == 201, r.text
    assert r.json() == {"date": "2030-03-05", "name": "창립기념일", "kind": "company"}
    r = await post(
        c.exec, "/api/admin/holidays", {"date": "2030-03-05", "name": "x", "kind": "company"}
    )
    assert r.status_code == 409 and r.json()["code"] == "HOLIDAY_EXISTS"
    r = await post(
        c.exec, "/api/admin/holidays", {"date": "2030-03-01", "name": "삼일절", "kind": "public"}
    )
    assert r.status_code == 422  # 법정 공휴일은 seed 가 원천
    app_db.add(Holiday(date=date(2030, 3, 1), name="삼일절", kind="public"))
    await app_db.flush()
    assert (
        await post(
            c.exec, "/api/admin/holidays", {"date": "2030-02-30", "name": "x", "kind": "company"}
        )
    ).status_code == 422
    assert (
        await post(
            c.exec, "/api/admin/holidays", {"date": "2030-03-06", "name": " ", "kind": "company"}
        )
    ).status_code == 422
    items = (await c.exec.get("/api/admin/holidays?year=2030")).json()["items"]
    assert [i["date"] for i in items] == ["2030-03-01", "2030-03-05"]

    # 근무 달력·휴가 차감이 따라온다
    days = {
        d["work_date"]
        for d in (await c.member.get("/api/attendance/me?month=2030-03")).json()["days"]
    }
    assert "2030-03-05" not in days and "2030-03-01" not in days and "2030-03-04" in days
    r = await post(
        c.member,
        "/api/leaves",
        {"type_code": "annual", "start_date": "2030-03-04", "end_date": "2030-03-06"},
    )
    assert r.json()["days"] == 2

    # 이름 고치기 — 회사 휴일만, 감사 admin.holiday_updated
    r = await c.exec.patch(
        "/api/admin/holidays/2030-03-05", json={"name": "창립 기념일"}, headers=csrf(c.exec)
    )
    assert r.status_code == 200 and r.json()["name"] == "창립 기념일"
    event = await app_db.scalar(
        select(AuditEvent).where(AuditEvent.kind == "admin.holiday_updated")
    )
    assert event.detail == {"date": "2030-03-05", "from": "창립기념일", "to": "창립 기념일"}
    r = await c.exec.patch(
        "/api/admin/holidays/2030-03-01", json={"name": "x"}, headers=csrf(c.exec)
    )
    assert r.status_code == 403
    r = await c.exec.patch(
        "/api/admin/holidays/2030-03-02", json={"name": "x"}, headers=csrf(c.exec)
    )
    assert r.status_code == 404
    r = await c.member.patch(
        "/api/admin/holidays/2030-03-05", json={"name": "x"}, headers=csrf(c.member)
    )
    assert r.status_code == 403

    # 달력 재생성: 그 해 근무일 수(주말·휴일 제외)
    r = await post(c.exec, "/api/admin/attendance/calendar/rebuild", {"year": 2030})
    assert r.status_code == 200 and r.json() == {"year": 2030, "workdays": 261 - 2}

    # 지우기 — 법정 공휴일 403, 회사 휴일 204
    assert (
        await c.exec.delete("/api/admin/holidays/2030-03-01", headers=csrf(c.exec))
    ).status_code == 403
    assert (
        await c.exec.delete("/api/admin/holidays/2030-03-05", headers=csrf(c.exec))
    ).status_code == 204
    assert (
        await c.exec.delete("/api/admin/holidays/2030-03-05", headers=csrf(c.exec))
    ).status_code == 404


async def test_holidays_in_closed_month(c) -> None:
    """마감된 달: 휴일을 넣고 빼지 못한다(409). 이름은 달력을 안 바꾸니 고칠 수 있다(#286)."""
    app_holiday = {"date": "2025-01-31", "name": "회사 휴무", "kind": "company"}
    assert (await post(c.exec, "/api/admin/holidays", app_holiday)).status_code == 201
    await post(c.exec, "/api/attendance/close", {"month": "2025-01"})
    r = await post(c.exec, "/api/admin/holidays", {**app_holiday, "date": "2025-01-30"})
    assert r.status_code == 409 and r.json()["code"] == "MONTH_CLOSED"
    r = await c.exec.patch(
        "/api/admin/holidays/2025-01-31", json={"name": "회사 쉬는 날"}, headers=csrf(c.exec)
    )
    assert r.status_code == 200
    r = await c.exec.delete("/api/admin/holidays/2025-01-31", headers=csrf(c.exec))
    assert r.status_code == 409


async def test_team_grid_and_report(c, users: Users, app_db, make_client) -> None:
    """팀 그리드: 팀장(teams.lead_id)·exec 만. 전사(team_id 없음)는 exec. lead_id 가 NULL 인 팀은 아무도 팀장이 아니다."""
    team = users.team.id
    r = await c.member.get(f"/api/attendance/team?month=2030-03&team_id={team}")
    assert r.status_code == 403
    r = await c.lead.get(f"/api/attendance/team?month=2030-03&team_id={team}")
    assert r.status_code == 200, r.text
    grid = r.json()
    assert [row["user"]["name"] for row in grid["items"]] == ["김수진", "박동현", "최재호"]
    assert (
        grid["items"][0]["user"]["team"]["name"] == "개발팀" and len(grid["items"][0]["days"]) == 21
    )
    assert (await c.lead.get("/api/attendance/team?month=2030-03")).status_code == 403

    # 팀장 없는 팀(관리 화면으로 만든 팀은 lead_id NULL) — lead 등급이어도 403(fail-closed)
    other = Team(name="영업팀")
    app_db.add(other)
    await app_db.flush()
    app_db.add(
        User(name="이영희", email="yh@zenith.co.kr", pw_hash=PW_HASH, role="lead", team_id=other.id)
    )
    await app_db.flush()
    async with _as(make_client, "yh@zenith.co.kr") as yh:
        assert (
            await yh.get(f"/api/attendance/team?month=2030-03&team_id={other.id}")
        ).status_code == 403
        assert (
            await yh.get(f"/api/attendance/team?month=2030-03&team_id={team}")
        ).status_code == 403
    reasons = [
        e.detail["reason"]
        for e in await app_db.scalars(select(AuditEvent).where(AuditEvent.kind == "acl.denied"))
    ]
    assert reasons.count("team") == 3 and reasons.count("company") == 1

    r = await c.exec.get("/api/attendance/team?month=2030-03")
    assert len(r.json()["items"]) == 4
    assert (
        await c.exec.get(f"/api/attendance/team?month=2030-03&team_id={users.member.id}")
    ).status_code == 404

    # 월 리포트 csv(exec)
    assert (await c.lead.get("/api/attendance/report?month=2030-03")).status_code == 403
    r = await c.exec.get("/api/attendance/report?month=2030-03&format=csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="attendance-2030-03.csv"' in r.headers["content-disposition"]
    text = r.content.decode("utf-8")
    assert text.startswith("﻿이름,팀,근무일,휴가일,연장(분),야간(분)")
    assert "김수진,개발팀," in text
    assert (await c.exec.get("/api/attendance/report?month=2030-03&format=xlsx")).status_code == 422


async def test_balances_and_summary(c, users: Users) -> None:
    assert (await c.member.get("/api/leaves/balances")).status_code == 403
    rows = (await c.exec.get("/api/leaves/balances")).json()["items"]
    assert [r["user"]["name"] for r in rows] == ["김수진", "박동현", "최재호"]
    assert rows[0]["remaining"] == 15 and rows[0]["user"]["role"] == "member"

    r = await c.member.get("/api/attendance/me/summary?from=2030-03-01&to=2030-03-31")
    assert r.status_code == 200
    body = r.json()
    assert body["from"] == "2030-03-01" and body["to"] == "2030-03-31"
    assert body["summary"]["worked_days"] == 0  # 오지 않은 날은 근무로 세지 않는다
    assert (
        await c.member.get("/api/attendance/me/summary?from=2030-03-02&to=2030-03-01")
    ).status_code == 422
    assert (
        await c.member.get("/api/attendance/me/summary?from=2030-01-01&to=2031-01-02")
    ).status_code == 422
    assert (await c.member.get("/api/attendance/me?month=2030-3")).status_code == 422


async def test_leave_overlap_is_409(c) -> None:
    r = await post(
        c.member,
        "/api/leaves",
        {"type_code": "annual", "start_date": "2030-03-04", "end_date": "2030-03-06"},
    )
    assert r.status_code == 201
    r = await post(c.member, "/api/leaves", {"type_code": "half_pm", "start_date": "2030-03-06"})
    assert r.status_code == 409 and r.json()["code"] == "CONFLICT"
    await post(
        c.member,
        f"/api/leaves/{(await c.member.get('/api/leaves')).json()['items'][0]['id']}/cancel",
    )
    r = await post(c.member, "/api/leaves", {"type_code": "half_pm", "start_date": "2030-03-06"})
    assert r.status_code == 201  # 취소한 휴가와는 안 겹친다


async def test_overtime_rules(c) -> None:
    """12시간 상한 422, 같은 날 겹침 409, 쉬는 날은 전 구간을 센다."""
    url = "/api/attendance/overtime"
    r = await post(
        c.member,
        url,
        {"work_date": "2030-03-04", "start_time": "18:00", "end_time": "06:30", "reason": "x"},
    )
    assert r.status_code == 422  # 12시간 30분
    r = await post(
        c.member,
        url,
        {"work_date": "2030-03-04", "start_time": "19:00", "end_time": "21:00", "reason": "x"},
    )
    assert r.status_code == 201
    r = await post(
        c.member,
        url,
        {"work_date": "2030-03-04", "start_time": "20:00", "end_time": "22:00", "reason": "x"},
    )
    assert r.status_code == 409 and r.json()["code"] == "CONFLICT"
    r = await post(
        c.member,
        url,
        {"work_date": "2030-03-04", "start_time": "21:00", "end_time": "22:00", "reason": "x"},
    )
    assert r.status_code == 201  # 맞닿기만 하면 겹침이 아니다
    r = await post(
        c.member,
        url,
        {"work_date": "2030-03-09", "start_time": "10:00", "end_time": "15:00", "reason": "x"},
    )
    assert r.status_code == 201 and r.json()["minutes"] == 300  # 토요일


async def test_correction_rules(c) -> None:
    url = "/api/attendance/corrections"
    r = await post(
        c.member, url, {"work_date": "2030-03-09", "after": {"note": "x"}, "reason": "x"}
    )
    assert r.status_code == 422  # 토요일
    for status in ("leave", "holiday"):
        r = await post(
            c.member, url, {"work_date": "2030-03-04", "after": {"status": status}, "reason": "x"}
        )
        assert r.status_code == 422, status
    r = await post(
        c.member, url, {"work_date": "2030-03-04", "after": {"status": "absent"}, "reason": "x"}
    )
    assert r.status_code == 201


async def test_calendar_masks_leave_type(c) -> None:
    """홈 캘린더의 남의 휴가는 종류를 'leave' 로 뭉갠다 — 본인·exec 만 원래 코드."""
    await post(
        c.member, "/api/leaves", {"type_code": "sick", "start_date": "2030-03-04", "reason": "감기"}
    )
    await _approve(c.member, c.lead, "[휴가]")
    q = "/api/leaves?scope=all&from=2030-03-01&to=2030-03-31"
    assert [i["type_code"] for i in (await c.lead.get(q)).json()["items"]] == ["leave"]
    assert [i["type_code"] for i in (await c.member.get(q)).json()["items"]] == ["sick"]
    assert [i["type_code"] for i in (await c.exec.get(q)).json()["items"]] == ["sick"]


async def test_report_keeps_inactive_with_rows(c, users: Users, app_db) -> None:
    """그달 승인된 근태가 있는 퇴사자는 리포트·그리드에 남고, 아무것도 없는 비활성 계정은 빠진다."""
    await post(c.member, "/api/leaves", {"type_code": "annual", "start_date": "2030-03-04"})
    await _approve(c.member, c.lead, "[휴가]")
    users.member.active = False
    app_db.add(User(name="가나다", email="gone@zenith.co.kr", pw_hash=PW_HASH, active=False))
    await app_db.flush()
    text = (await c.exec.get("/api/attendance/report?month=2030-03")).content.decode("utf-8")
    assert "김수진" in text and "가나다" not in text
    grid = (await c.exec.get("/api/attendance/team?month=2030-03")).json()["items"]
    assert "김수진" in [r["user"]["name"] for r in grid]
