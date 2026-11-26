#!/usr/bin/env bash
# Dans le téléphone simulé de la CI : installe l'APK de test, le lance deux fois et le pilote
# (voir smoke-test.mjs). Usage : bash mobile/ci/emulator.sh <apk>
set -euo pipefail
APK="$1"
APP=io.github.diomankeita.journal

devtools() {
  local pid=""
  for _ in $(seq 1 60); do
    pid=$(adb shell pidof "$APP" | tr -d '\r') && [ -n "$pid" ] && break
    sleep 1
  done
  [ -n "$pid" ] || { echo "L'application ne démarre pas"; adb logcat -d | tail -80; exit 1; }
  adb forward --remove-all || true
  adb forward tcp:9222 "localabstract:webview_devtools_remote_$pid"
}

adb install -r "$APK"
adb shell am start -W -n "$APP/.MainActivity"
devtools
node mobile/ci/smoke-test.mjs premier

# Relance complète : la base (IndexedDB) doit avoir survécu.
adb shell am force-stop "$APP"
sleep 2
adb shell am start -W -n "$APP/.MainActivity"
devtools
node mobile/ci/smoke-test.mjs relance

# Plantage éventuel de la WebView pendant le test.
if adb logcat -d | grep -E "FATAL EXCEPTION|chromium.*CRASH" ; then
  echo "Plantage détecté"; exit 1
fi
