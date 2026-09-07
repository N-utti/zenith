# frontend — 작업 규칙

> 공통 규칙은 루트 [CLAUDE.md](../CLAUDE.md). 구조·실행·MSW·공동편집 설계는 [README.md](README.md) — 여기서는 반복하지 않는다.
> 정본: [05 · 화면정의서](../docs/README.md)(SCR ID) · **12 · UI 청사진**(시각·구조 사양은 05 가 아니라 여기) · 04 · API(계약).
> 초안은 백엔드가 README 를 옮겨 적었다. 프론트 담당이 다듬는다.

## 게이트 (커밋 전 green)

```sh
npm run lint
npm test          # vitest — lib/api.test.ts 가 인증 규약을 고정한다
npm run build     # tsc -b + vite build
```

## 규칙

- **API 호출은 `lib/api.ts` 의 `api()` 만.** 쿠키 전송·CSRF 헤더·`AUTH_EXPIRED` 시 refresh 1회 재시도·`ApiError` 정규화가 여기 한 곳에 있다. 컴포넌트에서 `fetch` 직접 호출 금지.
- **브라우저는 토큰을 갖지 않는다.** `access`·`refresh` 는 HttpOnly 쿠키. 읽는 쿠키는 `csrf` 하나. 로그인 여부의 판정자는 `GET /me` 뿐(`AuthProvider`).
- **색은 시맨틱 토큰만** (`bg-surface`·`text-muted`·`border-line`·`text-accent`). 원시값(`text-slate-500`) 금지. 토큰은 `src/styles/index.css`, 라이트/다크 함께.
- **폰트·스크립트 CDN 금지.** 사내망 밖으로 요청이 나가면 안 된다. self-host.
- **메뉴는 `src/app/navigation.ts` 한 곳.** 사이드바와 ⌘K 가 같은 배열을 읽는다. `minRole` 은 UI 편의, 차단은 서버 403.
- **날짜·시간은 `lib/datetime.ts`.** 화면마다 형식을 만들지 않는다.
- 서버 오리진이 필요한 URL(REST·WS·이미지)은 `lib/serverOrigin.ts` 를 거친다 — 데스크탑 셸이 여기서 갈아 끼운다.

## 화면 만들 때

1. 05 의 SCR ID 와 12 의 컴포넌트 인벤토리·상태 규약을 먼저 읽는다. 공용 부품(`components/ui/`)이 있으면 새로 만들지 않는다.
2. 백엔드가 아직 501 인 경로는 **MSW 핸들러**(`src/mocks/`)를 04 의 응답 스키마 그대로 만든다. 백엔드가 붙으면 `VITE_DISABLE_MSW=true` 로 전환만 하면 되게.
3. 채팅은 MSW 를 쓰지 않는다 — 개발 릴레이(`scripts/chat.js`). 전송은 REST, 화면 반영은 전부 WS(낙관적 추가 없음).
4. 문서 본문의 원천은 Y.Doc. `gc: false` 는 클라이언트·서버 **양쪽** 유지. 되돌리기는 되감기가 아니라 앞으로 가는 편집 한 번(README).
5. 권한 밖 데이터는 목록에서 빼거나 제목을 마스킹하되, 그건 서버가 준 대로 그린 것이어야 한다. 프론트에서 필터링해 숨기지 않는다.

## 계약

- 응답 타입은 `backend/openapi.json` 기준. 타입 생성(⏳)이 붙기 전까지는 `src/types/` 를 04 와 손으로 맞추고, 어긋남을 발견하면 PR 본문에 적어 백엔드에 공유한다.
- 백엔드가 04 를 넓힌 항목은 `backend/README.md` "설계와 어긋나는 것"에 있다. 목을 만들 때 그쪽을 먼저 본다.
