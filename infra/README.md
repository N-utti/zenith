# infra — 온프레미스 배포

정본은 [ARCHITECTURE · 시스템 설계](https://app.notion.com/p/3aaa471660468173baf8e1dd19d77ede) §7.
서버 1대 + Docker Compose 단일 스택.

## 지금 있는 것

| 서비스 | 이미지 | 용도 |
| --- | --- | --- |
| `db` | `pgvector/pgvector:pg16` | 문서·채팅·권한 + 벡터(RAG) |
| `redis` | `redis:7-alpine` | presence · 안 읽음 · WS 팬아웃 (아직 코드가 안 씀) |
| `minio` | `minio/minio` | 채팅 첨부·문서 이미지 (아직 코드가 안 씀) |
| `api` | `../backend/Dockerfile` | FastAPI. 기동 때 `alembic upgrade head` 를 먼저 돌리고 uvicorn 을 띄운다 |

```sh
docker compose up -d db          # 개발: DB만 띄우고 API는 uv로
docker compose up -d --build     # 전부 — backend/.env 에 JWT_SECRET 이 있어야 api 가 뜬다
```

호스트 포트가 겹치면 `ZENITH_DB_PORT` · `ZENITH_API_PORT` · `ZENITH_REDIS_PORT` · `ZENITH_MINIO_PORT` 로 바꾼다.
caddy(TLS)가 없는 동안 api 는 평문 http 라 `COOKIE_SECURE=false` 로 띄운다 — TLS 를 붙이면 `ZENITH_COOKIE_SECURE=true`.

## 아직 없는 것

- **caddy** — TLS(사내 CA)·리버스 프록시·`/yjs` forward_auth. 프론트 빌드가 붙을 때.
- **web** — Vite 산출물 file_server.
- ~~**yjs** — y-websocket 릴레이~~ → 필요 없어졌다(2026-09-07). 릴레이는 `api` 안에 있다(`/api/yjs/{doc_id}`, pycrdt). 그래서 `api` 는 **worker 1개**로 띄운다. 개발 중 프론트는 `frontend/scripts/dev-server.js` 대신 vite `/collab` 프록시를 `/api/yjs` 로 돌리면 된다.
- **ollama** — ARCHITECTURE §7은 Mac mini 네이티브 실행이었으나, AI는 Claude API로 가기로 했다(2026-09-04). 되돌리면 `OLLAMA_URL` 만 추가하면 된다.
- 일일 `pg_dump` 백업, 모니터링(`/metrics`).
