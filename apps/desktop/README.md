# 🖥 apps/desktop: Windows 데스크탑 앱 (Tauri 2)

`frontend/`의 웹앱을 그대로 감싸는 **셸**이다. 업무 로직은 하나도 여기 없다.
화면은 웹앱, 데이터는 사내 서버. Windows·Android·iOS가 같은 화면을 공유하는 구조라
셸에 기능을 넣으면 셸마다 다시 만들어야 한다. 넣기 전에 웹앱에서 못 하는 일인지 확인할 것.

산출물은 **`.msi`**. 사내 배포용 (성공 기준 참조).

---

## 사전 준비 (한 번만)

| 필요한 것 | 확인 | 없으면 |
| --- | --- | --- |
| **Rust** (MSVC 툴체인) | `rustc --version` | <https://rustup.rs> |
| **Visual Studio Build Tools** + "C++를 사용한 데스크톱 개발" | `where cl` | [Build Tools 설치 관리자](https://visualstudio.microsoft.com/visual-cpp-build-tools/) |
| **WebView2 런타임** | Windows 11에 기본 탑재 | [Evergreen 설치 관리자](https://developer.microsoft.com/microsoft-edge/webview2/) |

설치 후 `npm run tauri -- info` 로 전부 초록인지 확인한다.

```powershell
cd apps/desktop
npm install
```

---

## 개발

```powershell
npm run dev      # = tauri dev
```

`frontend`의 vite 개발 서버(:5173)를 자동으로 띄우고 그 화면을 창에 붙인다.
**MSW 목이 그대로 살아 있으므로 백엔드 없이도 전 화면이 돈다.**

`npm run dev` 가 채팅·Yjs 릴레이(:1234)까지 같이 띄우므로 따로 켤 것은 없다.
릴레이만 재시작하려면 `cd frontend && npm run server`.

> vite 포트는 `strictPort`로 5173에 고정돼 있다. 셸의 `devUrl`이 이 번호를 보고 있어서,
> vite가 5174로 비켜 가면 셸이 빈 창을 띄우기 때문이다.

---

## 배포 빌드

```powershell
npm run build    # = tauri build → src-tauri/target/release/bundle/msi/*.msi
```

`frontend`를 프로덕션 빌드한 뒤 `.msi`로 묶는다.

### ⚠️ 서버 주소를 반드시 지정할 것

프로덕션 빌드에서는 MSW 목이 통째로 사라지고, 셸 화면은 `tauri://localhost`에서 뜬다.
그래서 `/api` 상대경로는 사내 서버가 아니라 **셸 자신에게** 간다. 서버 오리진을 박아야 한다.

`frontend/.env.production` (커밋되지 않는다. `frontend/.env.example` 참고):

```
VITE_SERVER_ORIGIN=https://zenith.example.co.kr
```

설치 후에 서버가 옮겨 갔다면 재빌드 없이도 바꿀 수 있다.
개발자 도구 콘솔에서 `localStorage.setItem('zenith.serverOrigin', 'https://새주소')` 후 재시작.
(빌드 기본값보다 이 값이 우선한다. `frontend/src/lib/serverOrigin.ts`)

그림은 앱 자신과 이 서버 주소에서만 받는다. 셸 정책(`tauri.conf.json` 의 `img-src`)은 서버 주소를 몰라 열려 있고,
웹앱이 켜질 때 지금 붙은 서버 주소로 정책을 하나 더 건다(`frontend/src/lib/desktop.ts` 의 `restrictImageSources`).
문서·채팅에 섞여 든 바깥 그림 주소가 사내망 밖으로 요청을 내지 못하게 하려는 것이다. 웹은 Caddy 헤더가 같은 일을 한다.

> **지금은 붙을 서버가 없다.** `backend/`에 코드가 없어 프로덕션 빌드는 로그인 화면에서
> 멈춘다. 실제로 쓸 수 있는 건 위의 `npm run dev`(MSW 목) 쪽이다.

---

## 자동 업데이트

앱이 켜질 때 웹앱이 셸에 `check_update` 를 부르고, 셸은 `{서버}/desktop/latest.json` 을 본다.
새 버전이면 웹앱이 "지금 설치할까요?" 를 묻는다. 고르면 `install_update` 가 `.msi` 를 받아 서명을 확인하고
설치 프로그램(진행 막대만 보이는 passive 모드)을 띄운다. 앱은 닫혔다가 설치가 끝나면 다시 뜬다.
거절하면 지금 버전으로 계속 쓰고, 다음에 켤 때 다시 묻는다. 서버 주소를 모르는 개발 모드에서는 건너뛴다.

- **서명키**: 업데이트 설치본은 Tauri 서명키(minisign)로 검증한다. 공개키는 `tauri.conf.json` 의
  `plugins.updater.pubkey`, 개인키는 빌드 PC 의 `~/.tauri/zenith-updater.key`(레포 밖, 비밀번호 없음).
  **개인키를 잃으면 이미 설치된 앱에 업데이트를 보낼 수 없다.** 전 직원이 `.msi` 를 손으로 다시 깔아야 한다. 백업해 둘 것.
- **TLS**: 셸은 Windows 인증서 저장소를 믿는다(`native-tls`). Caddy 루트를 PC 에 넣었으면 그대로 된다.
- **UAC**: `.msi` 는 컴퓨터 전체 설치(`C:\Program Files`)라 업데이트 때 관리자 확인 창이 뜬다. 관리자 권한이 없는 사람은
  설치를 고르면 앱이 꺼진 채로 남는다(다시 켜면 옛 버전으로 뜬다). 그래서 묻고 설치한다. 그런 PC 는 IT 가 `.msi` 를 깐다.
- **되돌리기 차단**: 매니페스트의 버전 번호는 서명 대상이 아니다. 예전 `.msi` 를 새 버전인 척 내밀어도
  `bundle.windows.allowDowngrades: false` 라 설치가 거부된다.

### 릴리스 절차

```powershell
# 1) tauri.conf.json 의 version 을 올린다. 같은 버전이면 업데이트가 안 간다
# 2) 서명해서 빌드
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$HOME\.tauri\zenith-updater.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run build
# 3) 매니페스트
npm run manifest -- https://zenith.example.co.kr
```

`src-tauri/target/release/bundle/msi/` 의 `.msi` 와 `latest.json` 을 서버의 `/desktop/` 에 올린다(Caddy 가 내주는 경로).
매니페스트의 `.msi` 주소는 만들 때 준 서버 주소로 박힌다. 서버를 옮기면 매니페스트를 다시 만든다.
개인키 없이 `npm run build` 하면 서명 단계에서 실패한다. 배포본은 전부 서명돼야 하므로 의도한 것이다.

---

## 구성

```
apps/desktop/
├─ package.json          Tauri CLI · dev/build 스크립트
├─ scripts/manifest.mjs  업데이트 매니페스트(latest.json) 생성
├─ app-icon.png          아이콘 원본 1024² (바꾸면 npm run icons)
└─ src-tauri/
   ├─ tauri.conf.json    창 크기 · CSP · 번들(.msi) 설정
   ├─ Cargo.toml
   ├─ capabilities/      셸이 웹앱에 허용하는 권한. 파일시스템·셸 실행은 닫혀 있다.
   ├─ icons/             생성물 (Windows/macOS/Android/iOS 전 사이즈)
   └─ src/{main,lib}.rs  창을 띄우고 켤 때 업데이트를 확인하는 것 외에 하는 일이 없다
```

### 프론트엔드 쪽 짝

| 파일 | 역할 |
| --- | --- |
| `frontend/src/lib/serverOrigin.ts` | REST·WebSocket·이미지 URL 앞에 서버 오리진을 붙인다 |
| `frontend/src/lib/desktop.ts` | 바깥 링크를 기본 브라우저로 넘긴다 · OS 알림(`notify`) · 켤 때 업데이트 확인(`checkForUpdate`) · 그림 출처를 붙은 서버로 좁힌다(`restrictImageSources`) |
| `frontend/src/features/chat/ChatSocketProvider.tsx` | 채팅 소켓을 로그인 구역 전체에서 하나만 연결 |

모두 브라우저에서는 아무 일도 하지 않는다. 웹앱은 Tauri npm 패키지에 의존하지 않고,
셸이 노출하는 `window.__TAURI__` 전역만 본다.

---

## 알림 (Windows 토스트)

새 채팅이 오면 토스트를 띄운다. 조건은 두 가지다.

- 내가 보낸 메시지가 아닐 것
- **창을 보고 있지 않을 것** (`document.hasFocus()`). 화면에 이미 보이는데 토스트까지 겹치면 방해다

제목은 `#개발 · 박동현`, DM이면 상대 이름만. 구현은 `useChatSocket.ts`의 `notifyIncoming`이다.

### ⚠️ 개발 모드에서는 토스트가 불안정하다

Windows 토스트는 발신 앱이 **AppUserModelID(AUMID)** 로 등록돼 있어야 한다. 등록은 시작 메뉴
바로가기가 나른다.

`.msi`로 설치하면 `Zenith.lnk`가 AUMID `kr.zenith.desktop`을 달고 만들어진다. 그런데
`tauri dev`로 띄우면 알림 플러그인이 `zenith-desktop.lnk`를 따로 만들면서 **AUMID 자리에
디버그 exe의 전체 경로를 넣는다.** 그건 유효한 AUMID가 아니라서 토스트가 엉뚱한 이름으로
뜨거나 아예 표시되지 않는다.

> 2026-09-01 실측 (`Shell.Application`으로 바로가기 속성을 직접 읽음)
>
> | 바로가기 | AUMID |
> | --- | --- |
> | `…\Start Menu\Programs\Zenith\Zenith.lnk` (설치본) | `kr.zenith.desktop` |
> | `…\Start Menu\Programs\zenith-desktop.lnk` (dev가 생성) | `C:\…\target\debug\zenith-desktop.exe` |
>
> dev에서는 첫 토스트만 내용이 정확한 채로 "Windows PowerShell" 이름으로 떴고 이후 3회는
> 표시되지 않았다. 설치본 AUMID로 토스트를 직접 쏘면 발신 앱이 "Zenith", 아이콘도 제니스
> 마크로 정상 표시된다. `HKCU\Software\Classes\AppUserModelId\…`를 손으로 등록하는 것은
> 소용없다. 바로가기가 나르는 값이 이기기 때문이다.

**알림을 검증하려면 `.msi`를 설치한 뒤 테스트할 것.** 개발 중에는 알림 로직 자체
(조건 판정·제목·본문)를 화면 안 배지로 확인하는 편이 빠르다.

dev 실행이 남긴 `zenith-desktop.lnk`는 시작 메뉴에 계속 남는다. 지우려면:

```powershell
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\zenith-desktop.lnk"
```

### 알림 테스트 방법

앱과 릴레이(`npm run dev` 가 함께 띄운다)가 떠 있는 상태에서, 로그인한 사람과
**다른 사용자**로 메시지를 밀어넣는다.

```powershell
$body = [Text.Encoding]::UTF8.GetBytes('{"userId":"u-2","body":"테스트"}')
Invoke-RestMethod "http://localhost:1234/chat/channels/c-dev/messages" -Method Post `
  -ContentType "application/json; charset=utf-8" -Body $body
```

채널은 `c-dev`·`c-notice`·`c-random`·`dm-u1-u2`. 창을 최소화한 뒤 보내야 토스트 조건이 맞는다.

---

## 아이콘 교체

`app-icon.png`(1024×1024, 여백 포함)를 갈아 끼우고:

```powershell
npm run icons
```

---

## 아직 안 한 것

- **코드 서명**(Authenticode). 서명 없는 `.msi`는 처음 설치할 때 "알 수 없는 게시자" 경고가 뜬다.
  2026-09-23 보류했다: 업데이트는 위의 Tauri 서명키로 검증하고 SmartScreen 을 거치지 않아서, 막아 주는 것이
  첫 설치 경고뿐이다. 인증서(자체 서명 + 사내 PC 신뢰 배포, 또는 상용)가 정해지면
  `bundle.windows.certificateThumbprint` 를 채운다.
- **딥링크·트레이 아이콘·작업표시줄 배지**. 요구사항 확정 전.
- **알림 범위**. 채팅뿐이다. 멘션·댓글·결재 알림은 `받은 알림`(M2) 설계가 정해진 뒤에 붙인다.
  알림 클릭 시 해당 채널로 이동하는 것도 아직 없다.
