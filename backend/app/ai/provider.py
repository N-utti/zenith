"""LLM 공급자 경계.

ARCHITECTURE §6은 Ollama(사내 Mac mini)였으나 2026-09-04 결정으로 Claude API가 1차 공급자다.
라우터는 `LLMProvider`만 알고, Anthropic SDK는 이 파일 밖으로 새지 않는다 — Ollama로 되돌리거나
병행하려면 같은 프로토콜을 구현한 클래스를 하나 더 두고 `get_provider`에서 고르면 된다.
"""

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Protocol

import anthropic

from app.config import settings

log = logging.getLogger("zenith.ai")

ChatMessage = dict[
    str, Any
]  # {"role": "user" | "assistant", "content": str | [블록]} — 블록은 Anthropic 모양 그대로
Tool = dict[str, Any]  # {name, description, input_schema} — Anthropic 도구 정의 모양 그대로


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class ToolCalls:
    """턴 끝 — 모델이 도구를 불렀을 때 텍스트 뒤에 한 번 온다. `content` 는 그 턴의 원본 블록(thinking 포함)이라
    라우터가 그대로 assistant 메시지로 되돌려 주고, `calls` 를 실행해 tool_result 로 잇는다."""

    calls: list[ToolCall]
    content: list[Any]
    # 서버측 web_search(README 49)가 이 턴에서 실제로 돌려준 결과 URL — 라우터는 이 안의 URL 만 웹 카드로 받는다
    web_urls: list[str] = field(default_factory=list)
    # stop_reason == pause_turn — 서버측 도구가 턴을 끊었다. 라우터는 content 를 assistant 턴으로 붙이고 한 번 더 부른다
    paused: bool = False


class LLMError(Exception):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


class LLMProvider(Protocol):
    def models(self) -> list[dict[str, object]]: ...

    def stream(
        self,
        *,
        system: str
        | list[dict[str, Any]],  # 블록 목록이면 그대로 전달(규정 블록의 cache_control, README 46)
        messages: list[ChatMessage],
        max_tokens: int | None = None,
        tools: list[Tool] | None = None,
        tool_choice: dict[str, Any] | None = None,
    ) -> AsyncIterator[str | ToolCalls]: ...


class ClaudeProvider:
    def __init__(self, model: str, max_tokens: int, api_key: str | None) -> None:
        self.model = model
        self.max_tokens = max_tokens
        self._api_key = api_key
        self._client: anthropic.AsyncAnthropic | None = None

    def models(self) -> list[dict[str, object]]:
        # 04 §8 `GET /ai/models` 는 Ollama 태그 [{name, size}] 였다. 모양만 유지한다.
        return [{"name": self.model, "size": None}]

    def _client_or_create(self) -> anthropic.AsyncAnthropic:
        if self._client is None:
            # api_key=None 이면 SDK가 ANTHROPIC_API_KEY / `ant auth` 프로필을 찾는다.
            self._client = anthropic.AsyncAnthropic(api_key=self._api_key)
        return self._client

    async def stream(
        self,
        *,
        system: str | list[dict[str, Any]],
        messages: list[ChatMessage],
        max_tokens: int | None = None,
        tools: list[Tool] | None = None,
        tool_choice: dict[str, Any] | None = None,
    ) -> AsyncIterator[str | ToolCalls]:
        try:
            async with self._client_or_create().beta.messages.stream(
                model=self.model,
                max_tokens=max_tokens or self.max_tokens,
                system=system,  # type: ignore[arg-type]
                messages=messages,  # type: ignore[arg-type]
                tools=tools or anthropic.NOT_GIVEN,  # type: ignore[arg-type]
                tool_choice=tool_choice or anthropic.NOT_GIVEN,  # type: ignore[arg-type]
                # 안전 분류기가 거부하면 서버가 대체 모델로 같은 요청을 재실행한다 (Opus 5 권장 설정).
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            ) as stream:
                async for text in stream.text_stream:
                    yield text
                final = await stream.get_final_message()
        except anthropic.RateLimitError as e:
            raise LLMError(
                "AI_RATE_LIMITED", "AI 요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요."
            ) from e
        except anthropic.APIStatusError as e:
            raise LLMError("AI_UPSTREAM", f"AI 서비스 오류 ({e.status_code})") from e
        except anthropic.APIConnectionError as e:
            raise LLMError("AI_UNREACHABLE", "AI 서비스에 연결할 수 없습니다.") from e
        except anthropic.AnthropicError as e:
            # SDK 문구에 설정 내용이 섞일 수 있어 응답에는 고정 문구만, 원문은 로그에만.
            log.exception("AI 설정 오류")
            raise LLMError("AI_CONFIG", "AI 설정 오류입니다.") from e
        if final.stop_reason == "refusal":
            raise LLMError("AI_REFUSED", "AI가 이 요청에는 답하지 않습니다.")
        calls = [
            ToolCall(id=b.id, name=b.name, input=dict(b.input))  # type: ignore[arg-type]
            for b in final.content
            if b.type == "tool_use"
        ]
        web_urls = [
            r.url
            for b in final.content
            if getattr(b, "type", "") == "web_search_tool_result"
            and isinstance(getattr(b, "content", None), list)
            for r in b.content
            if getattr(r, "type", "") == "web_search_result" and getattr(r, "url", None)
        ]
        paused = final.stop_reason == "pause_turn"
        if calls or paused or web_urls:
            yield ToolCalls(
                calls=calls, content=list(final.content), web_urls=web_urls, paused=paused
            )


@lru_cache
def get_provider() -> LLMProvider:
    return ClaudeProvider(settings.ai_model, settings.ai_max_tokens, settings.anthropic_api_key)
