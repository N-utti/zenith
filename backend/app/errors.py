"""04-API §0: 에러 본문은 `{"detail": str, "code": "AUTH_EXPIRED" | ...}` 한 가지 모양이다."""

import logging

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

CODE_BY_STATUS = {
    401: "AUTH_REQUIRED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    422: "VALIDATION",
    500: "INTERNAL",
    501: "NOT_IMPLEMENTED",
}

log = logging.getLogger("zenith.errors")


class ApiError(HTTPException):
    def __init__(
        self, status_code: int, code: str, detail: str, headers: dict[str, str] | None = None
    ) -> None:
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code


def not_implemented() -> None:
    raise ApiError(501, "NOT_IMPLEMENTED", "아직 구현되지 않은 엔드포인트입니다.")


def install_error_handlers(app: FastAPI) -> None:
    # 라우터의 404/405 는 Starlette 쪽 HTTPException 이다. 부모 클래스에 걸어야 둘 다 잡힌다.
    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = getattr(exc, "code", CODE_BY_STATUS.get(exc.status_code, "ERROR"))
        return JSONResponse(
            {"detail": exc.detail, "code": code},
            status_code=exc.status_code,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        # 04 §0: 422 = Pydantic 검증 실패. FastAPI 기본 오류 목록은 그대로 두고 code만 얹는다.
        return JSONResponse(
            {"detail": jsonable_encoder(exc.errors()), "code": "VALIDATION"}, status_code=422
        )

    @app.exception_handler(IntegrityError)
    async def _integrity(request: Request, exc: IntegrityError) -> JSONResponse:
        # 유일·외래키 제약 위반은 500 이 아니라 409 — 사전 검사와 commit 사이의 경합도 여기로 떨어진다.
        # 어느 제약인지는 응답에 싣지 않고 로그에만 남긴다 — 없으면 409 의 원인을 찾을 길이 없다.
        log.warning("제약 위반 %s %r: %s", request.method, request.url.path, exc.orig)
        return JSONResponse(
            {"detail": "데이터 제약을 위반했습니다.", "code": "CONFLICT"}, status_code=409
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        # 미처리 예외. Starlette 기본 500 은 text/plain 이라 프론트의 JSON.parse 가 터진다(04 §0 은 한 가지 모양).
        # 로그는 남기지 않는다 — Starlette 가 응답 뒤에 예외를 다시 던지고 uvicorn 이 트레이스백을 적는다.
        # 이 응답은 no_store 미들웨어 바깥에서 나가므로 헤더를 직접 붙인다.
        return JSONResponse(
            {"detail": "서버 오류가 발생했습니다.", "code": CODE_BY_STATUS[500]},
            status_code=500,
            headers={"Cache-Control": "no-store"},
        )
