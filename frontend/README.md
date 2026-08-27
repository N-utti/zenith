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
│  ├─ docs/       TipTap 에디터 · Yjs 협업 세션 · 댓글
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

**근태 기록은 지우지 않는다.** ① 수집 계층이 무손실이어야 규칙 변경 시 재계산(replay)이
가능하다(설계서 §1.2). 퇴근 취소도 삭제가 아니라 취소 이벤트를 덧붙이고 판정 계층이 이를
무시하는 방식이다. 유예(5분) 안의 취소는 승인 없이 정정되고, 넘기면 보정 신청 + 팀장 승인으로 간다.

## 구현 상태

| 화면 | 상태 |
| --- | --- |
| 홈 대시보드 | 근태 위젯(출퇴근·주 52h)·공지·최근문서·안읽은채팅·팀 경보(lead+) |
| 문서 | 목록·검색·생성, TipTap 에디터, Yjs 실시간 공동편집, 댓글 |
| 채팅 · 게시판 · AI · 근태 상세 | 껍데기. 화면 안에 무엇이 들어올 자리인지 적어 뒀다 |

목 엔드포인트 — 백엔드는 같은 스키마로 응답하면 된다.

```
GET   /api/attendance/summary          { today, week, pendingCorrections }
POST  /api/attendance/check-in         → summary
POST  /api/attendance/check-out        → summary
POST  /api/attendance/check-out/undo   유예(5분) 경과 시 409 → 보정 경로 안내
GET   /api/attendance/team-alerts      lead 미만 403
GET   /api/announcements?limit=        권한 밖 등급 글은 목록에서 제외
GET   /api/chat/unread

GET   /api/documents?q=                목록·검색
POST  /api/documents                   생성
GET   /api/documents/:id               메타 (+ seedHtml, 아래 참조)
PATCH /api/documents/:id               제목·수정시각 투영
GET   /api/documents/recent?limit=
GET   /api/documents/:id/comments
POST  /api/documents/:id/comments
```

## 문서 본문은 서버에 없다

본문의 원천은 **Y.Doc**이다. 서버(MSW)는 목록·검색이 볼 제목과 수정시각만 투영해
들고 있다. 실제 백엔드도 같은 모양이 된다 — Yjs 업데이트를 보관하고 제목만 별도로 둔다.

지금 동기화 경로는 이렇다.

```
Y.Doc ──┬─ IndexeddbPersistence   브라우저에 영속
        └─ BroadcastProvider      같은 브라우저의 탭 사이 (BroadcastChannel)
```

`BroadcastProvider`는 y-websocket과 **같은 프로토콜**(sync + awareness)과 같은
인터페이스(`awareness`, `destroy()`)를 쓴다. 백엔드 WS가 생기면
`useCollabSession.ts`에서 provider 한 줄만 바꾸면 된다.

### 공동편집 확인하는 법

같은 문서를 **탭 두 개**로 열면 된다. 한쪽에서 타이핑하면 다른 쪽에 즉시 반영되고,
상대 커서와 이름표, 헤더의 "N명 편집 중"이 나타난다.

`seedHtml`은 Y.Doc이 비어 있을 때만 한 번 심는 초안이다. 실제 서버에서는 보관 중인
Yjs 초기 상태가 그 자리를 대신하므로 이 필드는 사라진다.

> 되돌리기는 `StarterKit`의 `undoRedo`가 아니라 **Yjs UndoManager**가 담당한다
> (`undoRedo: false`). 그래야 Ctrl+Z가 남의 편집까지 지우지 않고 내 변경만 되돌린다.
