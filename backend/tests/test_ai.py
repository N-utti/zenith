"""04-API §8 — /ai/chat SSE 프레이밍. 실제 Claude 호출 없이 공급자를 바꿔 끼운다."""

from collections.abc import AsyncIterator

from fastapi import FastAPI
from httpx import AsyncClient

from app.ai.provider import LLMError, get_provider


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
