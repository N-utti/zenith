# infra — 온프레미스 배포

정본은 [ARCHITECTURE · 시스템 설계](https://app.notion.com/p/3aaa471660468173baf8e1dd19d77ede) §7.
서버 1대 + Docker Compose 단일 스택.

## 지금 있는 것

| 서비스 | 이미지 | 용도 |
| --- | --- | --- |
| `caddy` | `caddy/Dockerfile` (node 빌드 → `caddy:2-alpine`) | TLS 종단 · `/api/*` 리버스 프록시(WebSocket 포함) · 프론트 정적 파일. ARCHITECTURE §7 의 `web` 은 별도 컨테이너가 아니라 이 이미지 안의 file_server 다 |
| `api` | `../backend/Dockerfile` | FastAPI. 기동 때 `alembic upgrade head` 를 먼저 돌리고 uvicorn 을 띄운다. 호스트 포트 없음 — caddy 로만 들어온다 |
| `db` | `pgvector/pgvector:pg16` | 문서·채팅·권한 + 벡터(RAG) |
| `redis` | `redis:7-alpine` | presence · 안 읽음 · WS 팬아웃 (아직 코드가 안 씀) |
| `minio` | `quay.io/minio/minio:RELEASE…` | 채팅 첨부(`app/storage.py`). Docker Hub 의 `minio/minio` 는 pull 이 거부돼 quay 태그로 고정 |
| `backup` | `pgvector/pgvector:pg16` | 24시간마다 `pg_dump -Fc` → `ZENITH_BACKUP_DIR`(기본 `./backups`), 14일 지난 덤프 삭제 |

```sh
docker compose up -d db          # 개발: DB만 띄우고 API는 uv 로, 프론트는 vite 로
docker compose up -d --build     # 전부 — backend/.env 에 JWT_SECRET 이 있어야 api 가 뜬다. https://localhost
```

호스트 포트가 겹치면 `ZENITH_DB_PORT` · `ZENITH_REDIS_PORT` · `ZENITH_MINIO_PORT` · `ZENITH_MINIO_CONSOLE_PORT` · `ZENITH_HTTP_PORT` · `ZENITH_HTTPS_PORT` 로 바꾼다.
db·redis·minio 의 호스트 포트는 **127.0.0.1 에만** 묶인다 — 다른 PC 에서는 caddy(80·443)만 보인다.

**서버에 올릴 때 바꿀 것**: `ZENITH_DB_PASSWORD` · `ZENITH_MINIO_PASSWORD`(기본값은 개발용 `zenith`·`zenith-minio`), `backend/.env` 의 `JWT_SECRET`. compose 옆 `.env` 파일(미커밋)에 두면 된다.
프론트 코드가 바뀌면 `docker compose up -d --build caddy` 로 이미지를 다시 만든다(빌드 컨텍스트는 레포 루트, 루트 `.dockerignore` 가 frontend 만 남긴다).

### TLS · 사이트 이름

- `ZENITH_SITE`(기본 `localhost`)가 인증서의 이름이다. 사내 DNS 이름이나 IP 로 바꾸고 `docker compose restart caddy`. 브라우저 주소창과 같아야 한다 — api 의 CSRF 가 `Origin` 과 `X-Forwarded-Host` 를 대조한다.
- 인증서는 Caddy 자체 CA(`tls internal`)가 서명한다. 루트 인증서를 뽑아 사내 PC·앱의 신뢰 저장소에 넣는다(MDM). 이미 사내 CA 가 있으면 `caddy/Caddyfile` 의 `tls` 줄에 인증서·키 경로를 적는다.

```sh
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./zenith-root.crt
```

- **자체 CA 의 대가**: 루트를 넣은 PC 는 이 서버를 CA 로 신뢰한다 — 서버(`caddy_data` 볼륨의 CA 키)가 침해되면 그 PC 의 모든 HTTPS 가 위조 가능하다(이름 제약 없음, 폐기 수단 없음). 사내 CA 가 있으면 그것을 쓰고, 없으면 배포 대상을 제니스를 쓰는 PC 로만 한정한다.
- caddy 가 `X-Content-Type-Options`·`X-Frame-Options`·`Referrer-Policy` 를 붙인다. HSTS 는 사내 CA 결정 뒤. CSP 는 아래 "CSP".
- **사내 CA 확인(IT 에 물어볼 것, 결정 전까지 `tls internal`)** — 답에 따라 갈린다:
  1. 사내 CA(AD CS 등)가 있고 서버 인증서를 발급해 주는가? → 있으면 인증서·키를 `/certs` 로 마운트하고 `Caddyfile` 의 `tls` 줄을 `tls /certs/cert.pem /certs/key.pem` 으로. 갱신 주기(보통 1년)와 갱신 절차를 같이 받는다.
  2. 없으면: 15명 PC 에 caddy 루트(`zenith-root.crt`)를 넣을 수단이 있는가(MDM·GPO·수동)? 위 "자체 CA 의 대가" 를 IT 가 받아들이는가?
  3. 사이트 이름(`ZENITH_SITE`)은 사내 DNS 이름인가 IP 인가? DNS 이름이어야 인증서를 바꿔도 주소가 안 바뀐다.
  4. 모바일(Capacitor)도 같은 루트를 신뢰해야 한다 — iOS 는 프로파일 설치, Android 는 사용자 CA 를 앱이 신뢰하도록 network_security_config 필요(프론트 몫).
  결정 뒤: HSTS(`Strict-Transport-Security "max-age=31536000"`)를 붙인다 — 인증서가 깨지면 우회가 막히므로 사내 CA 로 안정된 뒤에.

### CSP

`Caddyfile` 이 `Content-Security-Policy-Report-Only` 를 붙인다(2026-09-16) — **아무것도 막지 않는다**. 브라우저 devtools 콘솔에 `[Report Only]` 로 위반만 찍힌다(report-uri 는 두지 않았다 — 15명 규모에서 콘솔 확인이면 된다).
승격 절차: (1) 프론트가 로그인·문서 편집·채팅 첨부(이미지 미리보기)·AI 답변·⌘K 를 한 바퀴 돌며 콘솔에 CSP 위반이 없는지 본다, (2) 위반이 있으면 규칙을 고친다(정당한 리소스) 또는 코드를 고친다(인라인 스크립트 등), (3) 헤더 이름에서 `-Report-Only` 를 뗀다. `script-src` 의 sha256 은 `frontend/index.html` 의 인라인 테마 스크립트 해시라 그 스크립트를 고치면 해시를 다시 뽑는다(`docker compose exec caddy cat /srv/index.html` 의 `<script>…</script>` 안쪽 **바이트 그대로**(개행 포함) sha256 → base64. 개행은 `.gitattributes` 가 LF 로 고정한다 — Windows 에서 CRLF 로 빌드하면 해시가 어긋나 거짓 위반이 찍힌다) — 스크립트를 외부 파일로 빼면 해시가 필요 없어진다(프론트 제안).
- api 는 `COOKIE_SECURE=true` 가 기본이다. caddy 없이 api 에 평문 http 로 붙는 실험에서만 `ZENITH_COOKIE_SECURE=false`.

### 백업 · 복구

`backup` 이 24시간마다(컨테이너가 뜬 시각 기준, 날짜는 KST) `backups/zenith-YYYY-MM-DD.dump` 를 0600 으로 만든다. 덤프에는 전 계정(비밀번호 해시)·문서·채팅이 들어 있다 — 사본은 원본과 같은 급으로 다룬다. 실패는 `docker compose logs backup` 에 `backup FAILED` 로 남는다. 새벽 고정이 필요하면 호스트 cron 에서 `docker compose restart backup`. 복구 리허설(M4 수용 기준):

```sh
# 리허설: 별도 DB 에 복원해 보고 지운다(backup 컨테이너에 backups/ 가 /backups 로 마운트돼 있다). 2026-09-16 통과.
docker compose exec backup sh -c 'createdb zenith_restore_test && pg_restore -d zenith_restore_test /backups/zenith-2026-09-16.dump && dropdb zenith_restore_test'
# 실제 복구 — 기존 데이터를 지우는 명령이다. 사람이 확인하고 돌린다. api 는 먼저 내린다.
docker compose stop api && docker compose exec backup pg_restore -d zenith --clean --if-exists /backups/zenith-2026-09-16.dump && docker compose start api
```

MinIO 의 첨부 파일(`miniodata` 볼륨)은 이 백업에 없다 — 볼륨을 따로 복사한다.

## 아직 없는 것

- ~~**caddy** · **web**~~ → 2026-09-16 붙였다(위).
- ~~**yjs** — y-websocket 릴레이~~ → 필요 없어졌다(2026-09-07). 릴레이는 `api` 안에 있다(`/api/yjs/{doc_id}`, pycrdt). 그래서 `api` 는 **worker 1개**로 띄운다. 개발 중 프론트는 `frontend/scripts/dev-server.js` 대신 vite `/collab` 프록시를 `/api/yjs` 로 돌리면 된다.
- **ollama** — ARCHITECTURE §7은 Mac mini 네이티브 실행이었으나, AI는 Claude API로 가기로 했다(2026-09-04). 되돌리면 `OLLAMA_URL` 만 추가하면 된다.
- ~~모니터링(`/metrics`)~~ → 2026-09-16 api 가 `GET /api/metrics`(Prometheus 텍스트)를 낸다. caddy 는 이 경로를 바깥에 404 로 막으므로 스크레이퍼는 compose 안에서 `api:8000/api/metrics` 를 긁는다 — Prometheus 컨테이너 자체는 파일럿 때 필요하면. 네이티브 셸(Tauri/Capacitor)의 교차 오리진 쿠키 검증(`CORS_ORIGINS`, 11 I6).
