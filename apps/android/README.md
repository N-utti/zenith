# 안드로이드 셸 (.apk)

제니스 서버 주소를 그대로 여는 웹 화면(WebView) 한 장이다. 화면은 서버가 내주므로 프론트를 고쳐도
APK 를 다시 줄 필요가 없다. 다시 줘야 하는 건 이 폴더(앱 쪽)를 고쳤을 때와 서버 주소가 바뀌었을 때뿐이다.

웹 화면이 브라우저와 다르게 하는 것 중 아래만 앱이 받아 준다.

- 파일 고르기(첨부): 파일 칸의 형식이 전부 MIME 으로 풀릴 때만 거르고, 아니면 모든 파일을 보여 준다.
- 내려받기: 프론트의 `downloadBytes`(`frontend/src/lib/download.ts`)를 가로채 다운로드 폴더에 저장한다.
  내려받는 방식을 바꾸면 `MainActivity.java` 의 가로채기 스크립트도 같이 본다.
- 인쇄: 문서 PDF 내보내기(`window.print`)를 안드로이드 인쇄 창으로 넘긴다. 거기서 「PDF로 저장」을 고른다.
- 서버에 못 닿으면 한국어 안내와 다시 시도 버튼을 띄우고, 앱으로 돌아올 때 다시 붙어 본다.

브라우저 알림(Notification API)은 웹 화면에 없다. 앱을 켜 둔 동안의 화면 안 알림만 뜬다.
실기기 없이 에뮬레이터(Android 14)로 위 동작을 확인했다(2026-11-06).

## 빌드

Gradle 없이 SDK 빌드 도구만 쓴다. 윈도우 Git Bash 에서 확인했다. 필요한 것은 JDK 17 과 Android SDK 의 `platforms;android-35`·`build-tools;35.0.0`.
`~/android-tools/` 아래(`jdk-17*`, `sdk/`)에 있으면 그대로 찾고, 다른 곳이면 `JAVA_HOME`·`ANDROID_HOME` 을 넘긴다.

```bash
ZENITH_URL=https://<서버 주소> ./build.sh   # → build/zenith.apk
```

- 서버 주소는 https 만 받는다(로그인 쿠키가 Secure).
- **서명 키**는 레포 밖 `~/.zenith/android.jks`(비밀번호 `~/.zenith/android.pass`)에 있고, 없으면 첫 빌드 때 만든다.
  잃으면 이미 깔린 앱 위에 새 판을 덮어 설치할 수 없다(지우고 다시 깔아야 한다). 백업해 둔다.
- 다시 줄 때는 `build.sh` 의 `VERSION_CODE` 를 1 올린다. 같거나 낮으면 폰이 덮어 설치를 거절한다.

## 설치

APK 파일을 폰에 보내 열고, 「출처를 알 수 없는 앱」 설치를 한 번 허용한다.
서버가 테일넷에 있으면 폰에도 Tailscale 앱을 깔고 같은 테일넷에 들어와 있어야 한다.
