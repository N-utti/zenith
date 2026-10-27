# 제니스(Zenith) — 사내 협업툴

> **상태: 라이브 테스트 중** · 사내 계정 7개 · 사내망 전용 · 2인 팀(백엔드·PM 정성운 / 프론트 진수연)
>
> 포트폴리오: [AX(AI 활용)](https://wjdtjddns98.github.io/) · [개발자](https://wjdtjddns98.github.io/dev/)

약 15명 규모 자산운용사의 채팅·문서·게시판·결재·근태·AI 를 **회사 서버 안에서 도는 앱 하나**로 합쳤다.

## 왜 만들었나 → 무엇이 됐나

- **문제** — 업무 대화·문서·공지가 외부 SaaS 여러 곳에 흩어져 있었고, 금융사라 데이터가 사내망 밖으로 나가면 안 된다.
- **결과** — 채팅 · Yjs 실시간 공동편집 문서 · 등급 게시판 · ⌘K 통합검색 · 전자결재 · 근태 · 협업 공간 · CRM · AI 어시스턴트를 온프레미스 하나로. 서버의 외부 호출은 AI 공급자(Claude API) 하나뿐이다.

| 지표 | 값 |
| --- | --- |
| 커밋 · PR | 484 · 487 (본인 PR 99) |
| 백엔드 테스트 | 343 |
| ⌘K 검색 | 56 ms @ 6만 건 |
| 채팅 전달 p95 | 14.7 ms (로컬 측정) |

## 역할

- **정성운** — 백엔드 전부(FastAPI·DB·실시간·AI)·인프라·CI, PM(Notion 정본 관리·일정·FE↔BE 계약)
- **진수연** — 프론트(React)·데스크톱 셸

## 핵심 설계 결정

1. **권한은 서버가 판정한다** — 임원 게시판 본문은 API 가 403, 결재 문서는 역할이 아니라 기안자·결재선 **관계**로 열람을 판정한다. 프론트의 마스킹·메뉴 숨김은 편의일 뿐.
2. **AI 근거는 하이브리드 검색** — FTS + pgvector(bge-m3) 를 RRF 로 합쳐 답변 문장에 각주로 붙인다. Claude tool use 로 사내 검색·문서 열람 도구를 호출하고, 권한 밖 문서는 근거에서 빠진다.
3. **AI 공급자는 모듈 한 곳 뒤에** — `app/ai/provider.py` 경계 하나. Ollama → Claude API 전환(2026-09-04)을 그 모듈만 바꿔서 했고, 스트리밍과 HTTP 연결 수명을 분리했다.
4. **계약은 코드로 검사한다** — `backend/openapi.json` 을 커밋하고 최신성 테스트가 지킨다. 프론트는 거기서 타입을 생성한다.
5. **보안은 기본값으로** — CSP, 로그아웃 시 Clear-Site-Data, 첨부 회수(살아 있는 글에 실린 파일만·올린 사람만), 보안민감 변경은 Claude + Codex 교차 리뷰.

## 아키텍처

FastAPI 프로세스 하나가 REST · WebSocket(채팅·알림·presence) · Yjs 릴레이(pycrdt)를 함께 담고, PostgreSQL 16(FTS + pgvector) · Redis · MinIO 를 쓴다. Caddy 가 TLS 와 정적 프론트를 맡는다. AI 는 provider 모듈 뒤의 Claude API, 임베딩은 bge-m3.

## 🧱 스택

| 영역 | 기술 |
| --- | --- |
| **FE** | React 19 · Vite · Tailwind v4 · TipTap + Yjs |
| **BE** | FastAPI · PostgreSQL 16 + pgvector · Redis · MinIO · Caddy |
| **AI** | Claude API(tool use) · bge-m3 임베딩 — 공급자 경계는 `app/ai/provider.py` |
| **앱** | Tauri 2(Win) · Capacitor 8(And/iOS, v1.1) |

## 📁 모노레포 구조

```
zenith/
├─ backend/    FastAPI · 인증(JWT) · RAG · 실시간(WS/Yjs)
├─ frontend/   React 19 프로토타입 → API 연동
├─ apps/       Tauri(Win) · Capacitor(Android/iOS) 패키징
│  └─ desktop/   Windows 데스크탑 셸 → .msi  (npm run dev / npm run build)
├─ infra/      배포·온프레미스 설정(Postgres/Redis/MinIO/Ollama)
└─ docs/       문서 인덱스 — 정본은 Notion, 여기엔 링크만 둔다
```

협업 규칙(역할 분담·브랜치·커밋·리뷰 등급)은 [`CLAUDE.md`](CLAUDE.md), 영역별 규칙은 각 디렉터리의 `CLAUDE.md`.

## 🚀 실행 — 개발 서버

데모는 MSW 목이 켜진 프론트 개발 서버로 본다. 실제 백엔드까지 띄우는 법은 [backend/README.md](backend/README.md).

터미널 두 개가 필요하다.

```powershell
cd frontend
npm install
npm run dev        # http://localhost:5173 — 앱 (MSW 목 켜짐)
```

채팅 · 문서 공동편집 릴레이(http://localhost:1234)도 함께 뜬다. 릴레이만 따로 재시작하려면
`npm run server`. 릴레이가 없으면 **채팅은 아예 동작하지 않고**, 문서 공동편집은 같은
브라우저의 탭끼리만 붙는다(다른 브라우저·다른 PC와는 동기화되지 않는다).

데스크탑 창으로 보려면 — vite(:5173)를 자동으로 띄우고 그 화면을 셸에 붙인다.
릴레이는 위와 같이 따로 켠다.

```powershell
cd apps/desktop
npm install
npm run dev
```

로그인 비밀번호는 목 계정 셋 다 `zenith1234`이고, 로그인 화면 하단 버튼으로 사원·팀장·임원을
바로 채울 수 있다. 계정 목록과 역할은 [`frontend/README.md`](frontend/README.md#목-계정) 참조.

> `VITE_DISABLE_MSW=true` 는 목을 끄고 `/api` 를 FastAPI(:8000)로 보내는 스위치다 — 백엔드를 띄운 뒤에만 켠다.

자세한 사항은 [`frontend/README.md`](frontend/README.md) · [`apps/desktop/README.md`](apps/desktop/README.md).

## 🗺 로드맵 — 2026-09-07 재수립

단계 번호는 [Notion 프로젝트 허브](https://app.notion.com/p/3aaa47166046815a8b8bfc07c8eeeb98)의 마일스톤 보드를 따른다.
**06 · WBS·일정계획서(v1.0, 2026-07-27)의 M 번호와는 뜻이 다르다** — 거기서는 M3가 AI, M4가 마감이다.

- **M0 — 기반** · 스케폴딩 · 인증·계정·감사 로그 · 프론트 화면 세트(MSW) · CI — ✅ 완료
- **M1 — 코어** · 문서 트리·CRUD·버전·댓글, `/api/yjs` 공동편집 영속화, 홈·할 일·알림함 — 기능은 다 됐고, 게이트인 **동시편집 반영 시간 실측**이 남았다
- **M2 — 커뮤니케이션** · `/api/ws` 채팅·알림·presence, 채팅 REST·첨부(MinIO), 멘션 알림, ⌘K 통합검색(FTS + 권한 SQL) — 기능은 다 됐고, 게이트인 **채팅 전달 P95 실측**이 남았다
- **M3 — 게시판·앱** · 등급별 게시판(마스킹·403) ✅ / **`.msi` 서명은 미착수.** Capacitor Android·iOS 는 v1.1 로 미뤘다(2026-09-22)
- **M4 — 마감** · caddy(TLS·리버스 프록시·정적 web) · 일일 `pg_dump` 백업 · `/metrics` · CSP 실적용 ✅ / **prod 브랜치·파일럿이 남았다**
- **AI · 근태 · 전자결재** · 2026-09-22 보류 해제, 2026-10 초 백엔드 구현 완료(결재함·근태·AI 어시스턴트·협업 공간·CRM) — 라이브 테스트 중

> 🔴 **기간은 다시 잡지 않았다.** 8주 계획(2026-08-03 ~ 09-25)은 무효다.
>
> 남은 일에 날짜를 붙이기 전에 아래 셋이 닫혀야 한다. 셋 다 개발이 아니라 **결정**이다.
>
> 1. ~~**AI 공급자**~~ — **2026-09-22 에 정했다.** 성공 기준을 「문서·채팅·게시판·근태·결재는 사내,
>    서버의 외부 호출은 AI 공급자 하나」로 재정의하고, 민감 문서(임원 게시판·결재·근태)는 AI 색인에서 뺀다.
>    RAG 일정을 막던 건 풀렸고, 08 사업계획의 "외부 전송 0건" 약속과 어긋나는 부분에 대한
>    **경영진 사후 승인**만 남았다 ([01 · PRD](https://app.notion.com/p/3aaa471660468150a9cce9277a579deb) O10)
> 2. **근태 설계서 v0.4** — 정책 확정·노무 검토 대기
>    ([10 · 근태 모듈 설계서](https://app.notion.com/p/3aea471660468172aea1c46d2b11addf))
> 3. **A(오픈 범위 축소) / B(8주 → 14~16주) / C(인력 추가)** — 2026-08-31 제기, 아직 미결
>    ([13 · 전자결재 모듈 설계서](https://app.notion.com/p/3cda471660468170b325d0ea56562418) §12)

## ✅ 성공 기준

여기는 요약이다. **판정 근거는 [01 · PRD §5](https://app.notion.com/p/3aaa471660468150a9cce9277a579deb)** —
기준마다 07 테스트계획서의 시나리오 번호와 현재 상태가 붙어 있다.

- [ ] 2인 동시편집 시 1초 이내 변경·커서 반영 (충돌 0)
- [x] ⌘K가 문서·채팅 통합 검색, 권한 밖 문서 미노출 — 권한 필터가 검색 SQL 안에 있다
- [ ] AI 답변 사실문장에 각주, 권한 밖 문서는 근거 자동 제외
- [x] 임원 게시판 글 member에서 제목 마스킹 + 본문 API 403
- [ ] 문서·채팅·게시판·근태·결재 데이터는 사내망 유지 — 서버의 외부 호출은 AI 공급자 하나뿐
      (예외 하나: 팩트체커의 「웹도 찾기」를 켜면 검사 대상 글과 그 검사에 쓰인 규정·사내 검색 결과가 Anthropic 웹 검색의 검색어 재료가 된다 — 배포 스위치 `AI_WEB_SEARCH` 기본 꺼짐, 요청별 명시, 감사 `ai.web_search`. backend/README 49)
      (2026-09-22 재정의. 종전 문구는 "외부 API 호출 0건"이었고 Claude API 전환 뒤 자동 실패 상태였다)
- [ ] AI 색인에서 임원 게시판·결재·근태 문서 제외 — 민감 문서 본문이 외부로 나가지 않음
- [ ] Windows/.msi 사내 설치 + 모바일은 브라우저로 같은 기능 (Android APK·iOS TestFlight 는 v1.1로 미룸)
- [ ] 휴가·연차가 신청·승인으로 관리되고 개인·팀 월별 근태가 집계됨 — 출퇴근 시각·생체정보·위치정보는 수집하지 않음
- [ ] 기안 → 결재선 → 승인/반려가 한 결재함에서 처리되고, 처리 이력이 문서마다 남음 (휴가·연장근로도 같은 결재함)
- [ ] 결재 문서는 기안자·결재선·참조자·임원만 열람 — 역할이 아니라 관계로 판정

> 등급은 **사원(member)·임원(exec) 2단**이다(2026-09-22). 조직도에 팀장 직급이 없어 lead 계정을
> 만들 수 없었다. 팀장↑ 게시판과 팀 단위 근태 열람은 v1 에서 빠진다.

## 📚 프로젝트 문서

기획·설계 문서는 [Notion 프로젝트 허브](https://app.notion.com/p/3aaa47166046815a8b8bfc07c8eeeb98)에서 관리한다.
(01 PRD → 02 요구사항정의서 → 03 ERD·DB → 04 API 명세 → 05 화면정의서 → 06 WBS → 07 테스트계획 → 08 사업계획 → 09 기안서 → 10 근태 모듈 설계서 → 11 인증·IdP 연동 → 12 UI 청사진 → 13 전자결재 모듈 설계서 · ARCHITECTURE)

**저장소에는 문서 사본을 두지 않는다.** 뒤처진 사본은 없는 것보다 나쁘기 때문이다.
어떤 문서를 언제 열어야 하는지는 [`docs/README.md`](docs/README.md) 인덱스에 적어 뒀다.
