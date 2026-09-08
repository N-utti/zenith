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
├─ realtime/yjs.py  /api/yjs/{doc_id} — y-websocket 릴레이 + Y.Doc 영속화 (§4.2)
├─ realtime/chat.py /api/ws — 채팅·알림·presence 단일 소켓, @멘션 → notifications + 푸시 (§4.1)
├─ ai/provider.py   LLMProvider 프로토콜 · ClaudeProvider
└─ routers/         auth · me · docs · channels · boards · search · ai · attendance · approvals · admin
alembic/            비동기 env.py · versions/
scripts/            export_openapi.py · seed.py
tests/              계약 경로 검사 · 인증 왕복 · SSE 프레이밍 (DB 불필요) · 문서·홈·관리자·공동편집·채팅 소켓 (실 Postgres · httpx-ws)
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
| §3 문서 | `GET /tree`, `POST /folders`, `PATCH /folders/{id}`, `POST /docs`, `GET/PATCH/DELETE /docs/{id}`, `GET/POST /docs/{id}/versions`, `POST /docs/{id}/restore`, `GET/POST /docs/{id}/comments` | ✅ 트리·메타·버전 표식·댓글. 본문은 Y.Doc 이라 여기 없다(`GET /docs/{id}` 의 `ydoc` 은 /yjs 릴레이가 영속화하기 전까지 null). 휴지통은 `deleted_at`(트리에서만 빠짐, 열기는 됨) + `POST /docs/{id}/untrash`, `?hard=1` 은 exec 만(버전·댓글·색인까지 삭제, 감사 `docs.hard_deleted`, 거부는 `acl.denied`). 버전은 같은 사람의 무명 스냅샷을 3분 안에 하나로 접고 라벨이 붙으면 안 접는다. 댓글의 `@이름` 은 활성 사용자 이름과 맞춰 `notifications(kind=mention)` 행을 만들고 §4.1 소켓으로 `notice` 를 민다. 문서에 열람 등급은 없다 — 로그인하면 모두 읽고 쓴다 |
| §2 홈·개인 | `GET /me/home`, `GET/POST /me/todos`, `PATCH/DELETE /me/todos/{id}`, `GET /me/notifications`, `POST /me/notifications/read` | ✅ 홈은 1콜 집계: 이어서 작업 8(내가 마지막으로 손댄 문서, 없으면 전사 최근 — 폴더 경로 포함, 휴지통 제외) · 멘션&댓글 피드(notifications 의 mention/comment/reply 10) · 안 읽은 채널(last_read_at 이후, 내 글 제외, DM 은 상대 이름) · 공지 3(권한 밖은 `＿＿＿＿＿ 보고` + `masked` + 작성자 숨김, TC-BRD-01) · 할 일. 할 일·알림은 본인 것만(남의 id 는 404/무시, TC-AUTH-04). 근태 없음(10 §10) |
| §5·6·7·8(나머지)·10, 13 §9 | 전부 | 🟡 **501 스텁** — 경로·요약만 OpenAPI 에 있다 |
| §4.2 공동편집 | `WS /api/yjs/{doc_id}` | ✅ y-websocket 프로토콜 릴레이(pycrdt). 쿠키 핸드셰이크 인증(`?token=` 없음, TC-SEC-03), 문서마다 Y.Doc(gc 끔) 하나를 들고 업데이트·awareness 중계. **영속화**: `documents.ydoc_snapshot` 을 원본으로, 제목(`meta.title`)·`text_cache`·`tsv` 를 파생으로 — 활동 중 30초마다, 마지막 사람이 나갈 때, 한 명이 나갈 때 더러워져 있으면. 방은 프로세스 메모리(worker 1개 전제). OpenAPI 밖 |
| §4.1 채팅·알림·presence | `WS /api/ws` | ✅ JSON 텍스트 프레임. 클라이언트 → `{op: sub\|msg\|read\|typing}`, 서버 → `{ev: msg\|unread\|notice\|presence\|typing\|error}`. 쿠키 핸드셰이크 + Origin 대조(yjs 와 같음), **조용한 소켓도 60초마다 세션 재검증**(회수·비활성만 — 소켓의 쿠키는 접속 시점에 고정이라 access `exp` 는 안 본다, `authenticate(verify_exp=False)`, /yjs 도 같음). 구독 범위는 `sub` 가 아니라 `channel_members` 가 정한다 — 멤버 아닌 채널은 `error FORBIDDEN` + 감사 `acl.denied`. `msg` 는 저장 → 보낸 사람 읽음 처리 → 멤버 전원에 `msg` + 각자의 `unread`(홈과 같은 쿼리, FR-CHT-03) → `@이름` 멘션은 `notifications(kind=mention)` + `notice` 푸시(채널 멤버에게만). 문서 댓글 멘션(§3)도 같은 경로로 푸시된다. 소켓 목록은 프로세스 메모리(worker 1개). OpenAPI 밖 — 아래 "설계와 어긋나는 것" 11 |

프론트(`frontend/`)도 같은 규약으로 옮겼다 — 토큰을 갖지 않고, `csrf` 쿠키만 읽어 헤더로 되돌리며, access 만료 시 refresh 후 1회 재시도한다. refresh 는 같은 오리진 탭들이 `navigator.locks` 로 줄을 서서 회전 토큰이 겹치지 않고, 어떤 요청이든 진짜 401 을 받으면 프로필을 비워 로그인 화면으로 간다(`frontend/README.md` "인증은 쿠키다").

access **쿠키**의 수명은 refresh 와 같다(14일). 15분은 토큰의 `exp` 가 판정한다 — 쿠키를 15분에 버리면 브라우저가 만료 신호(`AUTH_EXPIRED`) 대신 "쿠키 없음"만 보내 프론트가 재발급을 시도할 수 없다.

스텁을 구현할 때는 `register_stubs` 의 행을 지우고 라우터에 함수를 쓴 뒤 `openapi.json` 을 다시 뽑는다.

## 계약의 강제

산문 명세는 아무것도 강제하지 못한다(docs/README). 여기서는 두 가지로 강제한다.

1. **`openapi.json` 을 커밋한다.** 라우트를 바꾸면 `uv run python scripts/export_openapi.py`. `tests/test_contract.py::test_openapi_json_is_current` 가 어긋남을 잡는다.
2. **`CONTRACT_PATHS`** (tests/test_contract.py) — 04·13 의 경로 목록. 서버에서 사라지면 테스트가 깨진다. 폐기된 경로(`/attendance/approvals*`, `check-in`)가 되살아나도 깨진다.

다음 단계는 프론트가 `openapi.json` 에서 타입을 생성하는 것(frontend 몫).

## 설계와 어긋나는 것 — 알고 둔 상태

1. **AI 공급자: Ollama → Claude API.** ARCHITECTURE §2·§6 과 PRD NFR-01("외부 API 호출 0건")은 사내 Mac mini + Ollama 전제다. 2026-09-04 결정으로 1차 공급자를 Claude API(`claude-opus-5`, 서버측 refusal fallback)로 잡았다. `app/ai/provider.py` 의 `LLMProvider` 경계 뒤에 있어 Ollama 로 되돌리거나 병행하는 데 라우터 변경은 없다. **Notion 반영 완료(2026-09-07):** ARCHITECTURE 서두 콜아웃·§1·§2·§6·§7, 01-PRD §5·§6·O10(경영진 확인 대기), 02 NFR-01, 08 서두 콜아웃. 임베딩(bge-m3, `vector(1024)`)의 대체 공급자는 미정 — Voyage 계열이 같은 1024 차원이라 스키마는 그대로다.
2. **04 계약을 넓힌 것 — Notion 04 v1.1 에 반영 완료(2026-09-07).** `GET /me` 에 `team: {id, name} | null`(03 §2.6 조직)을 실었고, `POST /me/password` 와 `GET /auth/yjs-check`(쿠키, 헤더 반환) 를 추가했으며, `/admin/users/{user_id}` PATCH 본문·`/admin/audit` 의 커서 페이징 응답 `{items, next_cursor}`·에러 코드(`AUTH_EXPIRED`/`AUTH_INVALID`/`AUTH_DISABLED`/`AUTH_THROTTLED`/`CSRF_ORIGIN`/`CSRF_TOKEN`/`ADMIN_SELF`/`PASSWORD_MISMATCH`)와 429 를 정했다. 기계 판독본은 `openapi.json`.
3. **03 ERD 에 없던 테이블 두 개.** `auth_sessions`(refresh 회전·회수 — NFR-02 "JWT 회전", 11 §4.1 서버측 세션)와 `audit_events`(04 §9 감사 로그, 11 §7.4). 03 v1.1 §2.7 에 반영 완료(2026-09-07). NFR-02 의 "bcrypt" 는 argon2id 로 바꿨다 — 현재 권장이며 pwdlib 기본값.
4. **근태·결재 테이블은 아직 없다.** 03 §3 은 신청 테이블에 `status`·`approver_id` 를 두고, 13 §7.2 는 그 컬럼을 결재 엔진으로 옮기라 한다. 10번 v0.4(13 A9)·로드맵(A2)이 정리되면 한 마이그레이션으로 넣는다. 경로 스텁은 13 §9 기준으로 이미 있다.
5. **11번 설계서 중 안 한 것.** OIDC/IdP·비상 로컬 로그인·`/auth/config` 는 도입 자체가 미결(11 I1·I2)이라 손대지 않았다. FR-AUTH-04 의 LDAP 확장점은 `routers/auth.py::_verify_credentials` 한 함수다. 네이티브 셸(Tauri/Capacitor)의 교차 오리진 쿠키(11 I6)는 `CORS_ORIGINS` 로 열 수 있게만 해 두었고 검증은 M4 몫.
6. **`/api/docs` 와 `/api/openapi.json` 은 인증 없이 열린다.** 계약은 어차피 이 레포에 공개돼 있고 사내망 전제라 두었다. 외부 노출 경로가 생기면 `docs_url`·`openapi_url` 을 끈다. `/metrics` 는 미구현.
8. **§3 문서 API 가 04 를 넓히거나 달리 읽은 것(2026-09-07) — Notion 04 v1.1 §3·03 v1.1 §2.7 반영 완료.** (a) `POST /docs/{id}/versions {snapshot(base64), label?}` 추가 — 스냅샷은 클라이언트(Yjs)가 만들어 올린다. (b) `GET /docs/{id}/versions` 목록에는 스냅샷이 없고(버전이 쌓인 문서에서 목록 한 번이 수십 MB 가 된다), `POST /docs/{id}/restore {version_id}` 가 **복원할 스냅샷을 돌려주기만** 한다. 서버가 Y.Doc 을 과거로 갈아끼우면 접속 중인 다른 사람과 병합돼 도로 취소되므로, 적용은 클라이언트가 앞으로 가는 편집 한 번으로 한다(frontend/README "되돌리기는 되감기가 아니다"). (c) `POST /docs/{id}/untrash` 추가(TC-DOC-05). 휴지통 목록 조회와 30일 뒤 자동 삭제 배치는 아직 없다. (d) `POST /docs` 의 `blocks?` 는 받지 않는다 — AI 템플릿 저장은 보류. (e) `doc_versions` 에 `author_id`·`label` 컬럼 추가(03 개정 필요). (f) 문서에 열람 등급이 없다 — 03 §2.2 는 등급을 게시판·RAG 에만 둔다. 폴더 단위 등급이 필요해지면 `folders.min_role` 로. (g) 제목·라벨 200자, 댓글 1만 자, 스냅샷 base64 8MB, block_id 100자 상한. (h) 멘션은 `@이름` 정확 일치·동명이인 전부(글쓴이 자신만 id 로 제외) — 프론트 자동완성이 id 를 실어 보내면 `@[id]` 로 바꾼다.
9. **§4.2 공동편집을 API 프로세스 안에 넣었다(2026-09-07) — ARCHITECTURE §1·§2·§5·§7, 04 v1.2 §4.2 반영 완료(2026-09-08).** ARCHITECTURE 는 별도 y-websocket(Node) 컨테이너 + Caddy forward_auth(`/auth/yjs-check`) 구성이었다. pycrdt(yrs 바인딩)로 FastAPI 안에 릴레이를 두면 컨테이너 하나·언어 하나·DB 접근 경로 하나가 줄고, §2 가 이미 "ypy-websocket 으로 파이썬 통일 가능" 이라 적어 두었다. `yjs-check` 는 남겨 둔다(프록시가 다른 이유로 쓸 수 있다). 대가: 방(room)이 프로세스 메모리라 **uvicorn worker 는 1개**. 다중 프로세스는 문서별 sticky 라우팅이나 Redis 중계가 선행돼야 한다. 저장 시점은 활동 중 30초 간격 + 퇴장 시라, 마지막 활동 30초 안에 프로세스가 죽으면 그만큼 잃는다(클라이언트 IndexedDB 가 재접속 때 다시 밀어 넣는다). 프론트는 `/collab` 프록시 대상을 `/api/yjs` 로 바꾸면 된다(y-websocket 클라이언트 3.1 로 실측 상호운용 확인). 리뷰(2026-09-07)로 넣은 것: 핸드셰이크 Origin 대조(Cross-Site WebSocket Hijacking — `deps.origin_allowed`), 60초마다 쿠키 재검증(세션 회수가 열린 소켓에도 먹게), 프레임 1MB 상한, 휴지통 문서 거부, 영구 삭제 시 방 닫기, 브로드캐스트 5초 타임아웃(느린 연결 격리), 제목은 Y.Doc `meta.title` 이 바뀌었을 때만 투영(트리 PATCH 를 되돌리지 않음), `updated_by` 는 마지막 편집자. DB 세션은 소켓 수명 동안 붙잡지 않는다(핸드셰이크·저장·재검증 때만).
10. **§2 홈 응답 모양(2026-09-07) — 04 v1.1 §2 반영 완료.** `recent_docs[]` 는 `{id, title, path[], updated_at, updated_by}`, `mentions[]` 는 notifications 행 그대로(`{id, kind, payload, read_at, created_at}` — payload 는 만든 쪽이 정한다: 문서 댓글 멘션은 `{doc_id, doc_title, comment_id, block_id, from, preview}`), `unread[]` 는 `{channel_id, name, is_dm, count}`(0 인 채널 제외), `posts[]` 는 `{id, board_id, board_name, min_role, title, masked, author, created_at}`, `todos[]` 는 `{id, text, done, created_at}`. `todos.created_at` 컬럼 추가(03 개정, alembic 5d2e7f1a9c04). 홈의 안 읽은 항목 수(05 인사 헤더)는 클라이언트가 배열에서 센다. 리뷰(2026-09-07)로 넣은 것: `/api/*` 응답 전부에 `Cache-Control: no-store`(쿠키 인증 개인화 응답 — main.py 미들웨어), unread 20·홈 todos 200·`/me/todos` 1000 상한, DM 상대 이름 한 방 조회. 공지 3건은 권한 밖이 섞여도 최신 3건 그대로(05 가 마스킹 행을 보여준다).
11. **§4.1 `/ws` 가 04 를 채우거나 넓힌 것(2026-09-08) — Notion 04 v1.2 §4.1·ARCHITECTURE §5 에 반영 완료(2026-09-08).** (a) 04 에 없는 서버 이벤트 두 개: `{ev:"typing", channel_id, user_id, name}`(클라이언트 `typing` 을 같은 채널의 다른 사람에게 흘림 — 04 는 보내는 쪽만 적었다), `{ev:"error", code, detail, channel_id?}`(멤버 아님 `FORBIDDEN`, 깨진 프레임·빈 본문·없는 문서 카드 `VALIDATION` — 소켓은 닫지 않는다). (b) `sub` 는 받아들이되 무시한다 — 무엇을 받을지는 `channel_members` 가 정하므로 `"ch:마케팅"` 같은 이름 기반 토픽은 쓰지 않는다. (c) 메시지 모양 `{id, channel_id, author:{id,name}, body, doc_ref, attachments, created_at}` — §5 `GET /channels/{id}/messages` 도 이 모양을 쓴다. `notice` 는 `{ev, id, kind, payload, created_at}`(id 가 있어야 `POST /me/notifications/read` 로 지운다). `presence` 는 첫 탭이 열릴 때·마지막 탭이 닫힐 때만, 접속 직후 이미 온라인인 사람들을 한 번씩 받는다. (d) 상한: 본문 1만 자(공백 제거·빈 본문 422 상당), 프레임 64KB(바이트, 초과는 1009 로 닫음 — 진짜 상한은 uvicorn `--ws-max-size 1MB`, Dockerfile·compose), 멘션 토큰은 앞 50개만. 핸드셰이크 거부(쿠키 없음·출처 불일치)는 클라이언트에 HTTP 403 으로만 보인다 — 4401/4403 구분은 서버 로그뿐이므로 프론트는 실패 시 refresh 후 재접속. `acl.denied` 는 소켓당 (채널, op) 조합마다 한 번만 남긴다. (e) 채팅 멘션 알림 payload `{channel_id, message_id, from:{id,name}, preview}` — 채널 멤버가 아닌 사람은 멘션해도 알림이 안 생긴다. (f) `msg` 는 보낸 사람의 `last_read_at` 을 그 메시지 시각으로 올린다(보고 있는 채널이다). (g) 04 §5 REST 는 아직 501 — 프론트 목(`frontend/scripts/chat.js`)의 `POST /channels/{id}/messages`·`/read` 는 이 소켓의 `msg`·`read` op 로 옮긴다. 프론트가 바꿀 것: 소켓 URL `/api/chat/ws` → `/api/ws`, 이벤트 봉투 `type` → `ev`, camelCase → snake_case·`author` 객체.
9. **알고 둔 한계(리뷰 2026-09-04).** 로그인 실패 제한은 (이메일, IP) 쌍이라 같은 IP 의 반복만 그 계정을 잠근다 — 남이 내 주소를 두드려 나를 잠글 수는 없지만, IP 를 바꿔 가며 한 계정을 두드리는 건 IP 당 30회 한도가 늦출 뿐이다. `audit_events` 는 403 도 기록하므로 member 가 관리 경로를 두드리면 표가 자란다 — 보존 기간·정리 배치는 운영 정책과 함께 정한다. 두 탭이 동시에 refresh 하는 경우는 프론트의 `navigator.locks` 가 막고, 서버측 유예 창(옛 jti 를 잠깐 허용)은 두지 않았다.
