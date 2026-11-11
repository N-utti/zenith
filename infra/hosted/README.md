# infra/hosted — 외부 호스팅 (회사별 스택)

외부 회사에 제니스를 우리 서버에서 내준다(2026-11-09 결정, A안). 사내 온프레미스 배포는 [../README.md](../README.md) 그대로다.

> **가드레일이 다르다.** 루트 README 의 「데이터가 사내망 밖으로 나가지 않는다」는 사내 설치 기준이다. 여기서는 고객사 데이터가
> 우리 서버에 있다 — 약관·개인정보 동의가 선행 조건이고, 운영 DB 를 영업 목적으로 직접 조회하지 않는다(별도 `zenith_insights` 추출, 미구현).

## 구조

```
인터넷 ─ caddy(80·443) ─┬─ acme.<도메인> → zt-acme 의 api ─┐
                        └─ beta.<도메인> → zt-beta 의 api ─┤
                                                           ├─ db      회사별 DB·계정 zt_<회사>
                공유 스택(docker-compose.yml)              ├─ minio   회사별 버킷·키 zt-<회사>
                                                           ├─ ollama  임베딩(공유, 저장 없음)
                                                           └─ hwp     .hwp 변환(공유, 저장 없음)
```

| 무엇 | 회사마다 따로 | 근거 |
| --- | --- | --- |
| api 컨테이너 | `zt-<회사>` compose 프로젝트(`tenant.yml`), 메모리 상한 768MB | 한 회사의 장애·폭주가 옆 회사로 안 번진다 |
| DB | `zt_<회사>` DB + 같은 이름의 계정. `PUBLIC` 의 CONNECT 를 거둔다, 접속 상한 20 | api 가 뚫려도 다른 회사 DB 에 못 붙는다 |
| 파일 | `zt-<회사>` 버킷 + 그 버킷만 여는 키 | 위와 같다 |
| 세션 | 회사별 `JWT_SECRET` | 한 회사의 토큰이 다른 회사에서 서명 검증을 못 넘는다 |
| 주소·인증서 | `<회사>.<ZENITH_DOMAIN>`, Let's Encrypt 가 호스트마다 발급 | 쿠키가 호스트에 묶인다 |

웹(프론트)은 전 회사가 같은 빌드다 — caddy 이미지 안에 있다.

## 처음 한 번

1. DNS: `*.<도메인>` A 레코드 → 서버 공인 IP. 방화벽은 80·443 만 연다(80 은 인증서 발급에 쓴다).
2. `docker login ghcr.io`(MinIO 미러, ../README "MinIO 이미지").
3. `cp .env.example .env` 후 채운다. 비밀번호는 `openssl rand -hex 24`.
4. (선택) `api.env` — 전 회사 api 에 들어가는 공통 값. `ANTHROPIC_API_KEY`(없으면 AI 가 답을 못 한다 — **있으면 전 회사의 AI 비용을 우리가 낸다**),
   데스크톱 앱을 받으려면 `CORS_ORIGINS=["http://tauri.localhost"]`.
5. `docker compose up -d --build` → `docker compose exec ollama ollama pull bge-m3:567m`.

## 회사 추가 · 배포

```sh
./tenant.sh add acme "에이씨엠이" admin@acme.co.kr "홍길동"   # 1분쯤. 끝에 주소·임원 계정·초기 비밀번호가 한 번 나온다
./tenant.sh update                                            # 새 코드: git pull 뒤에. 회사마다 덤프 → 재기동(마이그레이션)
./tenant.sh ls
```

- `<회사>` 는 소문자로 시작하는 소문자·숫자 2~20자. 주소·DB·버킷 이름이 된다 — 나중에 못 바꾼다.
- 초기 비밀번호는 화면에만 나온다. 전달한 뒤 본인이 바꾸게 한다(강제 변경 기능은 없다). 나머지 직원은 그 임원이 관리자 화면에서 만든다.
- `update` 는 회사를 하나씩 재기동한다 — 회사마다 몇 초 끊긴다. 덤프가 실패하면 그 회사에서 멈춘다.
- **`tenants/<회사>.env` 가 그 회사 비밀값의 유일한 사본이다**(미커밋). 서버 밖에 백업한다. 잃으면 `tenants/` 에 파일이 없는 상태에서
  `REATTACH=1 ./tenant.sh add …` 를 다시 돌린다 — DB·버킷은 그대로 두고 비밀번호·키만 새로 건다(`JWT_SECRET` 이 바뀌어 전원 재로그인. 임원 계정이 이미 있으면 그대로라, 그때 화면에 나오는 초기 비밀번호는 맞지 않는다).

- `add` 는 같은 이름의 DB 가 이미 있으면 멈춘다. **내린 회사의 이름을 다른 회사에 다시 쓰지 않는다** — `REATTACH=1` 은 남은 DB 에 그대로 붙으므로
  옛 회사의 문서·계정이 새 임원에게 열린다. 같은 회사를 다시 붙일 때(비밀값 유실, `add` 가 중간에 죽음)만 쓴다.

### 회사를 내릴 때

```sh
TENANT=acme docker compose -p zt-acme -f tenant.yml down      # api 정지
mv tenants/acme.env tenants/acme.env.off                      # 안 하면 다음 update 가 다시 띄운다
rm sites/acme.caddy && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

데이터 삭제(`DROP DATABASE zt_acme` · `DROP ROLE zt_acme` · `mc rb --force local/zt-acme` · `mc admin user rm local zt-acme`)는
**되돌릴 수 없다 — 사람이 확인하고 손으로 돌린다**(스크립트에 없다, 루트 CLAUDE.md 안전 가드레일).

## 백업

`backup` 이 24시간마다 회사 DB 마다 `backups/zt_<회사>-YYYY-MM-DD.dump`(14일 보관)를 만든다. 복구는 ../README "백업 · 복구" 와 같되
DB 이름이 `zt_<회사>` 이고, 복구 뒤 소유자가 회사 계정이어야 한다: `pg_restore -d zt_acme --clean --if-exists --no-owner --role zt_acme …`.
MinIO 파일(`miniodata` 볼륨)과 `tenants/*.env` 는 이 백업에 없다.

## 용량

회사 하나 = api 약 160MB(대기, 2026-11 실측) + DB 접속 최대 15. 공유 쪽은 db·minio·ollama(상한 3GB)·caddy.
8GB 서버면 20곳 안팎. `max_connections` 는 300(`ZENITH_PG_MAX_CONN`) — 회사 수 × 15 가 넘기 전에 올린다.
Let's Encrypt 는 등록 도메인당 주 50장이다 — 한 주에 50곳 넘게 붙이지 않는다. 50곳을 넘기면 구조(B안: 스키마 분리)를 다시 본다.

## 알고 둘 것

- 회사 계정은 자기 DB 밖의 **DB 이름 목록**은 볼 수 있다(Postgres 의 `pg_database` 는 누구나 읽는다) — 내용은 못 본다.
- 회사 주소들은 브라우저가 보기에 같은 사이트(형제 서브도메인)다. 한 회사 화면에서 XSS 가 나면 다른 회사 호스트에 쿠키를 심어 로그아웃·세션 바꿔치기를
  시도할 수 있다(읽지는 못한다). 지금은 CSP `script-src 'self'` 가 막는다 — 후속: 쿠키 이름에 `__Host-` 접두.
- `hwp` 변환기는 전 회사가 같이 쓴다. pyhwp 파서가 뚫리면 그 프로세스가 다른 회사의 변환 중인 파일을 볼 수 있다(망·디스크는 못 나간다) — 받아들인 위험,
  필요해지면 회사별 hwp 를 `tenant.yml` 로 옮긴다.
- api 들은 같은 도커 망에 있다. 서로의 8000 포트는 보이지만 그건 인터넷에 열린 것과 같은 API 다.
- 로그인 횟수 제한은 `X-Forwarded-For` 의 첫 값을 본다 — caddy 가 인터넷에 직접 붙어 있을 때만 믿을 수 있다. 앞에 로드밸런서를 두면 caddy 에 `trusted_proxies` 를 건다.
- 로컬 시험: `.env` 에 `ZENITH_DOMAIN=localhost` · `ZENITH_TLS=internal` · 포트를 비켜 띄우고 `https://acme.localhost:<포트>`.
- 아직 없는 것: 영업 데이터 추출(`zenith_insights`), 회사별 앱 이름·설정(APP_NAME · workspaces.settings), 가입 화면(지금은 운영자가 `add`).
