# backend — 제니스 API 서버

FastAPI · SQLAlchemy 2(async) · Alembic · PostgreSQL 16 + pgvector · Anthropic SDK.
계약은 [04 · API 명세서](https://app.notion.com/p/3aaa4716604681a6bba4e0367463e8eb), 스키마는 [03 · ERD·DB 설계서](https://app.notion.com/p/3aaa471660468142a4a1cbf2e44466b3) — **이 코드가 그 기계 판독본이다.** 정본은 Notion([docs/README.md](../docs/README.md)).

## 빠른 시작

```sh
cp .env.example .env                                   # 로컬은 COOKIE_SECURE=false 로 둔다
python -c "import secrets; print(secrets.token_urlsafe(48))"   # → .env 의 JWT_SECRET (필수 · 기본값 없음)
docker compose -f ../infra/docker-compose.yml up -d db  # 포트가 겹치면 ZENITH_DB_PORT=5435 + DATABASE_URL 수정
uv sync
uv run alembic upgrade head
uv run python scripts/seed.py                          # 워크스페이스·게시판 3·채널 2·개발팀·데모 계정 3
uv run uvicorn app.main:app --reload --port 8000       # → http://localhost:8000/api/docs
```

데모 계정은 프론트 목과 같다 — `sujin@zenith.co.kr`(사원) · `donghyun@`(팀장) · `jaeho@`(임원), 비밀번호 `zenith1234`.

```sh
uv run pytest            # DB 없이 돈다
uv run ruff check .
```

## 구조

```
app/
├─ main.py          create_app() — 모든 계약 경로는 /api 아래 (vite 프록시·Caddy 와 짝)
├─ config.py        Settings (.env) — DB·JWT 수명·쿠키·AI 모델
├─ db.py            async 엔진·세션·Base
├─ models.py        03-ERD §1 핵심 17 테이블 + teams · 인덱스 §2.4
├─ security.py      JWT(HS256) 발급·검증 · 쿠키 · argon2 비밀번호
├─ deps.py          current_user(쿠키) · require_role(member<lead<exec)
├─ errors.py        04 §0 에러 본문 {detail, code}
├─ stubs.py         미구현 경로를 501로 OpenAPI 에 올리는 헬퍼
├─ ai/provider.py   LLMProvider 프로토콜 · ClaudeProvider
└─ routers/         auth · me · docs · channels · boards · search · ai · attendance · approvals · admin
alembic/            비동기 env.py · versions/
scripts/            export_openapi.py · seed.py
tests/              계약 경로 검사 · 인증 왕복 · SSE 프레이밍 (DB 불필요)
openapi.json        생성물 — 커밋한다 (아래 "계약의 강제")
```

## 구현 상태

| 04 절 | 경로 | 상태 |
| --- | --- | --- |
| §1 인증 | `POST /auth/login·refresh·logout`, `GET /me` | ✅ HttpOnly 쿠키 JWT, access 15분 / refresh 14일 |
| §8 AI | `GET /ai/models`, `POST /ai/chat` | ✅ Claude 스트리밍 → SSE `token → citations → done`. **RAG·세션 저장 없음**(citations 빈 배열) |
| §9 | `GET /healthz` | ✅ |
| §2·3·5·6·7·8(나머지)·9·10, 13 §9 | 전부 | 🟡 **501 스텁** — 경로·요약만 OpenAPI 에 있다 |
| §4 실시간 | `/ws`, `/yjs/{doc_id}` | ⏳ 미착수. WebSocket 이라 OpenAPI 밖 — 인증은 쿠키로(11 §7.5 · I16) |

스텁을 구현할 때는 `register_stubs` 의 행을 지우고 라우터에 함수를 쓴 뒤 `openapi.json` 을 다시 뽑는다.

## 계약의 강제

산문 명세는 아무것도 강제하지 못한다(docs/README). 여기서는 두 가지로 강제한다.

1. **`openapi.json` 을 커밋한다.** 라우트를 바꾸면 `uv run python scripts/export_openapi.py`. `tests/test_contract.py::test_openapi_json_is_current` 가 어긋남을 잡는다.
2. **`CONTRACT_PATHS`** (tests/test_contract.py) — 04·13 의 경로 목록. 서버에서 사라지면 테스트가 깨진다. 폐기된 경로(`/attendance/approvals*`, `check-in`)가 되살아나도 깨진다.

다음 단계는 프론트가 `openapi.json` 에서 타입을 생성하는 것(frontend 몫).

## 설계와 어긋나는 것 — 알고 둔 상태

1. **AI 공급자: Ollama → Claude API.** ARCHITECTURE §2·§6 과 PRD NFR-01("외부 API 호출 0건")은 사내 Mac mini + Ollama 전제다. 2026-09-04 결정으로 1차 공급자를 Claude API(`claude-opus-5`, 서버측 refusal fallback)로 잡았다. `app/ai/provider.py` 의 `LLMProvider` 경계 뒤에 있어 Ollama 로 되돌리거나 병행하는 데 라우터 변경은 없다. **Notion 갱신 필요:** ARCHITECTURE §2·§6·§7, 01-PRD §5 성공 기준·NFR-01, 08 사업계획 보안 문단. 임베딩(bge-m3, `vector(1024)`)의 대체 공급자는 미정 — Voyage 계열이 같은 1024 차원이라 스키마는 그대로다.
2. **프론트 프로토타입은 이 서버에 로그인하지 못한다.** 프론트는 `localStorage` + `Bearer` + `GET /auth/me`(11 §13 **I5**), 서버는 04 §1 대로 쿠키 + `GET /me`. 어긋난 쪽은 프론트이고 정정 계획은 11 §10.1. `/me` 응답도 04 그대로 `{id, name, email, role, avatar}` — 프론트 `User` 타입의 `title`·`team`·`avatarHue` 는 계약에 없다.
3. **근태·결재 테이블은 아직 없다.** 03 §3 은 신청 테이블에 `status`·`approver_id` 를 두고, 13 §7.2 는 그 컬럼을 결재 엔진으로 옮기라 한다. 10번 v0.4(13 A9)·로드맵(A2)이 정리되면 한 마이그레이션으로 넣는다. 경로 스텁은 13 §9 기준으로 이미 있다.
4. **CSRF 이중 제출(11 §4.3)·감사 로그(04 §9)·`/metrics`** 는 미구현. 쿠키는 `SameSite=Lax` 로만 막고 있다.
