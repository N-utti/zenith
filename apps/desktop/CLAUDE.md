# apps/desktop: 작업 규칙

> 공통 규칙은 루트 [CLAUDE.md](../../CLAUDE.md), 프론트 규칙은 [frontend/CLAUDE.md](../../frontend/CLAUDE.md). 준비·빌드·알림 실측은 [README.md](README.md).

## 원칙

- **셸이다. 업무 로직을 넣지 않는다.** Windows·Android·iOS 가 같은 웹앱을 공유하므로 셸에 넣은 기능은 셸마다 다시 만들어야 한다. 넣기 전에 웹앱에서 못 하는 일인지 확인한다(OS 알림·외부 링크 열기 정도).
- 웹앱은 Tauri npm 패키지에 의존하지 않는다. `window.__TAURI__` 전역만 보고, 브라우저에서는 아무 일도 하지 않는다(`frontend/src/lib/desktop.ts`).
- `capabilities/` 는 최소 권한. 파일시스템·셸 실행은 닫혀 있다. 여는 PR 은 보안민감(루트 §기본 동작).

## 게이트

- CI 는 없다(Rust 툴체인이 무거워 러너에 올리지 않는다). 로컬에서 `cd src-tauri && cargo check` 와 `npm run dev` 로 창이 뜨는지 확인한 뒤 커밋.
- `.msi` 검증이 필요한 변경(알림·AUMID·설치 경로)은 `npm run build` 후 설치본으로 확인한다. dev 모드 토스트는 신뢰할 수 없다(README).
- `tauri.conf.json` 의 `devUrl` 은 vite `strictPort` 5173 과 짝. 한쪽만 바꾸지 않는다.

## 배포 전제

- 프로덕션 빌드는 MSW 가 없고 `tauri://localhost` 에서 뜬다. `frontend/.env.production` 의 `VITE_SERVER_ORIGIN` 이 없으면 `/api` 가 셸 자신에게 간다.
- 셸 정책(`tauri.conf.json` 의 `csp`)의 `img-src` 는 서버 주소를 몰라 열려 있다. 실제로 좁히는 것은 웹앱이 켜질 때 거는 정책(`frontend/src/lib/desktop.ts` 의 `restrictImageSources`)이다. 셸 정책만 보고 판단하지 않는다.
- 교차 오리진 쿠키(11 I6)는 백엔드 `CORS_ORIGINS` 로 열 수 있게만 돼 있고 검증은 M4. 붙일 때 백엔드와 같이 본다.
- 아이콘은 `app-icon.png` 만 원본. `npm run icons` 생성물 중 android/ios 는 추적하지 않는다(`.gitignore`).
