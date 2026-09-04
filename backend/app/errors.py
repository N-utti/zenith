"""04-API §0: 에러 본문은 `{"detail": str, "code": "AUTH_EXPIRED" | ...}` 한 가지 모양이다."""

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

CODE_BY_STATUS = {
    401: "AUTH_REQUIRED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    422: "VALIDATION",
    501: "NOT_IMPLEMENTED",
}


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: str, detail: str) -> None:
        super().__init__(status_code=status_code, detail=detail)
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
