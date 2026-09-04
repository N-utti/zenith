# 🧩 제니스(Zenith) — 사내 협업툴

채팅·문서·등급별 게시판·사내 AI를 **회사 서버 안에서 동작하는 하나의 앱**(Windows·Android·iOS)으로 통합한다.
슬랙 + 노션 + 등급 게시판 + 로컬 LLM을 **온프레미스**로.

> 약 15명 규모 · 온프레미스 · 데이터·AI 추론이 사내망 밖으로 나가지 않음.

## 🎯 개요

- **목표** — 흩어진 업무 대화·문서·공지를 사내 서버 하나로 일원화하고, 사내 위키를 근거로 답하는 로컬 AI를 붙인다. (외부 SaaS 구독·데이터 유출 경로 제거)
- **핵심 모듈** — 문서(실시간 공동편집) · 채팅(채널·DM) · 등급별 게시판 · ⌘K 통합검색 · AI 어시스턴트(위키 RAG) · 문서 인라인 AI · **전자결재** · 근태(휴가·연차 · 예외 근무 신청·승인)
- **범위 In** — 전자결재, 휴가·연차 관리, 문서 공동편집, 채팅, 게시판 3등급 열람통제, RAG AI + 권한필터, Win/Android/iOS 앱
- **범위 Out (v1)** — 공인전자서명·타임스탬프, 화상회의, 이메일 대체, 외부 게스트·앱스토어 공개 배포

## 🧱 스택

| 영역 | 기술 |
| --- | --- |
| **FE** | React 19 · Vite · Tailwind v4 · TipTap + Yjs |
| **BE** | FastAPI · PostgreSQL 16 + pgvector · Redis · MinIO |
| **AI** | Mac mini M4 · Ollama(8B Q4) · bge-m3 → **Claude API로 전환 예정** (2026-09-04 결정 · [backend/README](backend/README.md) "설계와 어긋나는 것") |
| **앱** | Tauri 2(Win) · Capacitor 8(And/iOS) |

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

## 🚀 실행 — 개발 서버

**화면을 볼 수 있는 경로는 개발 서버뿐이다.** `backend/`에 코드가 없어서 설치본 `.msi`는
로그인 화면에서 멈춘다 — 배포 빌드에서는 MSW 목이 통째로 빠지고 `/api` 요청이 실제
사내 서버로 나가기 때문이다. 데모는 목이 살아 있는 개발 모드에서 한다.

터미널 두 개가 필요하다.

```powershell
cd frontend
npm install
npm run dev        # http://localhost:5173 — 앱 (MSW 목 켜짐)
```

```powershell
cd frontend
npm run server     # http://localhost:1234 — 채팅 · 문서 공동편집 릴레이
```

두 번째를 안 켜면 **채팅은 아예 동작하지 않고**, 문서 공동편집은 같은 브라우저의 탭끼리만
붙는다(다른 브라우저·다른 PC와는 동기화되지 않는다).

데스크탑 창으로 보려면 — vite(:5173)를 자동으로 띄우고 그 화면을 셸에 붙인다.
릴레이는 위와 같이 따로 켠다.

```powershell
cd apps/desktop
npm install
npm run dev
```

로그인 비밀번호는 목 계정 셋 다 `zenith1234`이고, 로그인 화면 하단 버튼으로 사원·팀장·임원을
바로 채울 수 있다. 계정 목록과 역할은 [`frontend/README.md`](frontend/README.md#목-계정) 참조.

> ⚠️ `VITE_DISABLE_MSW=true`는 켜지 말 것. 목을 끄고 `/api`를 FastAPI(:8000)로 보내는
> 스위치인데, 붙을 그 서버가 아직 없어서 개발 모드에서도 로그인이 막힌다.

자세한 사항은 [`frontend/README.md`](frontend/README.md) · [`apps/desktop/README.md`](apps/desktop/README.md).

## 🗺 로드맵 (8주 · 2026-08-03 ~ 09-25)

- **M1 — 코어 (3주)** · 인증, 문서 CRUD, TipTap+Yjs 실시간 공동편집, 댓글
- **M2 — 커뮤니케이션 (2주)** · 채팅 채널·DM, 알림, 홈 대시보드, ⌘K 통합검색
- **M3 — AI (2주)** · 로컬 LLM 연동, 위키 RAG(권한필터), 어시스턴트·인라인 AI·템플릿
- **M4 — 마감 (2주)** · 등급별 게시판, 앱 패키징(Win/Android/iOS), 파일럿 → 전사 오픈

> 🔴 **이 로드맵은 재수립 대기 중이다 (2026-08-31).**
>
> 전자결재가 v1으로 편입되면서(약 4주) 근태(약 3주)와 함께 M1~M4 어디에도 자리가 없다.
> 게다가 **`backend/`는 2026-09-04 기준 인증·계정 관리·감사 로그만 실구현이고 나머지는 501 스텁이다**
> ([backend/README](backend/README.md)). 프론트는 인증만 실서버 규약(쿠키)으로 옮겼고 다른 화면은 아직 MSW 목이다 —
> 결재를 빼도 남은 3주에 백엔드 전체를 넣을 수 없다.
>
> A(오픈 범위 축소) / B(8주 → 14~16주) / C(인력 추가) 중 미결.
> 근거와 권고는 [13 · 전자결재 모듈 설계서](https://app.notion.com/p/3cda471660468170b325d0ea56562418) §12,
> 근태 쪽 추정은 [10 · 근태 모듈 설계서](https://app.notion.com/p/3aea471660468172aea1c46d2b11addf) §12 참조.

## ✅ 성공 기준

- [ ] 2인 동시편집 시 1초 이내 변경·커서 반영 (충돌 0)
- [ ] ⌘K가 문서·채팅 통합 검색, 권한 밖 문서 미노출
- [ ] AI 답변 사실문장에 각주, 권한 밖 문서는 근거 자동 제외
- [ ] 임원 게시판 글 member에서 제목 마스킹 + 본문 API 403
- [ ] 모든 데이터·AI 추론 사내망 유지 — 외부 API 호출 0건
- [ ] Windows/.msi · Android/APK · iOS/TestFlight 사내 설치 가능
- [ ] 휴가·연차가 신청·승인으로 관리되고 개인·팀 월별 근태가 집계됨 — 출퇴근 시각·생체정보·위치정보는 수집하지 않음
- [ ] 기안 → 결재선 → 승인/반려가 한 결재함에서 처리되고, 처리 이력이 문서마다 남음 (휴가·연장근로도 같은 결재함)
- [ ] 결재 문서는 기안자·결재선·참조자·임원만 열람 — 역할이 아니라 관계로 판정

## 📚 프로젝트 문서

기획·설계 문서는 [Notion 프로젝트 허브](https://app.notion.com/p/3aaa47166046815a8b8bfc07c8eeeb98)에서 관리한다.
(01 PRD → 02 요구사항정의서 → 03 ERD·DB → 04 API 명세 → 05 화면정의서 → 06 WBS → 07 테스트계획 → 08 사업계획 → 09 기안서 → 10 근태 모듈 설계서 → 11 인증·IdP 연동 → 12 UI 청사진 → 13 전자결재 모듈 설계서 · ARCHITECTURE)

**저장소에는 문서 사본을 두지 않는다.** 뒤처진 사본은 없는 것보다 나쁘기 때문이다.
어떤 문서를 언제 열어야 하는지는 [`docs/README.md`](docs/README.md) 인덱스에 적어 뒀다.
