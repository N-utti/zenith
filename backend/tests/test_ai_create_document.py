"""AI 문서 만들기(README 69) — /ai/chat 의 create_document 도구. 새 문서만, 질문자가 볼 수 있는 폴더에만,
목적지는 사용자가 정한 곳(질문 범위 폴더 또는 질문에 이름이 나온 폴더)에만."""

import uuid

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import func, select

from app.ai.provider import ToolCall
from app.models import AuditEvent, Document, Folder, Workspace
from app.routers import ai

from .conftest import Users, csrf, login
from .test_ai import _chat, share_scope
from .test_ai_rules import SearchingProvider, _reset
from .test_docs_import import ydoc_fragment

HTML = (
    "<h1>3분기 보고</h1><p>매출이 <strong>늘었다</strong>.</p><script>alert(1)</script>"
    '<table><tr><th>월</th><th>매출</th></tr><tr><td>7월</td><td onclick="x()">120</td></tr></table>'
)


async def _folders(app_db) -> tuple[Folder, Folder, Folder]:
    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    root = Folder(ws_id=ws.id, parent_id=None, title="회사 위키")
    app_db.add(root)
    await app_db.flush()
    plan = Folder(ws_id=ws.id, parent_id=root.id, title="기획")
    leads = Folder(ws_id=ws.id, parent_id=root.id, title="팀장방", min_role="lead")
    app_db.add_all([plan, leads])
    await app_db.flush()
    await app_db.commit()
    return root, plan, leads


def _calling(*calls: ToolCall, after: str = "만들었습니다."):
    """첫 턴에 주어진 도구 호출을 내고, 도구 결과가 오면 `after` 를 답하는 공급자(빈 문자열이면 빈 답)."""

    class Provider(SearchingProvider):
        async def stream(self, *, system, messages, max_tokens=None, tools=None, tool_choice=None):
            SearchingProvider.turns.append(messages)
            SearchingProvider.tools_seen.append(tools)
            last = messages[-1]["content"]
            if not (isinstance(last, list) and last and last[0].get("type") == "tool_result"):
                yield self.calls(*calls)
                return
            if after:
                yield after

    return Provider


def _start(app: FastAPI, monkeypatch, app_db, provider) -> None:
    _reset(app, provider)
    share_scope(monkeypatch, app_db)
    SearchingProvider.turns, SearchingProvider.tools_seen = [], []
    ai._ai_calls.clear()


def _results() -> dict[str, dict]:
    return {r["tool_use_id"]: r for r in SearchingProvider.turns[-1][-1]["content"]}


def _doc(tool_id: str, **inp) -> ToolCall:
    return ToolCall(
        id=tool_id, name="create_document", input={"title": "메모", "html": "<p>본문</p>"} | inp
    )


async def test_chat_creates_document(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    """모델이 create_document 를 부르면 질문자 이름으로 새 문서가 생긴다 — 본문은 필터를 지나고(script·onclick 제거),
    맨 위에 AI 초안 표시, AI 근거 스위치는 꺼짐, 감사 기록, 링크는 서버가 답에 넣는다. 못 보는 폴더는 「없는 폴더」,
    한 답변에 하나."""
    _, plan, _ = await _folders(app_db)
    _start(
        app,
        monkeypatch,
        app_db,
        _calling(
            # 팀장 전용 폴더 — member 에게는 없는 폴더다(이름도 목록에 안 나온다)
            _doc("hidden", folder="팀장방"),
            _doc(
                "ok",
                title=" 3분기\n보고](x)\\ ",
                html=HTML + "<p>a\x00b</p>",
                folder="회사 위키/기획",
            ),
            _doc("again", folder="기획"),
        ),
    )
    await login(client, "sujin@zenith.co.kr")
    ev = await _chat(client, "3분기 보고를 기획 폴더와 팀장방에 문서로 만들어 줘")
    assert "create_document" in [t["name"] for t in SearchingProvider.tools_seen[0]]
    assert ("status", {"text": "문서를 만드는 중"}) in ev
    res = _results()
    assert res["hidden"]["is_error"] is True and "그런 폴더가 없습니다" in res["hidden"]["content"]
    assert "회사 위키/기획" in res["hidden"]["content"] and "팀장방" not in res["hidden"]["content"]
    assert (
        "is_error" not in res["ok"]
        and "「회사 위키/기획」 폴더에 만들었습니다" in res["ok"]["content"]
    )
    assert "emit" not in res["ok"]  # 서버용 칸은 모델에게 가지 않는다
    assert res["again"]["is_error"] is True and "하나만" in res["again"]["content"]

    docs = (await app_db.execute(select(Document))).scalars().all()
    assert len(docs) == 1
    doc = docs[0]
    assert (doc.folder_id, doc.title, doc.updated_by) == (
        plan.id,
        "3분기 보고](x)\\",
        users.member.id,
    )
    assert doc.ai_source is False  # AI 가 쓴 글이 다음 답의 근거로 돌지 않는다
    assert "AI 어시스턴트가 작성한 초안" in doc.text_cache and "늘었다" in doc.text_cache
    assert (
        "alert" not in doc.text_cache and "ab" in doc.text_cache
    )  # NUL 은 지워진다(DB 가 거절한다)
    frag = ydoc_fragment(doc.ydoc_snapshot)
    assert frag.startswith("<paragraph><italic>AI 어시스턴트가 작성한 초안입니다.")
    assert '<heading level="1">3분기 보고</heading>' in frag and "<table>" in frag
    assert "onclick" not in frag and "script" not in frag
    answer = "".join(d["text"] for e, d in ev if e == "token")
    # 링크는 서버가 한 번 넣는다 — 링크 문법을 깨는 글자는 전각으로
    assert (
        answer.count(f"[📄 3분기 보고］(x）＼](/docs/{doc.id})") == 1 and "만들었습니다." in answer
    )
    created = await app_db.scalar(select(AuditEvent).where(AuditEvent.kind == "ai.doc_create"))
    assert created.actor_id == users.member.id and created.target_id == doc.id
    assert created.detail["folder"] == str(plan.id)
    refused = await app_db.scalar(select(AuditEvent).where(AuditEvent.kind == "ai.doc_refused"))
    assert refused.detail["folder"] == "팀장방"  # 못 보는 폴더를 노린 흔적
    # 편집기 초기 로드 — 만든 문서를 바로 연다
    r = await client.get(f"/api/docs/{doc.id}")
    assert r.status_code == 200 and r.json()["ydoc"] is not None
    # 팩트체커에는 문서 만들기 도구가 없다
    SearchingProvider.tools_seen = []
    await client.post("/api/ai/check", json={"text": "연차는 15일"}, headers=csrf(client))
    assert "create_document" not in [t["name"] for t in SearchingProvider.tools_seen[0]]


async def test_create_document_destination_is_the_users_choice(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    """목적지는 모델이 아니라 사용자가 정한다(보안 리뷰): 질문에 이름이 없는 폴더는 볼 수 있어도 거절 — 주입된 지시가
    팀장만 보는 자료를 전원 열람 폴더에 쓰게 하지 못한다. 폴더를 못 정하면 목록을 주고, 질문 범위 폴더면 만든다."""
    _, plan, leads = await _folders(app_db)
    await login(client, "donghyun@zenith.co.kr")
    # ① 팀장이 폴더를 말하지 않았는데 (주입된) 모델이 전원 열람 폴더 「기획」을 고른다
    _start(app, monkeypatch, app_db, _calling(_doc("c", folder="기획", html="<p>팀장방 기밀</p>")))
    await _chat(client, "팀장방 자료 요약해 줘")
    res = _results()["c"]
    assert res["is_error"] is True and "이번 질문에서 말한 폴더에만" in res["content"]
    assert await app_db.scalar(select(func.count(Document.id))) == 0
    assert (
        await app_db.scalar(
            select(func.count(AuditEvent.id)).where(AuditEvent.kind == "ai.doc_refused")
        )
        == 1
    )

    # ② folder 없이 부르면 만들지 않고 목록을 준다 — 모델이 사용자에게 묻는다(팀장은 팀장방도 본다)
    _start(app, monkeypatch, app_db, _calling(_doc("c")))
    await _chat(client, "메모를 문서로 만들어 줘")
    res = _results()["c"]
    assert res["is_error"] is True and "어디에 만들지 묻습니다" in res["content"]
    assert "- 회사 위키\n- 회사 위키/기획\n- 회사 위키/팀장방" in res["content"]
    assert await app_db.scalar(select(func.count(Document.id))) == 0

    # ③ 질문 범위(scope = 폴더 id)가 있으면 folder 없이도, 범위 폴더 이름을 대도 거기에
    await _chat(client, "메모를 문서로 만들어 줘", scope=str(leads.id))
    assert "is_error" not in _results()["c"]
    doc = await app_db.scalar(select(Document))
    assert doc.folder_id == leads.id and doc.updated_by == users.lead.id

    # ④ 하루 상한 — 감사 기록으로 센다
    monkeypatch.setattr(ai, "AI_DOCS_PER_DAY", 1)
    await _chat(client, "하나 더", scope=str(leads.id))
    res = _results()["c"]
    assert res["is_error"] is True and "문서 수를 넘었습니다" in res["content"]
    assert await app_db.scalar(select(func.count(Document.id))) == 1


async def test_document_link_survives_empty_answer(
    app: FastAPI, client: AsyncClient, users: Users, app_db, monkeypatch
) -> None:
    """문서를 만든 뒤 모델이 빈 답으로 끝나도(AI_EMPTY 재현, #560) 사용자는 링크를 받는다 — 서버가 답에 넣었다.
    링크 없이 오류로 끝나면 「다시 시도」마다 문서가 하나씩 늘었다(보안 리뷰)."""
    await _folders(app_db)
    _start(app, monkeypatch, app_db, _calling(_doc("c", folder="기획"), after=""))
    await login(client, "sujin@zenith.co.kr")
    ev = await _chat(client, "메모를 기획 폴더에 문서로 만들어 줘")
    doc = await app_db.scalar(select(Document))
    assert doc is not None
    assert not [e for e, _ in ev if e == "error"]
    assert f"](/docs/{doc.id})" in "".join(d["text"] for e, d in ev if e == "token")


def test_pick_folder_names() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    paths = {a: "위키/기획", b: "영업/기획", c: "영업"}
    assert ai._pick_folder(paths, " 영업 ", None, "영업 폴더에 넣어 줘") == c
    assert ai._pick_folder(paths, "/위키/기획/", None, "위키의 기획에") == a
    assert "여럿" in ai._pick_folder(
        paths, "기획", None, "기획에"
    )  # 끝 이름이 겹치면 고르지 않는다
    assert "말한 폴더에만" in ai._pick_folder(
        paths, "영업", None, "문서로 만들어 줘"
    )  # 질문에 없다
    assert (
        ai._pick_folder(paths, "영업", c, "문서로 만들어 줘") == c
    )  # 질문 범위 폴더는 이름이 없어도
    assert ai._pick_folder(paths, None, b, "문서로") == b
    assert "묻습니다" in ai._pick_folder(paths, None, uuid.uuid4(), "문서로")  # 못 보는 범위 폴더
    assert "폴더가 없습니다" in ai._pick_folder({}, "x", None, "x 에")
