# backend — 작업 규칙

> 공통 규칙은 루트 [CLAUDE.md](../CLAUDE.md). 구조·실행·구현 상태는 [README.md](README.md) — 여기서는 반복하지 않는다.
> 정본: [04 · API](../docs/README.md)(경로·에러 규약) · 03 ERD(스키마) · 11 인증 설계서 · 13 전자결재.

## 게이트 (커밋 전 green)

```sh
uv run ruff check .
uv run pytest            # Postgres 가 있으면 zenith_test 로 DB 테스트까지, 없으면 그것만 skip
```

- 라우트·스키마·에러 코드를 바꿨으면 `uv run python scripts/export_openapi.py` 로 **`openapi.json` 재추출** 후 커밋. `tests/test_contract.py` 가 어긋남을 잡는다.
- CI 는 pgvector Postgres 를 띄워 DB 테스트를 **skip 없이** 돌린다. 로컬에서 skip 된 테스트는 CI 에서 처음 실행된다고 생각할 것.
- 전체 `pytest` 는 `.env` 유무와 무관하게 돌아야 한다(`conftest.py` 가 `JWT_SECRET` 기본값을 채운다).

## 기능 착수 절차 (하나씩, 깊게)

1. **정본 절 전부 읽기** — 04 해당 §, 03 해당 테이블, 05 SCR, 02 FR-ID, 07 TC-ID. 13 §9(결재)·10 §9(근태)가 04 를 덮어쓰는 구간이 있다.
2. `register_stubs(...)` 에서 해당 행을 지우고 라우터에 함수를 쓴다. 스텁 행이 남아 있으면 계약 테스트는 통과하지만 501 이다.
3. 스키마가 필요하면 03 을 그대로 Alembic 마이그레이션으로. 03 과 어긋나야 한다면 README "설계와 어긋나는 것"에 번호를 붙여 적는다.
4. DB 붙인 테스트(`app_db`·`users` fixture) + 권한 거부 경로(403·감사 기록) 테스트.
5. `openapi.json` 재추출 → 리뷰(루트 §기본 동작의 등급) → 커밋. 프론트에 계약을 공유한다.

## 규약

- 모든 경로는 `/api` 아래(`main.py`). 에러 본문은 `{detail, code}` — `errors.py` 의 코드만 쓰고 새 코드는 README 목록에 추가.
- 인증은 `deps.authenticate` / `require_role`, 상태 변경 요청은 `csrf_guard`. **거부는 감사 기록**(`audit.py`) — 403 도 남긴다.
- 권한은 **역할이 아니라 관계로** 판정하는 곳이 있다(결재 문서: 기안자·결재선·참조자·임원). 역할 등급 비교로 대체하지 않는다.
- WebSocket(`/ws`, `/yjs/{doc_id}`) 핸드셰이크 인증은 `deps.authenticate(websocket.cookies, db)`. `?token=` 은 받지 않는다(11 I16).
- 외부 호출은 `app/ai/provider.py` 의 `LLMProvider` 뒤에만. 사용자 문서를 프롬프트에 넣을 때는 권한 필터를 통과한 것만.
- 비밀번호는 argon2(`security.py`), 토큰은 세션에 묶인 JWT. 여기 규약을 바꾸는 PR 은 보안민감(루트 §기본 동작).

## 스타일·환경

- Python 3.13 · ruff line-length 100(`E501` 무시 — 한글 폭 문제) · 한국어 주석·docstring · 타입 힌트.
- `alembic.ini` 에 **한글 주석 금지** — Windows 에서 configparser 가 cp949 로 읽어 깨진다. 한글은 `env.py`·마이그레이션 파일에.
- 포트가 겹치는 PC 는 `ZENITH_DB_PORT`·`uvicorn --port` 로 비킨다. 개인 환경 값은 `.env`(미커밋)에만.
- Redis 는 compose 에 있지만 코드가 아직 안 쓴다. 쓰기 시작할 때 `config.py` 의 자리표시자를 그대로 쓴다. MinIO 는 `app/storage.py` 뒤에서만(첨부) — 첨부 테스트는 MinIO 가 없으면 skip 된다(compose 의 `minio` 를 띄울 것).
