# 📦 apps: 앱 패키징

`frontend/`의 웹앱 하나를 각 플랫폼 셸로 감싼다. 셸은 화면을 띄우는 일만 하고,
업무 로직은 전부 웹앱에 있다.

| | 셸 | 산출물 | 상태 |
| --- | --- | --- | --- |
| **Windows** | [`desktop/`](desktop/). Tauri 2 | `.msi` | 스캐폴딩 완료. 빌드에 Rust + VS Build Tools 필요 |
| **Android** | [`android/`](android/). 웹 화면(WebView) 한 장 | `.apk` | 2026-11-06 첫 빌드. 실기기 확인 전 |
| **iOS** | 없음. 홈 화면에 추가(웹앱 설정, #502) | | 애플 개발자 계정·맥이 필요해 접었다 |

## 셸에 기능을 넣기 전에

플랫폼이 셋이므로 **셸에 넣은 기능은 셋 다 따로 만들어야 한다.**
웹앱에서 할 수 없는 일인지(네이티브 알림, 파일 연결, 트레이 등) 먼저 확인할 것.

## 공통 규약

- 웹앱은 Tauri·Capacitor npm 패키지에 의존하지 않는다. 셸이 노출하는 전역만 쓰고,
  없으면 아무 일도 하지 않는다 (`frontend/src/lib/desktop.ts`).
- 데스크톱 셸 화면의 오리진은 사내 서버가 아니다. 안드로이드는 서버 주소를 그대로 열어 같은 오리진이다. 서버 주소는 `VITE_SERVER_ORIGIN`으로 주입한다
  (`frontend/src/lib/serverOrigin.ts`, `frontend/.env.example`).
