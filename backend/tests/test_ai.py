"""04-API §8 — /ai/chat SSE 프레이밍·doc-action·template·feedback. 실제 Claude 호출 없이 공급자를 바꿔 끼운다."""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from app.ai.provider import LLMError, get_provider
from app.models import AiFeedback, Document, Folder, Workspace

from .conftest import Users, csrf, login


class FakeProvider:
    def models(self) -> list[dict[str, object]]:
        return [{"name": "fake-model", "size": None}]

    async def stream(self, *, system: str, messages: list[dict[str, str]]) -> AsyncIterator[str]:
        assert messages == [{"role": "user", "content": "안녕"}]
        yield "안녕"
        yield "하세요"


class BrokenProvider(FakeProvider):
    async def stream(self, *, system: str, messages: list[dict[str, str]]) -> AsyncIterator[str]:
        raise LLMError("AI_UNREACHABLE", "AI 서비스에 연결할 수 없습니다.")
        yield  # 비동기 제너레이터로 만들기 위한 도달 불가 yield


async def test_models(app: FastAPI, client: AsyncClient, member) -> None:
    app.dependency_overrides[get_provider] = FakeProvider
    r = await client.get("/api/ai/models")
    assert r.status_code == 200
    assert r.json() == [{"name": "fake-model", "size": None}]


async def test_chat_streams_sse(app: FastAPI, client: AsyncClient, member) -> None:
    app.dependency_overrides[get_provider] = FakeProvider
    r = await client.post("/api/ai/chat", json={"message": "안녕"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.text == (
        'event: token\ndata: {"text": "안녕"}\n\n'
        'event: token\ndata: {"text": "하세요"}\n\n'
        "event: citations\ndata: []\n\n"
        "event: done\ndata: {}\n\n"
    )


async def test_chat_reports_provider_error_as_event(
    app: FastAPI, client: AsyncClient, member
) -> None:
    app.dependency_overrides[get_provider] = BrokenProvider
    r = await client.post("/api/ai/chat", json={"message": "안녕"})
    assert r.status_code == 200
    assert r.text == (
        'event: error\ndata: {"detail": "AI 서비스에 연결할 수 없습니다.", "code": "AI_UNREACHABLE"}\n\n'
    )


async def test_chat_requires_login(client: AsyncClient) -> None:
    r = await client.post("/api/ai/chat", json={"message": "안녕"})
    assert r.status_code == 401


class CrashingProvider(FakeProvider):
    """API 키가 없을 때의 SDK 처럼, 토큰을 내다가 LLMError 가 아닌 예외로 죽는다."""

    async def stream(self, *, system: str, messages: list[dict[str, str]]) -> AsyncIterator[str]:
        yield "안"
        raise TypeError("Could not resolve authentication method.")


async def test_chat_reports_unexpected_error_as_event(
    app: FastAPI, client: AsyncClient, member, caplog
) -> None:
    """스트림이 말없이 끊기지 않는다 — 받은 데까지 보내고 error 로 닫는다. 원인은 로그에만 남는다."""
    app.dependency_overrides[get_provider] = CrashingProvider
    r = await client.post("/api/ai/chat", json={"message": "안녕"})
    assert r.status_code == 200
    assert r.text == (
        'event: token\ndata: {"text": "안"}\n\n'
        'event: error\ndata: {"detail": "AI 답변을 만들지 못했습니다.", "code": "INTERNAL"}\n\n'
    )
    assert "Could not resolve authentication method" in caplog.text


# ── /ai/doc-action · /ai/template · /ai/feedback (README 37) ──────────────────


class EchoProvider(FakeProvider):
    """받은 프롬프트를 남기고 정해 둔 답을 토막 내 흘린다."""

    reply = "## 회의 개요\n\n- 일시:\n- 장소:\n\n| 안건 | 결정 |\n| --- | --- |\n|  |  |"
    seen: list[dict[str, str]] = []

    async def stream(self, *, system: str, messages: list[dict[str, str]]) -> AsyncIterator[str]:
        EchoProvider.seen = messages
        for i in range(0, len(self.reply), 7):
            yield self.reply[i : i + 7]


async def _doc_with_text(app_db, text: str | None, *, trashed: bool = False) -> Document:
    ws = Workspace(name="제니스")
    app_db.add(ws)
    await app_db.flush()
    root = Folder(ws_id=ws.id, parent_id=None, title="회사 위키")
    app_db.add(root)
    await app_db.flush()
    doc = Document(
        folder_id=root.id,
        title="주간 회의",
        text_cache=text,
        deleted_at=datetime.now(UTC) if trashed else None,
    )
    app_db.add(doc)
    await app_db.flush()
    return doc


async def test_doc_action_reads_doc_text(
    app: FastAPI, client: AsyncClient, users: Users, app_db
) -> None:
    app.dependency_overrides[get_provider] = EchoProvider
    doc = await _doc_with_text(app_db, "이번 주 결정: 배포는 금요일.")
    await login(client, "sujin@zenith.co.kr")
    r = await client.post(
        "/api/ai/doc-action",
        json={"doc_id": str(doc.id), "action": "summarize"},
        headers=csrf(client),
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"draft": EchoProvider.reply}
    prompt = EchoProvider.seen[0]["content"]
    assert "주간 회의" in prompt and "배포는 금요일" in prompt and "요약" in prompt


async def test_doc_action_missing_or_trashed_doc_is_404(
    app: FastAPI, client: AsyncClient, users: Users, app_db
) -> None:
    app.dependency_overrides[get_provider] = EchoProvider
    trashed = await _doc_with_text(app_db, "x", trashed=True)
    await login(client, "sujin@zenith.co.kr")
    for doc_id in (trashed.id, uuid.uuid4()):
        r = await client.post(
            "/api/ai/doc-action",
            json={"doc_id": str(doc_id), "action": "polish"},
            headers=csrf(client),
        )
        assert (r.status_code, r.json()["code"]) == (404, "NOT_FOUND")


async def test_doc_action_validation(app: FastAPI, client: AsyncClient, member) -> None:
    app.dependency_overrides[get_provider] = EchoProvider
    r = await client.post("/api/ai/doc-action", json={"doc_id": str(uuid.uuid4()), "action": "x"})
    assert (r.status_code, r.json()["code"]) == (422, "VALIDATION")
    assert r.json()["detail"][0]["loc"] == ["body", "action"]


async def test_doc_action_provider_error_is_503(
    app: FastAPI, client: AsyncClient, users: Users, app_db
) -> None:
    app.dependency_overrides[get_provider] = BrokenProvider
    doc = await _doc_with_text(app_db, None)
    await login(client, "sujin@zenith.co.kr")
    r = await client.post(
        "/api/ai/doc-action",
        json={"doc_id": str(doc.id), "action": "table"},
        headers=csrf(client),
    )
    assert r.status_code == 503
    assert r.json() == {"detail": "AI 서비스에 연결할 수 없습니다.", "code": "AI_UNREACHABLE"}


async def test_template_splits_markdown_blocks(app: FastAPI, client: AsyncClient, member) -> None:
    app.dependency_overrides[get_provider] = EchoProvider
    r = await client.post(
        "/api/ai/template", json={"template": "minutes", "context": "참석: 김수진"}
    )
    assert r.status_code == 200, r.text
    assert r.json() == {
        "blocks": ["## 회의 개요", "- 일시:\n- 장소:", "| 안건 | 결정 |\n| --- | --- |\n|  |  |"]
    }
    assert "참석: 김수진" in EchoProvider.seen[0]["content"]


async def test_template_validation_and_provider_error(
    app: FastAPI, client: AsyncClient, member
) -> None:
    app.dependency_overrides[get_provider] = BrokenProvider
    r = await client.post("/api/ai/template", json={"template": "report"})
    assert (r.status_code, r.json()["code"]) == (422, "VALIDATION")
    r = await client.post("/api/ai/template", json={"template": "notice", "context": "x" * 2001})
    assert r.status_code == 422
    r = await client.post("/api/ai/template", json={"template": "notice"})
    assert r.status_code == 503
    assert r.json() == {"detail": "AI 서비스에 연결할 수 없습니다.", "code": "AI_UNREACHABLE"}


async def test_feedback_saves_one_row_per_answer(client: AsyncClient, users: Users, app_db) -> None:
    await login(client, "sujin@zenith.co.kr")
    for value in (1, -1):
        r = await client.post(
            "/api/ai/feedback", json={"message_id": "a-1", "value": value}, headers=csrf(client)
        )
        assert r.status_code == 204
    rows = (await app_db.execute(select(AiFeedback))).scalars().all()
    assert [(f.user_id, f.message_id, f.value) for f in rows] == [(users.member.id, "a-1", -1)]


async def test_feedback_validation(client: AsyncClient, users: Users, app_db) -> None:
    await login(client, "sujin@zenith.co.kr")
    for body, loc in (
        ({"message_id": "a-1", "value": 0}, "value"),
        ({"message_id": "", "value": 1}, "message_id"),
        ({"value": 1}, "message_id"),
    ):
        r = await client.post("/api/ai/feedback", json=body, headers=csrf(client))
        assert (r.status_code, r.json()["code"]) == (422, "VALIDATION")
        assert r.json()["detail"][0]["loc"] == ["body", loc]


async def test_ai_actions_require_login(client: AsyncClient) -> None:
    for path, body in (
        ("/api/ai/feedback", {"message_id": "a", "value": 1}),
        ("/api/ai/doc-action", {"doc_id": str(uuid.uuid4()), "action": "summarize"}),
        ("/api/ai/template", {"template": "minutes"}),
    ):
        assert (await client.post(path, json=body)).status_code == 401
