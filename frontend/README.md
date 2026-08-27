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
│  └─ auth/       AuthProvider · AuthContext · RequireAuth · LoginPage
├─ lib/           api(fetch 래퍼) · token · queryClient · theme · cn
├─ mocks/         MSW 핸들러 · 목 사용자
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

## 아직 비어 있는 것

각 화면은 껍데기이며, 무엇이 들어올 자리인지 화면 안에 적어 뒀다.
문서(M1) · 채팅(M2) · 홈 대시보드(M2) · AI(M3) · 게시판(M4) · 근태(일정 미확정).
