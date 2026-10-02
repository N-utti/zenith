"""13 §9 전자결재 — 기안·상신·승인·반려·회수·강제 종결·위임·참조·첨부. 규칙은 프론트 목(mocks/approvalsDb.ts)과 같다."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import AuditEvent, Notification, Team, User, WorkArrangement
from app.routers.approvals import today

from .conftest import PW_HASH, Users, csrf, login


@asynccontextmanager
async def _as(make_client, email: str):
    async with make_client() as c:
        r = await login(c, email)
        assert r.status_code == 204, r.text
        yield c


@pytest.fixture
async def outsider(app_db) -> User:
    """결재선에도 참조에도 없는 다른 팀 사원."""
    team = Team(name="영업팀")
    app_db.add(team)
    await app_db.flush()
    user = User(
        name="이영희", email="yh@zenith.co.kr", pw_hash=PW_HASH, role="member", team_id=team.id
    )
    app_db.add(user)
    await app_db.flush()
    return user


@pytest.fixture
async def c(make_client, users: Users, outsider: User):
    """사원·팀장·임원·다른 팀 사원 네 브라우저."""
    async with (
        _as(make_client, "sujin@zenith.co.kr") as member,
        _as(make_client, "donghyun@zenith.co.kr") as lead,
        _as(make_client, "jaeho@zenith.co.kr") as exec_,
        _as(make_client, "yh@zenith.co.kr") as other,
    ):
        yield SimpleNamespace(member=member, lead=lead, exec=exec_, other=other)


async def post(c: AsyncClient, url: str, json=None):
    return await c.post(url, json=json, headers=csrf(c))


def draft(title="워크숍 대관", body="세미나실 대관료", amount=450_000, **extra) -> dict:
    return {
        "type_code": "general",
        "title": title,
        "subject": {"body": body, "amount": amount, "related": None},
        **extra,
    }


async def _submitted(c, **kw) -> dict:
    r = await post(c.member, "/api/approvals/drafts", draft(**kw))
    assert r.status_code == 201, r.text
    r = await post(c.member, f"/api/approvals/{r.json()['id']}/submit")
    assert r.status_code == 200, r.text
    return r.json()


async def _denied(app_db, actor_id) -> list[AuditEvent]:
    rows = await app_db.scalars(
        select(AuditEvent).where(AuditEvent.kind == "acl.denied", AuditEvent.actor_id == actor_id)
    )
    return list(rows)


async def test_types(c) -> None:
    r = await c.member.get("/api/approval-types")
    assert r.status_code == 200
    types = {t["code"]: t for t in r.json()["items"]}
    assert set(types) == {"leave", "arrangement", "overtime", "correction", "general"}
    assert types["leave"]["allow_delegate_decision"] is True
    assert types["overtime"]["allow_delegate_decision"] is False


async def test_draft_submit_approve_flow(c, users: Users, app_db) -> None:
    """기안 → 상신(결재선 고정: 팀장 → 임원) → 팀장 승인 → 임원 승인 → 확정. 차례가 아니면 403, version 이 낡으면 409."""
    r = await post(c.member, "/api/approvals/drafts", draft())
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["status"] == "draft" and doc["steps"] == [] and doc["can_decide"] is False
    assert doc["drafter"]["name"] == "김수진" and doc["amount"] == 450_000
    assert "attachments" not in doc["subject"] or doc["subject"]["attachments"] is None

    r = await c.member.patch(
        f"/api/approvals/drafts/{doc['id']}",
        json=draft(title="  고친 제목 "),
        headers=csrf(c.member),
    )
    assert r.status_code == 200 and r.json()["title"] == "고친 제목"
    r = await c.member.get("/api/approvals?box=draft")
    assert [i["id"] for i in r.json()["items"]] == [doc["id"]]

    r = await post(c.member, f"/api/approvals/{doc['id']}/submit")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["status"] == "pending" and doc["submitted_at"]
    assert [(s["approver"]["name"], s["role"], s["status"]) for s in doc["steps"]] == [
        ("박동현", "approve", "waiting"),
        ("최재호", "approve", "waiting"),
    ]
    assert doc["current_step"] == 1 and doc["waiting_on"]["name"] == "박동현"
    # 상신한 문서는 고칠 수도, 다시 상신할 수도 없다
    r = await c.member.patch(
        f"/api/approvals/drafts/{doc['id']}", json=draft(), headers=csrf(c.member)
    )
    assert r.status_code == 409 and r.json()["code"] == "NOT_DRAFT"
    r = await post(c.member, f"/api/approvals/{doc['id']}/submit")
    assert r.status_code == 409 and r.json()["code"] == "NOT_DRAFT"

    # 팀장 받은 결재함에 뜨고, 임원 것엔 아직 없다
    inbox = (await c.lead.get("/api/approvals?box=inbox")).json()["items"]
    assert [i["id"] for i in inbox] == [doc["id"]]
    assert (await c.exec.get("/api/approvals?box=inbox")).json()["items"] == []
    assert (await c.lead.get(f"/api/approvals/{doc['id']}")).json()["can_decide"] is True
    # 임원도 열람은 된다(전사 조회) — 차례는 아니다
    assert (await c.exec.get(f"/api/approvals/{doc['id']}")).json()["can_decide"] is False

    r = await post(c.exec, f"/api/approvals/{doc['id']}/approve", {"version": 1})
    assert r.status_code == 403 and r.json()["code"] == "NOT_YOUR_TURN"
    assert [d.detail["reason"] for d in await _denied(app_db, users.exec.id)] == ["not_your_turn"]
    r = await post(c.lead, f"/api/approvals/{doc['id']}/approve", {"version": 7})
    assert r.status_code == 409 and r.json()["code"] == "VERSION_CONFLICT"

    r = await post(
        c.lead, f"/api/approvals/{doc['id']}/approve", {"version": 1, "comment": "좋습니다"}
    )
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["steps"][0]["status"] == "approved" and doc["steps"][0]["comment"] == "좋습니다"
    assert doc["steps"][0]["version"] == 2 and doc["steps"][0]["acted_by"] is None
    assert doc["status"] == "pending" and doc["waiting_on"]["name"] == "최재호"
    # 같은 버전으로 두 번 누르면(다른 탭) 권한 거부가 아니라 상태 충돌
    r = await post(c.lead, f"/api/approvals/{doc['id']}/approve", {"version": 1})
    assert r.status_code == 409 and r.json()["code"] == "ALREADY_DECIDED"

    r = await post(c.exec, f"/api/approvals/{doc['id']}/approve", {"version": 1})
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["status"] == "approved" and doc["closed_at"] and doc["waiting_on"] is None

    sent = (await c.member.get("/api/approvals?box=sent")).json()["items"]
    assert [(i["id"], i["status"]) for i in sent] == [(doc["id"], "approved")]
    kinds = {
        (n.user_id, n.kind)
        for n in await app_db.scalars(select(Notification).where(Notification.kind.like("apv_%")))
    }
    assert kinds == {
        (users.lead.id, "apv_request"),
        (users.exec.id, "apv_request"),
        (users.member.id, "apv_approved"),
    }


async def test_reject_then_redraft(c) -> None:
    """반려는 사유가 없으면 400, 반려되면 뒤 단계는 skipped. 반려 문서는 고칠 수 없고 새로 기안한다."""
    doc = await _submitted(c)
    url = f"/api/approvals/{doc['id']}/reject"
    r = await post(c.lead, url, {"version": 1, "reason": "  "})
    assert r.status_code == 400 and r.json()["code"] == "REASON_REQUIRED"
    r = await post(c.lead, url, {"version": 1, "reason": "금액 확인 필요"})
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["status"] == "rejected"
    assert [s["status"] for s in doc["steps"]] == ["rejected", "skipped"]
    assert doc["steps"][0]["comment"] == "금액 확인 필요"
    r = await c.member.patch(
        f"/api/approvals/drafts/{doc['id']}", json=draft(), headers=csrf(c.member)
    )
    assert r.status_code == 409
    again = await _submitted(c, title="워크숍 대관(재작성)")
    assert again["status"] == "pending" and again["id"] != doc["id"]


async def test_cancel(c) -> None:
    """회수는 기안자만, 대기 중이고 아무도 처리하지 않았을 때만(13 FR-APV-06)."""
    doc = await _submitted(c)
    r = await post(c.lead, f"/api/approvals/{doc['id']}/cancel")
    assert r.status_code == 404  # 남의 문서는 없는 것과 같다
    r = await post(c.member, f"/api/approvals/{doc['id']}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "canceled"
    assert [s["status"] for s in r.json()["steps"]] == ["skipped", "skipped"]
    r = await post(c.member, f"/api/approvals/{doc['id']}/cancel")
    assert r.status_code == 409 and r.json()["code"] == "NOT_PENDING"

    doc = await _submitted(c)
    await post(c.lead, f"/api/approvals/{doc['id']}/approve", {"version": 1})
    r = await post(c.member, f"/api/approvals/{doc['id']}/cancel")
    assert r.status_code == 409 and r.json()["code"] == "STEP_APPROVED"


async def test_exec_draft_is_approved_at_once(c) -> None:
    """TC-APV-04: 임원이 기안하면 결재선이 비어 즉시 확정된다. 참조자만 걸려도 마찬가지."""
    r = await post(c.exec, "/api/approvals/drafts", draft())
    doc = r.json()
    r = await post(c.exec, f"/api/approvals/{doc['id']}/submit")
    assert r.json()["status"] == "approved" and r.json()["steps"] == []


async def test_force_close(c, users: Users, app_db) -> None:
    """임원만, 대기 중만, 사유 필수. 걸려 있던 단계에 사유와 처리자를 남기고 감사에 기록한다."""
    doc = await _submitted(c)
    url = f"/api/approvals/{doc['id']}/force-close"
    r = await post(c.lead, url, {"reason": "x"})
    assert r.status_code == 403
    assert len(await _denied(app_db, users.lead.id)) == 1
    r = await post(c.exec, url, {"reason": " "})
    assert r.status_code == 400 and r.json()["code"] == "REASON_REQUIRED"
    r = await post(c.exec, url, {"reason": "결재자 장기 부재"})
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["status"] == "closed"
    first = doc["steps"][0]
    assert first["comment"] == "결재자 장기 부재" and first["acted_by"]["name"] == "최재호"
    assert [s["status"] for s in doc["steps"]] == ["skipped", "skipped"]
    event = await app_db.scalar(
        select(AuditEvent).where(AuditEvent.kind == "approvals.force_closed")
    )
    assert event.detail["reason"] == "결재자 장기 부재" and event.actor_id == users.exec.id
    r = await post(c.exec, url, {"reason": "다시"})
    assert r.status_code == 409 and r.json()["code"] == "NOT_PENDING"


async def test_view_permission_and_references(
    c, users: Users, outsider: User, app_db, make_client
) -> None:
    """열람은 관계로: 남의 문서 403 + acl.denied. 참조자는 상신한 뒤에만 보고, 결재 차례를 가로채지 않는다."""
    r = await post(c.member, "/api/approvals/drafts", draft(references=[str(outsider.id)]))
    doc = r.json()
    assert [(s["role"], s["status"]) for s in doc["steps"]] == [("reference", "skipped")]
    r = await c.other.get(f"/api/approvals/{doc['id']}")
    assert r.status_code == 403  # 상신 전 초안은 참조자도 못 연다
    assert (await c.other.get("/api/approvals?box=reference")).json()["items"] == []

    r = await post(c.member, f"/api/approvals/{doc['id']}/submit")
    steps = r.json()["steps"]
    assert [(s["approver"]["name"], s["role"]) for s in steps] == [
        ("박동현", "approve"),
        ("최재호", "approve"),
        ("이영희", "reference"),
    ]
    assert r.json()["waiting_on"]["name"] == "박동현"
    assert (await c.other.get(f"/api/approvals/{doc['id']}")).status_code == 200
    ref = (await c.other.get("/api/approvals?box=reference")).json()["items"]
    assert [i["id"] for i in ref] == [doc["id"]]

    # 관계없는 사람 — 같은 팀 사원도 아니고 결재선에도 없다
    stranger = User(name="정우성", email="ws@zenith.co.kr", pw_hash=PW_HASH, role="member")
    app_db.add(stranger)
    await app_db.flush()
    async with _as(make_client, "ws@zenith.co.kr") as s:
        r = await s.get(f"/api/approvals/{doc['id']}")
        assert r.status_code == 403 and r.json()["code"] == "FORBIDDEN"
    assert [d.detail["reason"] for d in await _denied(app_db, stranger.id)] == ["view"]


async def test_reference_validation(c, users: Users) -> None:
    """참조자: 결재자·기안자는 빠지고, 없는 사람·겹친 사람은 422."""
    r = await post(c.member, "/api/approvals/drafts", draft(references=[str(users.lead.id)] * 2))
    assert r.status_code == 422
    r = await post(
        c.member,
        "/api/approvals/drafts",
        draft(references=["00000000-0000-0000-0000-000000000000"]),
    )
    assert r.status_code == 422
    r = await post(
        c.member,
        "/api/approvals/drafts",
        draft(references=[str(users.lead.id), str(users.member.id)]),
    )
    doc = (await post(c.member, f"/api/approvals/{r.json()['id']}/submit")).json()
    assert [(s["approver"]["name"], s["role"]) for s in doc["steps"]] == [
        ("박동현", "approve"),
        ("최재호", "approve"),
    ]
    # PATCH: 생략은 그대로, [] 는 전부 해제
    r = await post(c.member, "/api/approvals/drafts", draft(references=[str(users.exec.id)]))
    url = f"/api/approvals/drafts/{r.json()['id']}"
    r = await c.member.patch(url, json=draft(), headers=csrf(c.member))
    assert len(r.json()["steps"]) == 1
    r = await c.member.patch(url, json=draft(references=[]), headers=csrf(c.member))
    assert r.json()["steps"] == []


async def test_draft_validation(c, users: Users, outsider: User, app_db) -> None:
    """v1 은 일반 기안만, 제목 필수, 새로 만들 때는 첨부를 못 받고, 남의 문서 첨부·남의 출장은 못 건다."""
    r = await post(c.member, "/api/approvals/drafts", {**draft(), "type_code": "leave"})
    assert r.status_code == 422
    r = await post(c.member, "/api/approvals/drafts", draft(title="   "))
    assert r.status_code == 422
    r = await post(c.member, "/api/approvals/drafts", draft(amount=-1))
    assert r.status_code == 422
    att = {"url": "/api/approvals/x/attachments/y/a.pdf", "name": "a.pdf", "size": 1}
    body = draft()
    body["subject"]["attachments"] = [att]
    r = await post(c.member, "/api/approvals/drafts", body)
    assert r.status_code == 422
    doc = (await post(c.member, "/api/approvals/drafts", draft())).json()
    other = (await post(c.member, "/api/approvals/drafts", draft())).json()
    att["url"] = f"/api/approvals/{other['id']}/attachments/{users.member.id}/a.pdf"
    r = await c.member.patch(
        f"/api/approvals/drafts/{doc['id']}", json=body, headers=csrf(c.member)
    )
    assert r.status_code == 422  # 다른 문서 경로의 url
    # 본문 없이 상신 422
    empty = (await post(c.member, "/api/approvals/drafts", draft(body=" "))).json()
    r = await post(c.member, f"/api/approvals/{empty['id']}/submit")
    assert r.status_code == 422

    # 출장비 결의서는 내 출장에만 건다 — 남의 출장 id 는 422
    theirs = WorkArrangement(
        user_id=outsider.id,
        kind="trip",
        start_date=today(),
        end_date=today(),
        reason="x",
        approval_id=doc["id"],
    )
    app_db.add(theirs)
    await app_db.flush()
    body = draft()
    body["subject"]["related"] = {"type": "arrangement", "id": str(theirs.id)}
    r = await post(c.member, "/api/approvals/drafts", body)
    assert r.status_code == 422


async def test_delete_draft(c, app_db) -> None:
    """#281: 내 임시저장만 204, 남의 것·없는 것 404, 상신한 적 있으면 409 NOT_DRAFT. 감사 없음."""
    doc = (await post(c.member, "/api/approvals/drafts", draft())).json()
    r = await c.lead.delete(f"/api/approvals/drafts/{doc['id']}", headers=csrf(c.lead))
    assert r.status_code == 404
    r = await c.member.delete(f"/api/approvals/drafts/{doc['id']}", headers=csrf(c.member))
    assert r.status_code == 204
    r = await c.member.delete(f"/api/approvals/drafts/{doc['id']}", headers=csrf(c.member))
    assert r.status_code == 404
    sent = await _submitted(c)
    r = await c.member.delete(f"/api/approvals/drafts/{sent['id']}", headers=csrf(c.member))
    assert r.status_code == 409 and r.json()["code"] == "NOT_DRAFT"
    assert (
        await app_db.scalar(select(AuditEvent).where(AuditEvent.kind.like("approvals.%")))
    ) is None


async def test_delegation(c, users: Users, outsider: User, app_db) -> None:
    """위임: 규칙 검증 → 위임받은 사람의 받은 결재함·열람·대결 → 원 결재자 이름이 남고 delegated_done, 회수 불가."""
    d = today().isoformat()
    url = "/api/approvals/delegations"
    me = {"delegate_id": str(users.lead.id), "start_date": d, "end_date": d}
    assert (await post(c.lead, url, me)).status_code == 422  # 자기 자신
    bad = {"delegate_id": str(outsider.id), "start_date": d, "end_date": "2000-01-01"}
    assert (await post(c.lead, url, bad)).status_code == 422
    r = await post(c.lead, url, {**bad, "end_date": d, "type_code": "overtime"})
    assert r.status_code == 422 and r.json()["code"] == "DELEGATE_NOT_ALLOWED"
    r = await post(c.lead, url, {**bad, "end_date": d})
    assert r.status_code == 201, r.text
    made = r.json()
    assert made["delegate"]["name"] == "이영희" and made["type_code"] is None
    r = await post(c.lead, url, {**bad, "end_date": d, "type_code": "general"})
    assert r.status_code == 409 and r.json()["code"] == "DELEGATION_OVERLAP"
    assert [i["id"] for i in (await c.lead.get(url)).json()["items"]] == [made["id"]]
    assert (await c.other.get(url)).json()["items"] == []  # 내가 건 것만

    doc = await _submitted(c)
    inbox = (await c.other.get("/api/approvals?box=inbox")).json()["items"]
    assert [i["id"] for i in inbox] == [doc["id"]]
    seen = (await c.other.get(f"/api/approvals/{doc['id']}")).json()
    assert seen["can_decide"] is True
    r = await post(c.other, f"/api/approvals/{doc['id']}/approve", {"version": 1})
    assert r.status_code == 200, r.text
    step = r.json()["steps"][0]
    assert step["status"] == "delegated_done" and step["approver"]["name"] == "박동현"
    assert step["acted_by"]["name"] == "이영희"
    # 대신 눌러 준 뒤에도 본다. 기안자는 대결 승인을 거둘 수 없다
    assert (await c.other.get(f"/api/approvals/{doc['id']}")).status_code == 200
    r = await post(c.member, f"/api/approvals/{doc['id']}/cancel")
    assert r.status_code == 409 and r.json()["code"] == "STEP_APPROVED"

    r = await c.other.delete(f"{url}/{made['id']}", headers=csrf(c.other))
    assert r.status_code == 404  # 남의 위임
    r = await c.lead.delete(f"{url}/{made['id']}", headers=csrf(c.lead))
    assert r.status_code == 204
    kinds = [e.kind for e in await app_db.scalars(select(AuditEvent).order_by(AuditEvent.at))]
    assert "approvals.delegation_created" in kinds and "approvals.delegation_deleted" in kinds


async def test_expired_delegation_and_self_approval(c, users: Users) -> None:
    """지난 위임으로는 대신 결재할 수 없다. 위임받은 기안자도 자기 문서는 처리하지 못한다."""
    past = (today() - timedelta(days=3)).isoformat()
    r = await post(
        c.lead,
        "/api/approvals/delegations",
        {"delegate_id": str(users.member.id), "start_date": past, "end_date": past},
    )
    assert r.status_code == 201
    doc = await _submitted(c)
    assert (await c.member.get("/api/approvals?box=inbox")).json()["items"] == []
    d = today().isoformat()
    r = await post(
        c.lead,
        "/api/approvals/delegations",
        {"delegate_id": str(users.member.id), "start_date": d, "end_date": d},
    )
    assert r.status_code == 201
    r = await post(c.member, f"/api/approvals/{doc['id']}/approve", {"version": 1})
    assert r.status_code == 403 and r.json()["code"] == "NOT_YOUR_TURN"


async def test_list_filters(c, users: Users) -> None:
    a = await _submitted(c, title="가")
    await post(c.lead, f"/api/approvals/{a['id']}/reject", {"version": 1, "reason": "x"})
    b = await _submitted(c, title="나")
    r = await c.member.get("/api/approvals?box=sent&status=rejected")
    assert [i["id"] for i in r.json()["items"]] == [a["id"]]
    r = await c.exec.get(f"/api/approvals?box=sent&drafter={users.member.id}")
    assert r.json()["items"] == []  # 보낸 결재는 내 것만
    r = await c.lead.get(f"/api/approvals?box=inbox&type=general&drafter={users.member.id}")
    assert [i["id"] for i in r.json()["items"]] == [b["id"]]
    d = today().isoformat()
    r = await c.member.get(f"/api/approvals?box=sent&from={d}&to={d}")
    assert {i["id"] for i in r.json()["items"]} == {a["id"], b["id"]}
    r = await c.member.get("/api/approvals?box=sent&to=2000-01-01")
    assert r.json()["items"] == []
    assert (await c.member.get("/api/approvals?box=nope")).status_code == 422


PDF = b"%PDF-1.4 receipt"


async def _upload(c: AsyncClient, doc_id: str, name: str = "영수증.pdf", data: bytes = PDF):
    return await c.post(
        f"/api/approvals/{doc_id}/attachments",
        files={"file": (name, data, "application/pdf")},
        headers=csrf(c),
    )


async def test_attachments(c, users: Users, app_db, minio_bucket) -> None:
    """올리기는 내 임시저장에만, 받기는 문서를 열 수 있는 사람만·붙어 있는 파일만. 임시저장을 지우면 파일도 지운다."""
    from app import storage

    doc = (await post(c.member, "/api/approvals/drafts", draft())).json()
    assert (await _upload(c.lead, doc["id"])).status_code == 404  # 남의 문서
    r = await _upload(c.member, doc["id"])
    assert r.status_code == 201, r.text
    att = r.json()
    assert att["url"].startswith(f"/api/approvals/{doc['id']}/attachments/")
    assert (await c.member.get(att["url"])).status_code == 404  # 아직 문서에 안 붙였다

    body = draft()
    body["subject"]["attachments"] = [att]
    r = await c.member.patch(
        f"/api/approvals/drafts/{doc['id']}", json=body, headers=csrf(c.member)
    )
    assert r.status_code == 200, r.text
    got = await c.member.get(att["url"])
    assert got.status_code == 200 and got.content == PDF
    assert got.headers["content-disposition"].startswith("attachment;")
    assert got.headers["x-content-type-options"] == "nosniff"
    assert (await c.lead.get(att["url"])).status_code == 403  # 상신 전엔 결재선도 없다

    await post(c.member, f"/api/approvals/{doc['id']}/submit")
    assert (await c.lead.get(att["url"])).status_code == 200
    assert (await c.other.get(att["url"])).status_code == 403
    assert (await _upload(c.member, doc["id"])).status_code == 409  # 상신 뒤엔 굳는다
    denied = await _denied(app_db, users.lead.id)
    assert [d.detail["reason"] for d in denied] == ["attachment"]

    # 임시저장을 지우면 그 문서의 첨부도 지운다(#281)
    gone = (await post(c.member, "/api/approvals/drafts", draft())).json()
    att = (await _upload(c.member, gone["id"])).json()
    body["subject"]["attachments"] = [att]
    await c.member.patch(f"/api/approvals/drafts/{gone['id']}", json=body, headers=csrf(c.member))
    r = await c.member.delete(f"/api/approvals/drafts/{gone['id']}", headers=csrf(c.member))
    assert r.status_code == 204
    client = storage._client()
    left = list(
        client.list_objects(minio_bucket, prefix=f"approvals/{gone['id']}/", recursive=True)
    )
    assert left == []


async def test_reclick_after_close_is_409(c) -> None:
    """끝난 문서를 다시 누르면 409 NOT_PENDING — 403 + acl.denied 로 잡히지 않는다."""
    doc = await _submitted(c)
    await post(c.lead, f"/api/approvals/{doc['id']}/reject", {"version": 1, "reason": "x"})
    r = await post(c.lead, f"/api/approvals/{doc['id']}/approve", {"version": 2})
    assert r.status_code == 409 and r.json()["code"] == "NOT_PENDING"
    r = await post(c.exec, f"/api/approvals/{doc['id']}/reject", {"version": 1, "reason": "x"})
    assert r.status_code == 409


async def test_line_without_team_lead_starts_at_exec(c, users: Users, app_db) -> None:
    """lead_id 가 NULL 인 팀(관리 화면으로 만든 팀)의 사원은 결재선이 임원부터 — role=lead 는 보지 않는다."""
    users.team.lead_id = None
    await app_db.flush()
    doc = await _submitted(c)
    assert [s["approver"]["name"] for s in doc["steps"]] == ["최재호"]


async def test_no_active_exec_is_422(c, users: Users, app_db) -> None:
    users.exec.active = False
    users.team.lead_id = None  # 팀장도 없는 팀
    await app_db.flush()
    r = await post(c.member, "/api/approvals/drafts", draft())
    r = await post(c.member, f"/api/approvals/{r.json()['id']}/submit")
    assert r.status_code == 422  # 결재할 사람이 없다고 자동 확정하지 않는다


async def test_two_execs_make_three_steps(c, users: Users, app_db, make_client) -> None:
    """활성 exec 전원이 계정 만든 순으로 선다 — 팀장 → 임원 1 → 임원 2 를 차례로 거쳐 확정."""
    # 같은 트랜잭션의 now() 는 같은 값이라 만든 순서를 시각으로 정해 준다
    later = datetime.now(UTC) + timedelta(days=1)
    second = User(
        name="한대표", email="ceo@zenith.co.kr", pw_hash=PW_HASH, role="exec", created_at=later
    )
    app_db.add(second)
    await app_db.flush()
    doc = await _submitted(c)
    assert [s["approver"]["name"] for s in doc["steps"]] == ["박동현", "최재호", "한대표"]
    await post(c.lead, f"/api/approvals/{doc['id']}/approve", {"version": 1})
    r = await post(c.exec, f"/api/approvals/{doc['id']}/approve", {"version": 1})
    assert r.json()["status"] == "pending" and r.json()["waiting_on"]["name"] == "한대표"
    async with _as(make_client, "ceo@zenith.co.kr") as ceo:
        r = await post(ceo, f"/api/approvals/{doc['id']}/approve", {"version": 1})
    assert r.json()["status"] == "approved"


async def test_delegation_segregation_of_duties(c, users: Users) -> None:
    """같은 문서의 다른 승인 단계 결재자는 대결하지 못한다 — 한 사람이 두 단계를 채우지 않게."""
    d = today().isoformat()
    r = await post(
        c.lead,
        "/api/approvals/delegations",
        {"delegate_id": str(users.exec.id), "start_date": d, "end_date": d},
    )
    assert r.status_code == 201
    doc = await _submitted(c)  # 박동현 → 최재호, 박동현이 최재호에게 위임
    assert (await c.exec.get("/api/approvals?box=inbox")).json()["items"] == []
    assert (await c.exec.get(f"/api/approvals/{doc['id']}")).json()["can_decide"] is False
    r = await post(c.exec, f"/api/approvals/{doc['id']}/approve", {"version": 1})
    assert r.status_code == 403 and r.json()["code"] == "NOT_YOUR_TURN"


async def test_attendance_delegation(c, users: Users, outsider: User, app_db) -> None:
    """근태 문서 대결: 휴가는 위임 가능 유형이라 대결되고, 연장근로는 '모든 유형' 위임으로도 안 넘어간다."""
    d = today().isoformat()
    r = await post(
        c.lead,
        "/api/approvals/delegations",
        {"delegate_id": str(outsider.id), "start_date": d, "end_date": d},
    )
    assert r.status_code == 201
    await post(c.member, "/api/leaves", {"type_code": "annual", "start_date": "2030-03-04"})
    await post(
        c.member,
        "/api/attendance/overtime",
        {"work_date": "2030-03-05", "start_time": "18:00", "end_time": "20:00", "reason": "x"},
    )
    inbox = (await c.other.get("/api/approvals?box=inbox")).json()["items"]
    assert [i["type_code"] for i in inbox] == ["leave"]
    r = await post(c.other, f"/api/approvals/{inbox[0]['id']}/approve", {"version": 1})
    assert r.status_code == 200 and r.json()["steps"][0]["status"] == "delegated_done"
    lead_inbox = (await c.lead.get("/api/approvals?box=inbox")).json()["items"]
    ot = next(i for i in lead_inbox if i["type_code"] == "overtime")
    r = await post(c.other, f"/api/approvals/{ot['id']}/approve", {"version": 1})
    assert r.status_code == 403
    leaves = (await c.member.get("/api/leaves?scope=me")).json()["items"]
    assert leaves[0]["status"] == "approved"
    decided = await app_db.scalar(select(AuditEvent).where(AuditEvent.kind == "approvals.decided"))
    assert decided.detail["acting_for"] == str(users.lead.id) and decided.actor_id == outsider.id


async def test_delegation_period_limit_and_auto_approve_audit(c, users: Users, app_db) -> None:
    d = today()
    r = await post(
        c.lead,
        "/api/approvals/delegations",
        {
            "delegate_id": str(users.member.id),
            "start_date": d.isoformat(),
            "end_date": (d + timedelta(days=366)).isoformat(),
        },
    )
    assert r.status_code == 422
    doc = (await post(c.exec, "/api/approvals/drafts", draft())).json()
    await post(c.exec, f"/api/approvals/{doc['id']}/submit")
    event = await app_db.scalar(
        select(AuditEvent).where(AuditEvent.kind == "approvals.auto_approved")
    )
    assert event is not None and event.actor_id == users.exec.id
