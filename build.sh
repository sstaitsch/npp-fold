#!/usr/bin/env bash
# Baut die APK ohne Gradle: esbuild -> aapt2 -> javac -> d8 -> zipalign -> apksigner
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_SDK_LOCAL:-/home/claude/android-sdk}
BT=${BT:-$SDK/android-16}; JAR=${JAR:-$SDK/android-36/android.jar}
VERSION_CODE=${VERSION_CODE:-2}; VERSION_NAME=${VERSION_NAME:-1.1}
UPDATE_REPO=${UPDATE_REPO:-sstaitsch/npp-fold}
KS_FILE=${KS_FILE:-release.keystore}; KS_PASS=${KS_PASS:-nppfold}; KS_ALIAS=${KS_ALIAS:-nppfold}
OUT=build; rm -rf $OUT; mkdir -p $OUT/assets $OUT/classes $OUT/gen

(cd web && npx --no-install esbuild src/main.js --bundle --minify --format=iife --target=chrome100 --outfile=dist/app.js --log-level=error && cp src/index.html dist/)
cp web/dist/index.html web/dist/app.js $OUT/assets/

mkdir -p $OUT/gen/de/npp/mobil
cat > $OUT/gen/de/npp/mobil/Config.java <<JAVA
package de.npp.mobil;
final class Config {
    static final String UPDATE_URL = "${UPDATE_REPO:+https://github.com/$UPDATE_REPO/releases/latest/download/}";
}
JAVA

$BT/aapt2 compile --dir app/res -o $OUT/res.zip
$BT/aapt2 link -o $OUT/unsigned.apk -I $JAR --manifest app/AndroidManifest.xml -A $OUT/assets \
  --java $OUT/gen --min-sdk-version 26 --target-sdk-version 35 --version-code $VERSION_CODE --version-name $VERSION_NAME $OUT/res.zip

javac -nowarn -source 11 -target 11 -encoding UTF-8 -classpath $JAR -d $OUT/classes \
  $(find app/src $OUT/gen -name '*.java') 2>&1 | grep -v "warning: \[options\]" || true
$BT/d8 --release --min-api 26 --lib $JAR --output $OUT $(find $OUT/classes -name '*.class')
(cd $OUT && zip -q -j unsigned.apk classes.dex)

$BT/zipalign -f -p 4 $OUT/unsigned.apk $OUT/aligned.apk
if [ "${REQUIRE_KS:-0}" = 1 ] && [ ! -f "$KS_FILE" ]; then echo "Keystore fehlt" >&2; exit 1; fi
[ -f "$KS_FILE" ] || keytool -genkeypair -keystore "$KS_FILE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
  -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Npp Fold, O=Privat, C=DE" >/dev/null 2>&1
$BT/apksigner sign --ks "$KS_FILE" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" --ks-key-alias "$KS_ALIAS" --out $OUT/NppFold.apk $OUT/aligned.apk
$BT/apksigner verify -v $OUT/NppFold.apk | head -5
printf '{"versionCode":%s,"versionName":"%s","apk":"NppFold.apk","notes":%s}\n' "$VERSION_CODE" "$VERSION_NAME" \
  "$(python3 -c 'import json,os,re;n=os.environ.get("RELEASE_NOTES","");n="\n".join(l for l in n.splitlines() if not re.match(r"(Co-Authored-By|Claude-Session|Signed-off-by):",l,re.I)).strip();print(json.dumps(n))')" > $OUT/version.json
cat $OUT/version.json
ls -la $OUT/NppFold.apk
