# frontend

MOA 웹 프론트엔드. React 19 · Vite · TypeScript · Tailwind v4.

백엔드(`../backend`)가 아직 없으므로 개발 중에는 **MSW**가 `/api/*`를 가로채 목 응답을 준다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
npm run server     # 다른 터미널 — 공동편집·채팅 서버
```

| 스크립트 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 (MSW 켜짐) |
| `npm run server` | 개발용 실시간 서버 — 문서 공동편집 + 채팅. **채팅은 이게 없으면 아예 동작하지 않는다** |
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
│  ├─ chat/       채널 목록 · 메시지 · 입력창 · 실시간 소켓
│  ├─ docs/       TipTap 에디터 · Yjs 협업 세션 · 댓글 · 버전 기록
│  └─ home/       홈 대시보드 카드 (공지 · 최근문서 · 안읽은채팅 · 팀 경보)
├─ lib/           api(fetch 래퍼) · token · queryClient · theme · datetime · cn
├─ mocks/         MSW 핸들러 · 목 사용자 · 대시보드 목 데이터
├─ pages/         화면별 컴포넌트
├─ styles/        index.css — 디자인 토큰
└─ types/         Role · User 등 공용 타입

scripts/            개발 서버 (백엔드 대역)
├─ dev-server.js    HTTP + WebSocket 업그레이드 라우팅
├─ collab.js        문서 공동편집 (Yjs)
└─ chat.js          채팅 REST + WebSocket
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
| 문서 | 목록·검색·생성, TipTap 에디터, Yjs 실시간 공동편집, 댓글, 버전 기록·되돌리기 |
| 채팅 | 채널·DM, 실시간 송수신, 안읽음, 타이핑 표시 |
| 게시판 · AI · 근태 상세 | 껍데기. 화면 안에 무엇이 들어올 자리인지 적어 뒀다 |

목 엔드포인트 — 백엔드는 같은 스키마로 응답하면 된다.

```
GET   /api/attendance/summary          { today, week, pendingCorrections }
POST  /api/attendance/check-in         → summary
POST  /api/attendance/check-out        → summary
POST  /api/attendance/check-out/undo   유예(5분) 경과 시 409 → 보정 경로 안내
GET   /api/attendance/team-alerts      lead 미만 403
GET   /api/announcements?limit=        권한 밖 등급 글은 목록에서 제외

GET   /api/documents?q=                목록·검색
POST  /api/documents                   생성
GET   /api/documents/:id               메타 (+ seedHtml, 아래 참조)
PATCH /api/documents/:id               제목·수정시각 투영
GET   /api/documents/recent?limit=
GET   /api/documents/:id/comments
POST  /api/documents/:id/comments
GET   /api/documents/:id/versions
POST  /api/documents/:id/versions   { snapshot, label? }
```

## 문서 본문은 서버에 없다

본문의 원천은 **Y.Doc**이다. 서버(MSW)는 목록·검색이 볼 제목과 수정시각, 그리고
버전 스냅샷만 투영해 들고 있다. 실제 백엔드도 같은 모양이 된다 — Yjs 업데이트를
보관하고 제목만 별도로 둔다.

> MSW 저장소는 메모리에만 있다. **새로고침하면 버전 기록·댓글이 초기화된다.**
> 문서 본문은 IndexedDB와 개발 서버에 있으므로 그대로 남는다.

지금 동기화 경로는 이렇다.

```
Y.Doc ──┬─ WebSocket              다른 사람 · 다른 브라우저 · 다른 PC
        ├─ BroadcastChannel       같은 브라우저의 다른 탭 (y-websocket 내장)
        └─ IndexeddbPersistence   오프라인 영속
```

### 실행 — 터미널 두 개가 필요하다

```bash
npm run dev      # 앱
npm run server   # 공동편집·채팅 서버 (http://localhost:1234)
```

**서버를 안 켜면 다른 브라우저·다른 PC와 동기화되지 않는다.** 같은 브라우저의
탭끼리는 BroadcastChannel로 붙으므로 서버 없이도 되는 것처럼 보이는데, 이게 착시다.
그래서 에디터 헤더에 연결 상태를 항상 띄운다 — 서버가 없으면
**"오프라인 편집 중 — 이 브라우저에만 저장됩니다"** 가 뜬다. 편집 자체는 계속되고
IndexedDB에 남는다.

### 공동편집 확인하는 법

서버를 켠 상태에서 같은 문서를 **서로 다른 브라우저**(또는 다른 PC)로 열면 된다.
한쪽에서 타이핑하면 다른 쪽에 즉시 반영되고, 상대 커서와 이름표, 헤더의
"N명 편집 중"이 나타난다.

### 백엔드가 구현해야 할 것

`scripts/collab.js`가 그 명세다. y-websocket 프로토콜(바이너리, 첫 varuint가
메시지 종류 — `0` sync, `1` awareness)이고, 경로 마지막 세그먼트가 문서 ID다.
서버는 문서마다 Y.Doc을 들고 받은 업데이트를 적용·중계한다.

이 개발 서버는 메모리에만 보관한다. **실제 백엔드는 Y.Doc 상태를 영속화해야 한다** —
설계상 문서 본문의 원천이 그 상태다.

앱은 개발 서버 포트에 직접 붙지 않는다. 항상 같은 오리진의 `/collab` 으로 붙고 vite가
넘긴다(`vite.config.ts`). 운영에서는 프록시 대상만 실제 백엔드로 바꾸면 앱 코드는 그대로다.

`seedHtml`은 Y.Doc이 비어 있을 때만 한 번 심는 초안이다. 실제 서버에서는 보관 중인
Yjs 초기 상태가 그 자리를 대신하므로 이 필드는 사라진다.

> 되돌리기는 `StarterKit`의 `undoRedo`가 아니라 **Yjs UndoManager**가 담당한다
> (`undoRedo: false`). 그래야 Ctrl+Z가 남의 편집까지 지우지 않고 내 변경만 되돌린다.

## 채팅은 MSW를 쓰지 않는다

MSW는 브라우저 안에서만 도는 목이라, A가 보낸 메시지를 B의 MSW는 알지 못한다.
채팅은 공유 상태를 들고 있는 프로세스가 있어야 성립하므로 **개발 서버가 맡는다**
(`scripts/chat.js`).

URL은 다른 API와 같은 `/api/chat/*` 을 쓴다. MSW는 이 경로만 통과시키고
(`handlers.ts`의 `passthrough()`), vite가 개발 서버로 넘긴다. 백엔드가 같은 경로로
응답하면 MSW를 끄는 것만으로 전환된다.

```
GET   /api/chat/channels                  사용자별 목록 (안읽음·마지막 메시지)
GET   /api/chat/channels/:id/messages     최근 메시지
POST  /api/chat/channels/:id/messages     전송 → 구독자에게 WS 브로드캐스트
POST  /api/chat/channels/:id/read         읽음 처리
WS    /api/chat/ws                        message · typing · read 이벤트
```

전송은 REST로 하고 **화면 반영은 전부 WebSocket이 한다** — 내가 보낸 메시지도
서버를 한 바퀴 돌아 같은 경로로 돌아온다. 낙관적 추가를 하지 않으므로 다른 탭·다른
사람과 순서가 어긋나지 않는다.

> 인증은 개발 편의로 `userId`를 그대로 받는다. 실제 백엔드는 JWT에서 꺼내야 하고,
> 채널 멤버가 아닌 요청은 403이어야 한다. 대화는 메모리에만 있어 서버를 끄면 사라진다.

## 버전 기록과 되돌리기

편집이 5초간 멎으면 스냅샷을 남긴다. 같은 사람이 이어서 편집하는 동안은 서버가
3분 단위로 하나로 접는다 — 접지 않으면 타이핑을 멈출 때마다 버전이 쌓여 기록을
읽을 수 없다. 되돌리기처럼 이유가 분명한 버전에는 라벨이 붙고, 라벨이 붙으면 접히지 않는다.

**Yjs 스냅샷은 내용 사본이 아니라 시점 표식이다.** 실제 내용은 Y.Doc이 들고 있는
이력에서 되살린다. 그래서 서버가 보관하는 스냅샷은 작지만, 대신 두 가지가 전제된다.

- **`gc: false`** — 클라이언트(`useCollabSession.ts`)와 서버(`scripts/collab.js`)
  **양쪽 모두**. 한쪽이라도 삭제 내용을 수거하면 과거 버전을 복원할 수 없다.
  대신 문서가 계속 커진다. 15명 규모 위키에서는 감수할 만한 비용으로 봤다.
- 복원은 **클라이언트에서** 한다. 서버는 스냅샷만 들고 있고 이력은 Y.Doc에 있다.

### 되돌리기는 되감기가 아니다

Y.Doc을 과거 상태로 갈아끼우면, 접속 중인 다른 사람의 상태와 병합되면서 되돌리기가
도로 취소된다. 그래서 스냅샷 시점의 내용을 ProseMirror JSON으로 꺼내
`editor.commands.setContent()` 로 **앞으로 나아가는 편집 한 번**으로 넣는다.

이러면 모두가 같은 결과로 수렴하고, 되돌리기 자체도 Ctrl+Z로 취소할 수 있으며,
되돌리기 전 버전도 기록에 그대로 남아 다시 앞으로 갈 수 있다.
