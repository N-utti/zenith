# frontend

Zenith 웹 프론트엔드. React 19 · Vite · TypeScript · Tailwind v4.

백엔드(`../backend`)가 아직 없으므로 개발 중에는 **MSW**가 `/api/*`를 가로채 목 응답을 준다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173. 실시간 서버(:1234)도 같이 뜬다
```

| 스크립트 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 (MSW 켜짐) + 실시간 서버. 둘을 각각 자식 프로세스로 띄운다(`scripts/dev.js`) |
| `npm run server` | 실시간 서버만 따로. 문서 공동편집 + 채팅. `npm run dev` 가 이미 띄우므로 재시작할 때만 쓴다 |
| `npm run build` | 타입체크 + 프로덕션 빌드 (`dist/`) |
| `npm run typecheck` | 타입만 검사 |
| `npm run lint` | ESLint |
| `npm run preview` | 빌드 결과 미리보기 |

### 목 계정

비밀번호는 모두 `zenith1234`. 로그인 화면 하단 버튼으로 바로 채울 수 있다.

| 이메일 | 역할 |
| --- | --- |
| `sungwoon@zenith.co.kr` | member (사원) · 정성운 |
| `chulsung@zenith.co.kr` | exec (임원) · 김철성 대표 |

조직도에 팀장 직급이 없어 lead 계정은 없다. 전체 13명(팀 5개 + 임원 5명)은 `src/mocks/users.json` 에 있다. 개발 채팅 서버도 같은 파일을 읽는다.

역할 체계는 [근태 모듈 설계서 §3](https://app.notion.com/p/3aea471660468172aea1c46d2b11addf)을 따른다.

### 실제 백엔드에 붙이기

```bash
VITE_DISABLE_MSW=true npm run dev
```

MSW가 꺼지고 `/api` 요청이 vite 프록시를 통해 `http://localhost:8000`(FastAPI)으로 간다.
8000 이 다른 프로세스에 잡혀 있으면 `.env.local` 에 `VITE_API_TARGET=http://localhost:8010` 처럼 적는다.
백엔드 쪽 준비(DB·마이그레이션·시드)는 [`backend/README.md`](../backend/README.md).

### 인증은 쿠키다

[04 · API 명세서 §1](https://app.notion.com/p/3aaa4716604681a6bba4e0367463e8eb) 그대로다.
로그인은 `POST /api/auth/login` → `204 + Set-Cookie`, 프로필은 `GET /api/me`.
브라우저는 토큰을 갖지 않는다. `access`(15분)·`refresh`(14일)는 HttpOnly 쿠키라 JS 가 읽을 수 없고,
`csrf` 하나만 읽어 상태 변경 요청에 `X-CSRF-Token` 헤더로 되돌려 보낸다(11 §4.3).

- `AuthProvider` 는 마운트 때 **항상** `GET /me` 를 부른다. 200 이면 로그인, 401 이면 익명. 로그인 여부의 판정자는 서버뿐이다.
- `lib/api.ts` 가 `credentials: 'include'` · CSRF 헤더 · **access 만료(`AUTH_EXPIRED`) 시 refresh 후 1회 재시도**를 맡는다. 화면 코드는 신경 쓰지 않는다. 이 규약은 `src/lib/api.test.ts`(`npm test`, vitest)가 고정한다.
- 로그아웃은 서버가 세션을 회수한다. 15분이 남은 access 도 그 즉시 죽는다.
- MSW 모드에서는 `zenith.mock.session=<userId>` 쿠키가 세션을 흉내 낸다. 개발 채팅 서버도 이 쿠키로 사용자를 알아본다.

## 구조

```
src/
├─ app/           라우트 정의(routes.tsx) · 사이드바 메뉴 정의(navigation.ts)
├─ components/
│  ├─ layout/     AppLayout · Sidebar · Header · UserMenu
│  ├─ ui/         Button · Avatar · Badge · Spinner · PageHeader · PlaceholderPanel
│  └─ CommandPalette.tsx   ⌘K 팔레트 (현재는 화면 이동만)
├─ features/
│  ├─ auth/       AuthProvider · AuthContext · RequireAuth · LoginPage
│  ├─ chat/       채널 목록 · 메시지 · 입력창 · 실시간 소켓
│  ├─ docs/       TipTap 에디터 · Yjs 협업 세션 · 댓글 · 버전 기록
│  └─ home/       홈 대시보드 카드 (공지 · 최근문서 · 안읽은채팅)
├─ lib/           api(fetch 래퍼 · 쿠키 세션 · CSRF) · avatar · queryClient · theme · datetime · cn
├─ mocks/         MSW 핸들러 · 목 사용자 · 공지·문서 목 데이터
├─ pages/         화면별 컴포넌트
├─ styles/        index.css. 디자인 토큰
└─ types/         Role · User 등 공용 타입

scripts/            개발 서버 (백엔드 대역)
├─ dev-server.js    HTTP + WebSocket 업그레이드 라우팅
├─ collab.js        문서 공동편집 (Yjs)
└─ chat.js          채팅 REST + WebSocket
```

## 규칙

**API 호출은 반드시 `lib/api.ts`의 `api()`를 거친다.** 쿠키 전송·CSRF 헤더·만료 시 갱신·
에러 정규화(`ApiError`)가 여기 한 곳에 있다. 컴포넌트에서 `fetch`를 직접 부르지 않는다.

**색은 시맨틱 토큰만 쓴다.** `bg-surface`, `text-muted`, `border-line`, `text-accent` 처럼
의미 단위 토큰을 쓰고 `bg-brand-600`, `text-slate-500` 같은 원시값은 쓰지 않는다.
토큰 정의는 `src/styles/index.css`. 라이트/다크 두 벌이 여기서 함께 관리된다.

**폰트 CDN 금지.** 데이터·요청이 사내망을 벗어나면 안 된다(README 성공 기준: 외부 API 호출 0건).
Pretendard가 필요하면 self-host 후 `--font-sans` 스택 맨 앞에 넣는다.

**메뉴는 `src/app/navigation.ts` 한 곳에서 정의한다.** 사이드바와 ⌘K 팔레트가 같은 배열을 읽는다.
`minRole`로 메뉴를 숨길 수 있지만 이는 UI 편의일 뿐이고, 실제 차단은 서버 권한 검사가 한다.

**날짜·시간 표기는 `lib/datetime.ts`를 쓴다.** 표기 규칙을 한 곳에 모아 목록·에디터·리포트가
같은 형식을 쓰게 한다.

## 구현 상태

| 화면 | 상태 |
| --- | --- |
| 홈 대시보드 | 공지·최근문서·안읽은채팅 |
| 문서 | 목록·검색·생성, TipTap 에디터, Yjs 실시간 공동편집, 댓글, 버전 기록·되돌리기, 휴지통(`/docs/trash`: 되돌리기·영구 삭제(임원)) |
| 채팅 | 채널·DM, 실시간 송수신, 안읽음, 타이핑 표시 |
| AI | 어시스턴트(`/ai`): 04 §8 `/ai/chat` SSE 스트리밍 · 모델 표시 · 지식 소스 · 근거 패널 · 도움돼요(`/ai/feedback`) · ⌘K 팔레트의 "AI에게 물어보기". 문서 인라인 AI 팝오버(`/ai/doc-action`). "표로 정리" 초안은 표 미리보기로 보이고 삽입하면 실제 표 블록이 된다(`@tiptap/extension-table`). 근거(citations)는 백엔드 RAG 전까지 목에서만 보인다. "문서로 저장"은 빈 문서를 만들고 초안을 라우터 state 로 실어 편집기가 Y.Doc 에 심는다(근거 인용문은 싣지 않는다) |
| 게시판(`/board/:id`) | 사이드바가 게시판을 나열하고 화면 하나로 본다(05 SCR-05). 목록·상세·글쓰기·수정·삭제를 `GET /boards` · `/boards/{id}/posts` · `/posts/{id}` 로 붙였다. 권한 밖 글은 서버가 준 마스킹을 그대로 그리고(제목 가림·작성자 없음, TC-BRD-01), 본문 403 은 다시 시도하지 않는다 |
| 근태(`/attendance`) | 탭은 URL 에 둔다(`?tab=`). 사원은 셋 — **내 근태**(월 달력·기간 집계)·**휴가**(신청·취소·잔여 연차)·**예외 근무**(신청). 임원은 넷을 더 본다 — **전사 근태**·**연차 관리**·**근태 관리**(월 마감·재오픈·리포트)·**근태 설정**(회사 휴일). 정정 요청은 달력에서 모달로 연다. 백엔드가 501 스텁이라 아직 MSW 목으로만 돈다 |
| 전자결재(`/approvals`) | 결재함 넷(받은·올린·참조·임시), 기안 작성(`/approvals/new`), 상세는 결재선 타임라인·승인·반려·회수·강제 종결(임원)·위임. 계약이 없어 프론트가 정한 모양은 아래 "계약에 없어서 프론트가 정한 것". 백엔드가 501 스텁이라 아직 MSW 목으로만 돈다 |
| 관리자(`/admin`) | 탭 둘. **계정 관리**: 목록·생성·등급 변경·비활성화·임시 비밀번호. **감사 기록**: 종류별 거르기(앞글자 일치)와 커서 페이징, 기록마다 우리말 요약. 목은 계정을 만들거나 고칠 때 감사 줄도 같이 쌓는다(실제 서버와 같게). 임원만 보인다. **팀 배정**: 계정을 만들거나 고칠 때 소속 팀을 셀렉트로 고른다(`GET /admin/teams` #117 로 목록, 계정 수정의 `team_id` 로 저장). 팀 자체를 만들고 이름을 바꾸는 화면은 아직 없다: 계약(#124, 임원 전용)은 있고 프론트가 안 붙였다 |

## 백엔드에 요청한 것

PR 본문에 흩어져 있던 것을 한곳에 모았다. 위는 **없어서 못 하는 것**, 아래는 **계약에 없어서
프론트가 모양을 정한 것**이다. 백엔드가 다르게 정하면 프론트를 고친다.

### 없어서 못 하는 것

없다. 마지막까지 남아 있던 멘션 알림의 DM 표시는 백엔드가 답을 줬다(#116, #150). 공개 채널은
채널 이름을 `channel_name` 에 채우고 DM 은 `null` 로 둔다 — 요청했던 모양 그대로다. 다만 #150
이전(09-18~21)에 쌓인 DM 알림 행에는 보낸 사람 이름이 들어 있어, `features/notifications/view.ts`
가 이름이 보낸 사람과 같은 경우도 DM 으로 처리한다. 그 행들이 다 읽히면 걷어낼 수 있다.

### 계약에 없어서 프론트가 정한 것

결재·근태 모듈과 AI 일부는 백엔드가 **경로만 스텁으로** 두고 있어 요청·응답 스키마가 없다.
아래는 프론트가 정하고 PR 본문에 적어 둔 것이다. 구현할 때 이 목록을 보면 된다.

- **결재**(#108·#110·#111): 종결 상태 이름 `closed` · 강제 종결에 `version` 을 안 보냄 · 종결 사유를
  걸려 있던 단계에 기록 · 기안 요청의 `references: [사람 id]` · 참조 단계의 상태 · 응답의
  `can_decide`(서버가 판정) · 위임 자원과 규칙 전체(자기 자신 422, 거꾸로 된 기간 422, 위임 불가
  유형 422, 겹침 409, 남의 위임 해제 404, 생성 201·해제 204) · "모든 유형" 위임이 그 기간을 독점
- **근태**(#112·#114): `GET /attendance/me/summary` 응답 `{from, to, summary}`(일자 배열 없음) ·
  기간 상한 366일 · 달력 재생성 응답 `{year, workdays}`
- **AI**(#113): `POST /ai/template` 의 `blocks[]` 한 칸이 **마크다운 한 덩이** · `context` 는 안 보냄
- 그 밖의 프론트 확장은 각 경로 옆에 적어 뒀다(`/api/docs?q=`, `?year=`,
  `DELETE /admin/holidays/{date}`, `/leaves/balances`, `scope=all` 등).

### 출퇴근 기록 구현은 삭제됐다

[근태 모듈 설계서 v0.3](https://app.notion.com/p/3aea471660468172aea1c46d2b11addf)에서 **출퇴근 시각을 기록하지 않기로**
결정했다(출입문 단말 미연동, 앱 출퇴근 버튼 없음, 전 직원 주 5일 09~18시 고정 근무 전제).
근태는 휴가·연차와 예외 근무(재택·외근·출장·연장) 신청·승인만 다루는 모듈이 된다.

v0.2 전제로 만들어진 구현을 전부 걷어냈다. `features/attendance/`(출퇴근 위젯 · API · 타입),
팀 주 52시간 경보 카드(`TeamAlertsCard`), `lib/useNow.ts`, MSW 근태 핸들러와 목 데이터.
근태 화면(`/attendance`)은 v0.3 기준 자리표시자로 남아 있고, 사이드바 메뉴도 그대로다.

되살릴 일이 있다면 삭제 직전 커밋(`c4ed480`)에 있다. 다만 경보 카드는 근무시간 실측에 기대는
화면이라 그대로 복구하면 안 된다. 설계서 §5.3의 **승인된 연장근로 신고분 집계**로 다시
만들어야 하고, 화면에 "신고 기준" 라벨을 병기해야 한다(실측처럼 보이면 안 된다).

목 엔드포인트. 백엔드는 같은 스키마로 응답하면 된다. 근태 API는 설계서 §9로 재정의됐고
아직 목이 없다.

> 문서 목록·트리·폴더·댓글은 필드 표기까지 계약에 맞췄다(snake_case, `author`·`updated_by` 객체). 아직 남은 어긋남:
>
> - **문서 상세**: `seedHtml` 은 목 전용이다. 백엔드는 그 자리에 `ydoc`(서버 보관 Yjs 상태)을 준다
> - **댓글 멘션**: 필드 표기는 맞췄지만, 서버가 댓글 본문의 @이름으로 만드는 알림을 목은 만들지 않는다. 목의 알림은 고정 씨앗이라 어느 경로도 알림을 새로 만들지 않는다

```
GET   /api/me/home                     대시보드 1콜 { recent_docs, mentions, unread, posts, todos }
                                       `unread[].peer_id` 로 DM 아바타 색을 채팅 목록과 맞춘다(채널은 `null`)
                                       공지는 게시판에서, 멘션은 알림에서, 할 일은 할 일 저장소에서 온다
                                       안 읽은 대화만 개발 릴레이에 물어본다(목은 채팅 상태를 모른다)

GET   /api/me/todos                    오늘 할 일. 만든 순(완료 여부는 정렬에 안 들어간다)
POST  /api/me/todos                    { text } 추가
PATCH /api/me/todos/:id                { text?, done? } 수정. null 은 422
DELETE /api/me/todos/:id               삭제, 204

GET   /api/me/notifications?unread=1   알림함. 권한 밖 글 알림은 제목을 가려서 내려간다
POST  /api/me/notifications/read       { ids[] } 읽음 처리, 204

GET   /api/search?q=&types=&limit=     ⌘K 통합검색. 배열 그대로 돌려준다({items} 아님)
                                       권한 밖은 마스킹이 아니라 결과에서 빠진다
                                       스니펫은 `**…**` 마커가 든 평문이고 <>& 가 이스케이프돼 온다

GET   /api/tree                        사이드바 트리 { folders[], docs[] }
POST  /api/folders                     { title, parent_id?, sort? }
PATCH /api/folders/:id                 이름·이동·정렬 (프론트는 아직 이름만 쓴다)

GET   /api/docs?q=                     제목 필터 (04 에 없다. 본문 검색은 /api/search)
GET   /api/trash?limit=                휴지통 목록. 트리의 여집합, 지운 지 최근 순
                                       지운 사람은 `updated_by` 로 온다(따로 주는 칸이 없다)
POST  /api/docs                        { folder_id, title } 생성
DELETE /api/docs/:id                   휴지통으로(30일). ?hard=1 은 임원만, 버전·댓글까지 삭제
POST  /api/docs/:id/untrash            휴지통에서 되돌리기
GET   /api/docs/:id                    메타 (+ seedHtml, 아래 참조)
PATCH /api/docs/:id                    제목·수정시각 투영
GET   /api/docs/:id/comments
POST  /api/docs/:id/comments
GET   /api/docs/:id/versions        목록에 스냅샷은 없다. 내용은 /restore 로 한 건씩
POST  /api/docs/:id/versions        { snapshot, label? } → 스냅샷까지 실린 버전
POST  /api/docs/:id/restore         { version_id } → 그 버전의 스냅샷. 서버는 되돌리지 않는다
```

### 검색의 목 한계

- **채팅은 목에서 검색되지 않는다.** 메시지가 MSW 가 아니라 개발 릴레이(`scripts/chat.js`)의
  다른 프로세스에 있다. 실제 백엔드에 붙으면 그때 함께 나온다.
- **채팅 결과의 `?m={메시지}` 를 받는 화면이 아직 없다.** 백엔드가 갈 곳을
  `/chat/{채널}?m={메시지}` 로 주는데 `ChatPage` 가 그 값을 읽지 않아, 붙어도 채널까지만 가고
  그 메시지로 스크롤되지는 않는다.
- **일치도 랭킹이 없다.** 실제 서버는 전문검색 점수와 최근성을 더해 매긴다. 목은 부분 문자열
  일치라 점수가 없어 최근순으로만 준다. 그래서 목에서는 "로드맵 목표" 처럼 두 단어를 치면
  0건이지만 실제 서버는 토큰마다 접두 매칭 후 AND 라 결과가 나온다.

## 문서 본문은 서버에 없다

본문의 원천은 **Y.Doc**이다. 서버(MSW)는 목록·검색이 볼 제목과 수정시각, 그리고
버전 스냅샷만 투영해 들고 있다. 실제 백엔드도 같은 모양이 된다. Yjs 업데이트를
보관하고 제목만 별도로 둔다.

> MSW 저장소는 메모리에만 있다. **새로고침하면 버전 기록·댓글이 초기화된다.**
> 문서 본문은 IndexedDB와 개발 서버에 있으므로 그대로 남는다.

지금 동기화 경로는 이렇다.

```
Y.Doc ──┬─ WebSocket              다른 사람 · 다른 브라우저 · 다른 PC
        ├─ BroadcastChannel       같은 브라우저의 다른 탭 (y-websocket 내장)
        └─ IndexeddbPersistence   오프라인 영속
```

### 실행

```bash
npm run dev      # 앱(:5173) + 공동편집·채팅 서버(:1234)
```

**서버가 없으면 다른 브라우저·다른 PC와 동기화되지 않는다.** 같은 브라우저의
탭끼리는 BroadcastChannel로 붙으므로 서버 없이도 되는 것처럼 보이는데, 이게 착시다.
그래서 에디터 헤더에 연결 상태를 항상 띄운다. 서버가 없으면
**"오프라인 편집 중. 이 브라우저에만 저장됩니다"** 가 뜬다. 편집 자체는 계속되고
IndexedDB에 남는다.

### 공동편집 확인하는 법

서버를 켠 상태에서 같은 문서를 **서로 다른 브라우저**(또는 다른 PC)로 열면 된다.
한쪽에서 타이핑하면 다른 쪽에 즉시 반영되고, 상대 커서와 이름표, 헤더의
"N명 편집 중"이 나타난다.

### 백엔드가 구현해야 할 것

`scripts/collab.js`가 그 명세다. y-websocket 프로토콜(바이너리, 첫 varuint가
메시지 종류. `0` sync, `1` awareness)이고, 경로 마지막 세그먼트가 문서 ID다.
서버는 문서마다 Y.Doc을 들고 받은 업데이트를 적용·중계한다.

이 개발 서버는 메모리에만 보관한다. **실제 백엔드는 Y.Doc 상태를 영속화해야 한다**.
설계상 문서 본문의 원천이 그 상태다.

앱은 개발 서버 포트에 직접 붙지 않는다. 항상 같은 오리진의 `/api/yjs/{docId}` 로 붙는다.
백엔드 릴레이의 경로 그대로다(04 §4.2, 쿠키 핸드셰이크 인증). MSW 모드에서만 vite 가 이 경로를
개발 릴레이의 `/collab` 으로 넘기고, `VITE_DISABLE_MSW=true` 면 백엔드로 간다(`vite.config.ts`).

`seedHtml`은 Y.Doc이 비어 있을 때만 한 번 심는 초안이다. 실제 서버에서는 보관 중인
Yjs 초기 상태가 그 자리를 대신하므로 이 필드는 사라진다.

> 되돌리기는 `StarterKit`의 `undoRedo`가 아니라 **Yjs UndoManager**가 담당한다
> (`undoRedo: false`). 그래야 Ctrl+Z가 남의 편집까지 지우지 않고 내 변경만 되돌린다.

## 채팅은 MSW를 쓰지 않는다

MSW는 브라우저 안에서만 도는 목이라, A가 보낸 메시지를 B의 MSW는 알지 못한다.
채팅은 공유 상태를 들고 있는 프로세스가 있어야 성립하므로 **개발 서버가 맡는다**
(`scripts/chat.js`).

URL은 백엔드와 같은 `/api/channels*` · `/api/ws` 를 쓴다. MSW는 아래 네 개만 통과시키고
(`handlers.ts`의 `passthrough()`), vite가 개발 서버로 넘긴다(`/api` 를 `/chat` 으로 바꿔서).
백엔드에 붙일 때는 MSW를 끄는 것만으로 전환된다.

통과시키는 경로는 **개발 릴레이가 실제로 여는 것만** 적는다. `/api/channels` 는 프론트가
지어낸 이름이 아니라 백엔드의 네임스페이스라, 아직 안 만든 채널 생성(`POST /api/channels`)이나
첨부(`/api/channels/:id/attachments`)까지 뭉뚱그려 통과시키면 MSW 핸들러가 아예 안 불리고
릴레이의 404로 조용히 떨어진다. 그 둘을 붙일 때는 MSW 핸들러를 새로 만들면 된다.

```
GET   /api/channels                       사용자별 목록 (안읽음·마지막 메시지)
POST  /api/channels                       { name } 공개 채널(전원 멤버) 또는 { dm_user_id } DM
                                          같은 두 사람의 DM 은 하나만. 같은 이름 채널은 409
GET   /api/channels/:id/messages          최근 메시지
POST  /api/channels/:id/messages          전송 (04 에 없다. 백엔드는 WS 의 msg op)
                                          { body, attachments? } 첨부는 먼저 올리고 url 만 싣는다
POST  /api/channels/:id/attachments       multipart `file` → { url, name, size }. 10MB·빈 파일 422
GET   /api/channels/:id/attachments/:fid/:name  내려받기. 멤버만. 이미지는 inline
POST  /api/channels/:id/read              읽음 처리 (04 에 없다. 백엔드는 WS 의 read op)
WS    /api/ws                             message · typing · read 이벤트
```

> 응답 모양(`ChannelOut`·`MessageOut`)은 계약에 맞췄다. 남은 것은 **소켓 이벤트 봉투**
> (`type` → `ev`)와 전송·읽음을 REST 대신 소켓 op 로 옮기는 일이다(backend/README §4.1 (g)).

전송은 REST로 하고 **화면 반영은 전부 WebSocket이 한다**. 내가 보낸 메시지도
서버를 한 바퀴 돌아 같은 경로로 돌아온다. 낙관적 추가를 하지 않으므로 다른 탭·다른
사람과 순서가 어긋나지 않는다.

> 인증은 MSW 로그인이 심는 `zenith.mock.session` 쿠키로 한다. 실제 백엔드가 HttpOnly 쿠키의
> JWT 에서 사용자를 꺼내는 것과 같은 자리다. 채널 멤버가 아닌 요청은 403이어야 한다.
> 대화는 메모리에만 있어 서버를 끄면 사라진다.

## 버전 기록과 되돌리기

편집이 5초간 멎으면 스냅샷을 남긴다. 같은 사람이 이어서 편집하는 동안은 서버가
3분 단위로 하나로 접는다. 접지 않으면 타이핑을 멈출 때마다 버전이 쌓여 기록을
읽을 수 없다. 되돌리기처럼 이유가 분명한 버전에는 라벨이 붙고, 라벨이 붙으면 접히지 않는다.

**Yjs 스냅샷은 내용 사본이 아니라 시점 표식이다.** 실제 내용은 Y.Doc이 들고 있는
이력에서 되살린다. 그래서 서버가 보관하는 스냅샷은 작지만, 대신 두 가지가 전제된다.

- **`gc: false`**. 클라이언트(`useCollabSession.ts`)와 서버(`scripts/collab.js`)
  **양쪽 모두**. 한쪽이라도 삭제 내용을 수거하면 과거 버전을 복원할 수 없다.
  대신 문서가 계속 커진다. 15명 규모 위키에서는 감수할 만한 비용으로 봤다.
- 복원은 **클라이언트에서** 한다. 서버는 스냅샷만 들고 있고 이력은 Y.Doc에 있다.

### 되돌리기는 되감기가 아니다

Y.Doc을 과거 상태로 갈아끼우면, 접속 중인 다른 사람의 상태와 병합되면서 되돌리기가
도로 취소된다. 그래서 스냅샷 시점의 내용을 ProseMirror JSON으로 꺼내
`editor.commands.setContent()` 로 **앞으로 나아가는 편집 한 번**으로 넣는다.

이러면 모두가 같은 결과로 수렴하고, 되돌리기 자체도 Ctrl+Z로 취소할 수 있으며,
되돌리기 전 버전도 기록에 그대로 남아 다시 앞으로 갈 수 있다.
