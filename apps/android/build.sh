#!/usr/bin/env bash
# 제니스 안드로이드 APK 를 만든다. Gradle 없이 SDK 빌드 도구만 쓴다(Java 한 파일이라 그걸로 충분).
#   ZENITH_URL=https://zenith.example.ts.net ./build.sh   →  build/zenith.apk
# 필요한 것: JDK 17, Android SDK 의 platforms;android-35 와 build-tools;35.0.0 (README).
set -euo pipefail
: "${ZENITH_URL:?ZENITH_URL 에 https 서버 주소를 넣는다}"
ZENITH_URL=$(printf %s "$ZENITH_URL" | tr 'A-Z' 'a-z')  # 앱이 호스트를 그대로 비교한다
case "$ZENITH_URL" in https://?*) ;; *) echo "ZENITH_URL 은 https 주소여야 한다" >&2; exit 1 ;; esac

VERSION_CODE=1      # 다시 줄 때마다 1씩 올린다. 낮거나 같으면 폰이 덮어 설치를 거절한다.
VERSION_NAME=0.1.0

TOOLS=${ANDROID_TOOLS:-$HOME/android-tools}
SDK=${ANDROID_HOME:-$TOOLS/sdk}
BT=$SDK/build-tools/35.0.0
JAR=$SDK/platforms/android-35/android.jar
if [ -z "${JAVA_HOME:-}" ]; then JAVA_HOME=$(ls -d "$TOOLS"/jdk-17* | head -1); fi
# 윈도우식 경로(C:\...)면 PATH 에서 콜론이 잘리므로 바꾼다. 윈도우 build-tools 는 일부 도구가 .bat 이다.
if command -v cygpath >/dev/null; then JAVA_HOME=$(cygpath -u "$JAVA_HOME"); fi
BAT=; [ -f "$BT/d8.bat" ] && BAT=.bat
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
# 서명 키는 레포 밖에 둔다. 잃으면 이미 깔린 앱 위에 새 판을 덮어 설치할 수 없다(지우고 다시 깔아야 한다).
KEYS=${ZENITH_ANDROID_KEYS:-$HOME/.zenith}
KEYSTORE=$KEYS/android.jks

cd "$(dirname "$0")"
rm -rf build && mkdir -p build/gen/kr/zenith/app build/classes build/dex

cat > build/gen/kr/zenith/app/Server.java <<EOF
package kr.zenith.app;
final class Server { static final String URL = "$ZENITH_URL"; }
EOF

"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -I "$JAR" --manifest AndroidManifest.xml \
  --min-sdk-version 29 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -o build/unsigned.apk build/res.zip

javac -encoding UTF-8 --release 11 -classpath "$JAR" -d build/classes \
  src/kr/zenith/app/*.java build/gen/kr/zenith/app/Server.java
"$BT/d8$BAT" --release --min-api 29 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && "$BT/aapt" add ../unsigned.apk classes.dex >/dev/null)
"$BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk

if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$KEYS"
  head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$KEYS/android.pass"
  keytool -genkeypair -keystore "$KEYSTORE" -alias zenith -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Zenith" -storepass "$(cat "$KEYS/android.pass")" >/dev/null
  echo "새 서명 키를 만들었다: $KEYSTORE (비밀번호는 $KEYS/android.pass). 둘 다 백업해 둔다."
fi
"$BT/apksigner$BAT" sign --ks "$KEYSTORE" --ks-pass "pass:$(cat "$KEYS/android.pass")" \
  --out build/zenith.apk build/aligned.apk
echo "build/zenith.apk ($VERSION_NAME, $ZENITH_URL)"
