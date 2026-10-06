# frontend: 작업 규칙

> 공통 규칙은 루트 [CLAUDE.md](../CLAUDE.md). 구조·실행·MSW·공동편집 설계는 [README.md](README.md). 여기서는 반복하지 않는다.
> 정본: [05 · 화면정의서](../docs/README.md)(SCR ID) · **12 · UI 청사진**(시각·구조 사양은 05 가 아니라 여기) · 04 · API(계약).

## 게이트 (커밋 전 green)

```sh
npm ci            # main 을 당겨온 직후 한 번. 상대가 넣은 의존성이 없으면 lint 는 통과하고 test·build 만 깨진다
npm run lint
npm test          # vitest. lib/api.test.ts 가 인증 규약을 고정한다
npm run build     # tsc -b + vite build
```

브랜치는 `feat/fe-*` · `fix/fe-*`. `main` 직접 push 는 훅이 막는다. PR 로 (루트 §협업 워크플로).

## 규칙

- **API 호출은 `lib/api.ts` 의 `api()` 만.** SSE(04 §8 `/ai/chat`)는 같은 파일의 `apiEvents()`. 쿠키 전송·CSRF 헤더·`AUTH_EXPIRED` 시 refresh 1회 재시도·`ApiError` 정규화가 여기 한 곳에 있다. 컴포넌트에서 `fetch` 직접 호출 금지.
- **브라우저는 토큰을 갖지 않는다.** `access`·`refresh` 는 HttpOnly 쿠키. 읽는 쿠키는 `csrf` 하나. 로그인 여부의 판정자는 `GET /me` 뿐(`AuthProvider`).
- **401 은 화면에서 처리하지 않는다.** 만료(`AUTH_EXPIRED`)는 `lib/api.ts` 가 refresh 한 번으로 살리고, 그래도 죽은 401 은 `lib/queryClient.ts` 가 프로필을 비워 익명으로 전이시킨다. 화면은 `status === 'anonymous'` 만 보면 된다.
- **누구인지는 URL 이 아니라 쿠키가 말한다.** WebSocket 도 `?userId=` 없이 붙는다. 신원은 핸드셰이크에 실리는 세션 쿠키다.
- **`User` 에 `title`·`avatarHue` 는 없다.** 서버가 안 준다. 아바타 색은 `lib/avatar.ts` 의 `hueOf(id)` 로 만들고, 직함 자리는 등급 라벨이 대신한다. `team` 은 `null` 일 수 있다.
- **색은 시맨틱 토큰만** (`bg-surface`·`text-muted`·`border-line`·`text-accent`). 원시값(`text-slate-500`) 금지. 토큰은 `src/styles/index.css`, 라이트/다크 함께.
- **폰트·스크립트 CDN 금지.** 사내망 밖으로 요청이 나가면 안 된다. self-host.
- **메뉴는 `src/app/navigation.ts` 한 곳.** 사이드바와 ⌘K 가 같은 배열을 읽는다. `minRole` 은 UI 편의, 차단은 서버 403.
- **날짜·시간은 `lib/datetime.ts`.** 화면마다 형식을 만들지 않는다.
- **줄표(—·–)를 쓰지 않는다.** 주석·UI 문구·문서·커밋 본문 모두. 문장은 마침표로 끊고, 라벨 뒤 설명은 콜론(`:`)이나 괄호로 잇는다. 빈 값 표시도 줄표 대신 `-` 나 문구로.
- 서버 오리진이 필요한 URL(REST·WS·이미지)은 `lib/serverOrigin.ts` 를 거친다. 데스크탑 셸이 여기서 갈아 끼운다.
- **`vite.config.ts` 의 `/api` 프록시에 `changeOrigin` 을 붙이지 않는다.** 서버가 `Origin` 과 `Host` 를 대조해 CSRF 를 막는데, `Host` 가 프록시 대상 주소로 바뀌면 브라우저가 보낸 `Origin`(`localhost:5173`)과 어긋나 전 요청이 403 이 된다. 실제 백엔드에 붙였는데 로그인부터 403 이면 여기부터 본다.

## 화면 만들 때

1. 05 의 SCR ID 와 12 의 컴포넌트 인벤토리·상태 규약을 먼저 읽는다. 공용 부품(`components/ui/`)이 있으면 새로 만들지 않는다.
2. 백엔드가 아직 501 인 경로는 **MSW 핸들러**(`src/mocks/`)를 04 의 응답 스키마 그대로 만든다. 백엔드가 붙으면 `VITE_DISABLE_MSW=true` 로 전환만 하면 되게.
3. 채팅은 MSW 를 쓰지 않는다. 개발 릴레이(`scripts/chat.js`). **전송·읽음·타이핑은 소켓 op**(04 §4.1 `msg`·`read`·`typing`), 화면 반영은 전부 소켓 `ev`(낙관적 추가 없음). REST 로 남는 것은 채널 목록·과거 메시지·첨부뿐이다. 전송을 REST 로 되돌리지 말 것: 실서버에 그 경로가 없어 405 가 난다(이슈 #128).
4. 문서 본문의 원천은 Y.Doc. `gc: false` 는 클라이언트·서버 **양쪽** 유지. 되돌리기는 되감기가 아니라 앞으로 가는 편집 한 번(README).
5. 권한 밖 데이터는 목록에서 빼거나 제목을 마스킹하되, 그건 서버가 준 대로 그린 것이어야 한다. 프론트에서 필터링해 숨기지 않는다.

## 계약

- 응답 타입의 기계 판독본은 커밋된 **`backend/openapi.json`** 이다(백엔드 `test_contract.py` 가 최신성을 지킨다). 04 와 어긋나 보이면 이 파일이 실제 서버다. 프론트 타입은 여기서 만든 `src/types/api.gen.ts`(커밋함)를 `Schema<'TeamOut'>` 처럼 끌어 쓴다. 명세가 바뀌면 `npm run gen:api` 로 다시 만들고, 안 그러면 `api.gen.test.ts` 가 빨간불이다. 손수 타입은 openapi 에 없는 것(소켓 이벤트, SSE 의 AI 근거)에만 남긴다. 결재·근태·CRM 은 백엔드보다 먼저 만들어 아직 손수 타입이고, 생성 타입으로 옮길 대상이다. 어긋남을 발견하면 PR 본문에 적어 백엔드에 공유한다.
- 목(MSW)의 에러 응답에도 `code` 를 넣는다. `lib/api.ts` 의 refresh 재시도가 `AUTH_EXPIRED` 라는 `code` 로 갈리므로, `detail` 만 있는 목은 실제 서버와 다르게 동작한다.
- 백엔드가 04 를 넓힌 항목은 `backend/README.md` "설계와 어긋나는 것"에 있다. 목을 만들 때 그쪽을 먼저 본다.
