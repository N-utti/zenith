import asyncio
import contextlib

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from app import metrics
from app.config import settings
from app.deps import csrf_guard
from app.errors import install_error_handlers
from app.realtime import chat, yjs
from app.routers import (
    admin,
    ai,
    approvals,
    attendance,
    auth,
    boards,
    channels,
    docs,
    files,
    me,
    people,
    search,
)

MAX_BODY_BYTES = (
    12 * 1024 * 1024
)  # 첨부 상한(routers/channels.py MAX_ATTACHMENT_BYTES) + multipart 여유


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # 휴지통 30일 비우기(04 §3). 테스트의 ASGITransport 는 lifespan 을 돌리지 않는다 — purge_trash 를 직접 부른다.
    task = asyncio.create_task(docs.purge_loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task  # 돌던 배치의 세션 정리까지 기다린다


def create_app() -> FastAPI:
    app = FastAPI(
        title="Zenith API",
        version="0.1.0",
        description="04-API 명세서의 기계 판독본. 정본은 Notion, 강제는 이 스키마(openapi.json)로 한다.",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
        lifespan=lifespan,
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

    @app.middleware("http")
    async def body_limit(request, call_next):
        # FastAPI 는 인증·CSRF 의존성보다 먼저 multipart 본문을 다 받아 둔다(임시 파일) — 로그인 없이도 디스크를
        # 채울 수 있으므로 라우팅 전에 길이부터 본다. 첨부 10MB(FR-CHT-04) + multipart 봉투 여유.
        # ponytail: Content-Length 만 본다. chunked 전송은 caddy 가 먼저 자른다(infra/caddy/Caddyfile request_body 12MB).
        length = request.headers.get("content-length", "")
        if length.isdigit() and int(length) > MAX_BODY_BYTES:
            return JSONResponse(
                {"detail": "요청 본문이 너무 큽니다(첨부는 10MB 이하).", "code": "VALIDATION"},
                status_code=422,
                headers={"Cache-Control": "no-store"},
            )
        return await call_next(request)

    @app.middleware("http")
    async def no_store(request, call_next):
        # 쿠키로 인증하는 개인화 응답이라 공유 캐시가 휴리스틱으로 담지 않게. 직접 만든 Response 에도 붙는다.
        path = request.url.path
        counted = path.startswith("/api/") and path != "/api/metrics"  # 스크레이프 자신은 안 센다
        try:
            response = await call_next(request)
        except Exception:
            # 미처리 예외는 바깥 ServerErrorMiddleware 가 500 으로 만든다 — 여기서 세지 않으면 5xx 가 영원히 0 이다.
            if counted:
                metrics.observe(request.method, 500)
            raise
        if path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        if counted:
            metrics.observe(request.method, response.status_code)
        return response

    # 모든 계약 경로는 /api 아래에 있다 — vite 프록시(/api → :8000)·Caddy 라우팅과 짝.
    # 상태 변경 요청은 전부 CSRF 검사를 지난다(11 §4.3). 로그인만 예외.
    api = APIRouter(prefix="/api", dependencies=[Depends(csrf_guard)])

    @api.get("/healthz", tags=["admin"], summary="헬스체크 (04 §9)")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @api.get(
        "/metrics",
        tags=["admin"],
        summary="프로메테우스 텍스트 (04 §9) — 인증 없음, caddy 가 바깥에서 막는다(compose 안 스크레이퍼용)",
        response_class=PlainTextResponse,
    )
    async def metrics_text() -> str:
        return metrics.render()

    for module in (
        auth,
        me,
        docs,
        files,
        people,
        channels,
        boards,
        search,
        ai,
        attendance,
        approvals,
        admin,
    ):
        api.include_router(module.router)
    app.include_router(api)
    yjs.register(app)  # WebSocket — OpenAPI 밖 (04 §4.2)
    chat.register(app)  # WebSocket — OpenAPI 밖 (04 §4.1)
    return app


app = create_app()
