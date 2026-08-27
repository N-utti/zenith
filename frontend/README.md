# frontend

MOA 웹 프론트엔드. React 19 · Vite · TypeScript · Tailwind v4.

백엔드(`../backend`)가 아직 없으므로 개발 중에는 **MSW**가 `/api/*`를 가로채 목 응답을 준다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
```

| 스크립트 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 (MSW 켜짐) |
| `npm run build` | 타입체크 + 프로덕션 빌드 (`dist/`) |
| `npm run typecheck` | 타입만 검사 |
| `npm run lint` | ESLint |
| `npm run preview` | 빌드 결과 미리보기 |

### 목 계정

비밀번호는 모두 `moa1234`. 로그인 화면 하단 버튼으로 바로 채울 수 있다.

| 이메일 | 역할 |
| --- | --- |
| `sujin@moa.co.kr` | member (사원) |
| `donghyun@moa.co.kr` | lead (팀장) |
| `jaeho@moa.co.kr` | exec (임원) |

역할 체계는 [근태 모듈 설계서 §3](../docs/10-근태-모듈-설계서.md)을 따른다.

### 실제 백엔드에 붙이기

```bash
VITE_DISABLE_MSW=true npm run dev
```

MSW가 꺼지고 `/api` 요청이 vite 프록시를 통해 `http://localhost:8000`(FastAPI)으로 간다.
프록시 대상은 `vite.config.ts`에서 바꾼다.

## 구조

```
src/
├─ app/           라우트 정의(routes.tsx) · 사이드바 메뉴 정의(navigation.ts)
├─ components/
│  ├─ layout/     AppLayout · Sidebar · Header · UserMenu
│  ├─ ui/         Button · Avatar · Badge · Spinner · PageHeader · PlaceholderPanel
│  └─ CommandPalette.tsx   ⌘K 팔레트 (현재는 화면 이동만)
├─ features/
│  ├─ attendance/ 근태 위젯 · 근태 API/타입
│  ├─ auth/       AuthProvider · AuthContext · RequireAuth · LoginPage
│  └─ home/       홈 대시보드 카드 (공지 · 최근문서 · 안읽은채팅 · 팀 경보)
├─ lib/           api(fetch 래퍼) · token · queryClient · theme · datetime · cn
├─ mocks/         MSW 핸들러 · 목 사용자 · 대시보드 목 데이터
├─ pages/         화면별 컴포넌트
├─ styles/        index.css — 디자인 토큰
└─ types/         Role · User 등 공용 타입
```

## 규칙

**API 호출은 반드시 `lib/api.ts`의 `api()`를 거친다.** 토큰 주입·에러 정규화(`ApiError`)가
여기 한 곳에 있다. 컴포넌트에서 `fetch`를 직접 부르지 않는다.

**색은 시맨틱 토큰만 쓴다.** `bg-surface`, `text-muted`, `border-line`, `text-accent` 처럼
의미 단위 토큰을 쓰고 `bg-brand-600`, `text-slate-500` 같은 원시값은 쓰지 않는다.
토큰 정의는 `src/styles/index.css`. 라이트/다크 두 벌이 여기서 함께 관리된다.

**폰트 CDN 금지.** 데이터·요청이 사내망을 벗어나면 안 된다(README 성공 기준: 외부 API 호출 0건).
Pretendard가 필요하면 self-host 후 `--font-sans` 스택 맨 앞에 넣는다.

**메뉴는 `src/app/navigation.ts` 한 곳에서 정의한다.** 사이드바와 ⌘K 팔레트가 같은 배열을 읽는다.
`minRole`로 메뉴를 숨길 수 있지만 이는 UI 편의일 뿐이고, 실제 차단은 서버 권한 검사가 한다.

**날짜·시간 표기는 `lib/datetime.ts`를 쓴다.** 근태에서 "기록 없음"을 0분으로 접지 않는 것이
설계서 L4의 핵심이라, 화면 문구도 "미기록 / 미확정"으로 통일한다.

## 구현 상태

| 화면 | 상태 |
| --- | --- |
| 홈 대시보드 | 목 API 연동 완료 — 근태 위젯(출퇴근 버튼·주 52h)·공지·최근문서·안읽은채팅·팀 경보(lead+) |
| 문서 · 채팅 · 게시판 · AI · 근태 | 껍데기. 화면 안에 무엇이 들어올 자리인지 적어 뒀다 |

홈 대시보드가 쓰는 목 엔드포인트 — 백엔드는 같은 스키마로 응답하면 된다.

```
GET  /api/attendance/summary       { today, week, pendingCorrections }
POST /api/attendance/check-in      → summary
POST /api/attendance/check-out     → summary
GET  /api/attendance/team-alerts   lead 미만 403
GET  /api/announcements?limit=     권한 밖 등급 글은 목록에서 제외
GET  /api/documents/recent?limit=
GET  /api/chat/unread
```
