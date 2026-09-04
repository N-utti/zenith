"""04-API §8 AI. `/ai/chat` 은 SSE — event:token → event:citations → event:done (실패 시 event:error)."""

import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.ai.provider import LLMError, LLMProvider, get_provider
from app.deps import current_user
from app.stubs import register_stubs

router = APIRouter(tags=["ai"], dependencies=[Depends(current_user)])

SYSTEM_PROMPT = (
    "당신은 제니스(Zenith) 사내 협업툴의 AI 어시스턴트다. 한국어로 간결하게 답한다. "
    "근거 문서가 주어지면 사실 문장 뒤에 [[n]] 각주를 단다."
)


class ChatIn(BaseModel):
    session_id: uuid.UUID | None = None
    message: str = Field(min_length=1)
    scope: str | None = None


class ModelOut(BaseModel):
    name: str
    size: int | None = None


def sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get(
    "/ai/models",
    response_model=list[ModelOut],
    summary="사용 가능한 모델 목록 (04 §8: Ollama 태그 → Claude 모델)",
)
async def models(provider: LLMProvider = Depends(get_provider)) -> list[dict[str, object]]:
    return provider.models()


@router.post(
    "/ai/chat",
    summary="{session_id?, message, scope?} → SSE 스트림 (token → citations → done)",
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def chat(body: ChatIn, provider: LLMProvider = Depends(get_provider)) -> StreamingResponse:
    # ponytail: RAG(bge-m3 임베딩 → pgvector top-k=6 + acl_role 필터, ARCHITECTURE §6)와
    # ai_sessions/ai_messages 저장은 미구현. 근거가 없으니 citations는 빈 배열이다.
    async def events() -> AsyncIterator[str]:
        try:
            async for token in provider.stream(
                system=SYSTEM_PROMPT, messages=[{"role": "user", "content": body.message}]
            ):
                yield sse("token", {"text": token})
            yield sse("citations", [])
            yield sse("done", {})
        except LLMError as e:
            yield sse("error", {"detail": e.detail, "code": e.code})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


register_stubs(
    router,
    [
        ("POST", "/ai/feedback", "{message_id, value: 1|-1}"),
        (
            "POST",
            "/ai/doc-action",
            "{doc_id, block_id?, action: summarize|continue|polish|translate|table} 인라인 AI",
        ),
        ("POST", "/ai/template", "{template: minutes|weekly|notice, context?} → {blocks[]}"),
    ],
)
