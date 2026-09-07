"""아직 구현하지 않은 계약 경로를 OpenAPI에 올려 두는 스텁.

04-API 명세의 모든 경로가 `openapi.json`에 나타나야 프론트 타입 생성이 계약 전체를 본다
(docs/README "계약의 강제"). 구현할 때는 여기 행을 지우고 라우터에 실제 함수를 쓴다.
"""

from fastapi import APIRouter

from app.errors import not_implemented

Stub = tuple[str, str, str]  # (method, path, 04-API 요약)


def register_stubs(router: APIRouter, specs: list[Stub]) -> None:
    for method, path, summary in specs:

        async def stub() -> None:
            not_implemented()

        router.add_api_route(
            path,
            stub,
            methods=[method],
            summary=summary,
            responses={501: {"description": "미구현 스텁 — {detail, code: NOT_IMPLEMENTED}"}},
        )
