from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.deps import csrf_guard
from app.errors import install_error_handlers
from app.realtime import yjs
from app.routers import (
    admin,
    ai,
    approvals,
    attendance,
    auth,
    boards,
    channels,
    docs,
    me,
    search,
)


def create_app() -> FastAPI:
    app = FastAPI(
        title="Zenith API",
        version="0.1.0",
        description="04-API 명세서의 기계 판독본. 정본은 Notion, 강제는 이 스키마(openapi.json)로 한다.",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    install_error_handlers(app)
    if "*" in settings.cors_origins:
        raise ValueError("CORS_ORIGINS 에 '*' 는 안 된다 — 쿠키 자격증명이 아무 오리진에나 열린다.")
    if settings.cors_origins:
        # 웹·Caddy 경로는 같은 오리진이라 CORS가 필요 없다. 네이티브 셸(11 §8.2 · I6)만 여기로.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # 모든 계약 경로는 /api 아래에 있다 — vite 프록시(/api → :8000)·Caddy 라우팅과 짝.
    # 상태 변경 요청은 전부 CSRF 검사를 지난다(11 §4.3). 로그인만 예외.
    api = APIRouter(prefix="/api", dependencies=[Depends(csrf_guard)])

    @api.get("/healthz", tags=["admin"], summary="헬스체크 (04 §9)")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    for module in (auth, me, docs, channels, boards, search, ai, attendance, approvals, admin):
        api.include_router(module.router)
    app.include_router(api)
    yjs.register(app)  # WebSocket — OpenAPI 밖 (04 §4.2)
    return app


app = create_app()
