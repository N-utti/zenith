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
uv run pytest            # Postgres 가 있으면 zenith_test DB 를 만들어 실DB 테스트까지, 없으면 그것만 건너뛴다
uv run ruff check .
```

## 구조

```
app/
├─ main.py          create_app() — 모든 계약 경로는 /api 아래 (vite 프록시·Caddy 와 짝)
├─ config.py        Settings (.env) — DB·JWT 수명·쿠키·AI 모델
├─ db.py            async 엔진·세션·Base
├─ models.py        03-ERD §1 핵심 17 테이블 + teams · 인덱스 §2.4 · auth_sessions · audit_events
├─ security.py      세션에 묶인 JWT(HS256) · 쿠키 3종(access/refresh/csrf) · argon2 비밀번호
├─ deps.py          authenticate(쿠키→사용자+세션) · require_role(거부는 감사 기록) · csrf_guard
├─ audit.py         감사 기록 쓰기·집계 (로그인 실패 제한도 이걸로 센다)
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
| §1 인증 | `POST /auth/login·refresh·logout`, `GET /me` | ✅ HttpOnly 쿠키 JWT(access 15분 / refresh 14일) + `csrf` 쿠키. refresh 는 서버 세션(`auth_sessions`)에 묶여 매번 회전하고, 재사용·로그아웃·비활성화·비밀번호 변경이 세션을 즉시 회수한다. 세션은 로그인 후 14일에 절대 만료(쓸수록 늘지 않음). 실패 누적((이메일, IP) 쌍 10회 또는 IP 30회 / 15분) → 429. argon2 는 워커 스레드에서 돈다 |
| §1 (확장) | `POST /me/password` | ✅ 현재 비밀번호 확인 → 변경 → 다른 세션 전부 종료. **04 에 없던 경로** |
| §4.2 · 11 §7.5 | `GET /auth/yjs-check` | ✅ 프록시 forward_auth 용. 쿠키가 유효하면 204 + `X-User-Id`/`X-User-Role`. `?token=` 은 받지 않는다(I16) |
| 11 §4.3 CSRF | 모든 상태 변경 요청 | ✅ `csrf_guard`: 출처는 `Sec-Fetch-Site`(cross-site·same-site 거부)와 `Origin` 으로 대조, 토큰은 쿠키와 비교하지 않고 **세션 id 로 HMAC 을 다시 계산**해 대조. 로그인은 출처 대조만 |
| §9 관리 | `GET/POST /admin/users`, `PATCH /admin/users/{id}`, `GET /admin/audit` | ✅ exec 전용. 생성·등급·비활성화·임시 비밀번호, 감사 로그 커서 페이징(`?kind=` 앞글자 일치). 403 도 기록(TC-BRD-02) |
| §8 AI | `GET /ai/models`, `POST /ai/chat` | ✅ Claude 스트리밍 → SSE `token → citations → done`. **RAG·세션 저장 없음**(citations 빈 배열) |
| §9 | `GET /healthz` | ✅ |
| §2·3·5·6·7·8(나머지)·10, 13 §9 | 전부 | 🟡 **501 스텁** — 경로·요약만 OpenAPI 에 있다 |
| §4 실시간 | `/ws`, `/yjs/{doc_id}` | ⏳ 미착수. WebSocket 이라 OpenAPI 밖 — 핸드셰이크 인증은 `deps.authenticate(websocket.cookies, db)` 로 |

프론트(`frontend/`)도 같은 규약으로 옮겼다 — 토큰을 갖지 않고, `csrf` 쿠키만 읽어 헤더로 되돌리며, access 만료 시 refresh 후 1회 재시도한다. refresh 는 같은 오리진 탭들이 `navigator.locks` 로 줄을 서서 회전 토큰이 겹치지 않고, 어떤 요청이든 진짜 401 을 받으면 프로필을 비워 로그인 화면으로 간다(`frontend/README.md` "인증은 쿠키다").

access **쿠키**의 수명은 refresh 와 같다(14일). 15분은 토큰의 `exp` 가 판정한다 — 쿠키를 15분에 버리면 브라우저가 만료 신호(`AUTH_EXPIRED`) 대신 "쿠키 없음"만 보내 프론트가 재발급을 시도할 수 없다.

스텁을 구현할 때는 `register_stubs` 의 행을 지우고 라우터에 함수를 쓴 뒤 `openapi.json` 을 다시 뽑는다.

## 계약의 강제

산문 명세는 아무것도 강제하지 못한다(docs/README). 여기서는 두 가지로 강제한다.

1. **`openapi.json` 을 커밋한다.** 라우트를 바꾸면 `uv run python scripts/export_openapi.py`. `tests/test_contract.py::test_openapi_json_is_current` 가 어긋남을 잡는다.
2. **`CONTRACT_PATHS`** (tests/test_contract.py) — 04·13 의 경로 목록. 서버에서 사라지면 테스트가 깨진다. 폐기된 경로(`/attendance/approvals*`, `check-in`)가 되살아나도 깨진다.

다음 단계는 프론트가 `openapi.json` 에서 타입을 생성하는 것(frontend 몫).

## 설계와 어긋나는 것 — 알고 둔 상태

1. **AI 공급자: Ollama → Claude API.** ARCHITECTURE §2·§6 과 PRD NFR-01("외부 API 호출 0건")은 사내 Mac mini + Ollama 전제다. 2026-09-04 결정으로 1차 공급자를 Claude API(`claude-opus-5`, 서버측 refusal fallback)로 잡았다. `app/ai/provider.py` 의 `LLMProvider` 경계 뒤에 있어 Ollama 로 되돌리거나 병행하는 데 라우터 변경은 없다. **Notion 갱신 필요:** ARCHITECTURE §2·§6·§7, 01-PRD §5 성공 기준·NFR-01, 08 사업계획 보안 문단. 임베딩(bge-m3, `vector(1024)`)의 대체 공급자는 미정 — Voyage 계열이 같은 1024 차원이라 스키마는 그대로다.
2. **04 계약을 넓힌 것 — Notion 04 에 반영 필요.** `GET /me` 에 `team: {id, name} | null`(03 §2.6 조직)을 실었고, `POST /me/password` 와 `GET /auth/yjs-check`(쿠키, 헤더 반환) 를 추가했으며, `/admin/users/{user_id}` PATCH 본문·`/admin/audit` 의 커서 페이징 응답 `{items, next_cursor}`·에러 코드(`AUTH_EXPIRED`/`AUTH_INVALID`/`AUTH_DISABLED`/`AUTH_THROTTLED`/`CSRF_ORIGIN`/`CSRF_TOKEN`/`ADMIN_SELF`/`PASSWORD_MISMATCH`)와 429 를 정했다. 기계 판독본은 `openapi.json`.
3. **03 ERD 에 없던 테이블 두 개.** `auth_sessions`(refresh 회전·회수 — NFR-02 "JWT 회전", 11 §4.1 서버측 세션)와 `audit_events`(04 §9 감사 로그, 11 §7.4). 03 개정 필요. NFR-02 의 "bcrypt" 는 argon2id 로 바꿨다 — 현재 권장이며 pwdlib 기본값.
4. **근태·결재 테이블은 아직 없다.** 03 §3 은 신청 테이블에 `status`·`approver_id` 를 두고, 13 §7.2 는 그 컬럼을 결재 엔진으로 옮기라 한다. 10번 v0.4(13 A9)·로드맵(A2)이 정리되면 한 마이그레이션으로 넣는다. 경로 스텁은 13 §9 기준으로 이미 있다.
5. **11번 설계서 중 안 한 것.** OIDC/IdP·비상 로컬 로그인·`/auth/config` 는 도입 자체가 미결(11 I1·I2)이라 손대지 않았다. FR-AUTH-04 의 LDAP 확장점은 `routers/auth.py::_verify_credentials` 한 함수다. 네이티브 셸(Tauri/Capacitor)의 교차 오리진 쿠키(11 I6)는 `CORS_ORIGINS` 로 열 수 있게만 해 두었고 검증은 M4 몫.
6. **`/api/docs` 와 `/api/openapi.json` 은 인증 없이 열린다.** 계약은 어차피 이 레포에 공개돼 있고 사내망 전제라 두었다. 외부 노출 경로가 생기면 `docs_url`·`openapi_url` 을 끈다. `/metrics` 는 미구현.
7. **알고 둔 한계(리뷰 2026-09-04).** 로그인 실패 제한은 (이메일, IP) 쌍이라 같은 IP 의 반복만 그 계정을 잠근다 — 남이 내 주소를 두드려 나를 잠글 수는 없지만, IP 를 바꿔 가며 한 계정을 두드리는 건 IP 당 30회 한도가 늦출 뿐이다. `audit_events` 는 403 도 기록하므로 member 가 관리 경로를 두드리면 표가 자란다 — 보존 기간·정리 배치는 운영 정책과 함께 정한다. 두 탭이 동시에 refresh 하는 경우는 프론트의 `navigator.locks` 가 막고, 서버측 유예 창(옛 jti 를 잠깐 허용)은 두지 않았다.
