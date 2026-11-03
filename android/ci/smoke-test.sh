#!/usr/bin/env bash
# Проверка приложения на эмуляторе Android. Запускается из .github/workflows/android.yml.
# Ставит проверочную сборку, открывает сайт, проверяет файлы, связь с сервером, кнопку «Назад»
# и обновление: локальный сервер раздаёт «версию 99.0.0», приложение должно её скачать и установить.
# Запуск: bash android/ci/smoke-test.sh <папка с app-debug.apk и HYPERBOREA-99.0.0.apk> <папка для снимков экрана>
set -euo pipefail
APKS=$(cd "$1" && pwd)
mkdir -p "$2"
OUT=$(cd "$2" && pwd)
PKG=site.hyperborea.app
HERE=$(cd "$(dirname "$0")" && pwd)

# Условия проверяются через «grep <<< "$(...)"», а не через «... | grep -q»: иначе при set -o pipefail
# совпадение может считаться ошибкой, если grep закончил раньше, чем команда слева.
step() { echo; echo "=== $*"; }
shot() { adb exec-out screencap -p > "$OUT/$1.png" || true; }
fail() { echo "::error::$*"; shot 99-failure; exit 1; }
page() { node "$HERE/check-page.mjs" "$@"; }
ui() { adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 || true; adb shell cat /sdcard/ui.xml 2>/dev/null || true; }
resumed() { adb shell dumpsys activity activities | grep -m1 -E 'topResumedActivity|mResumedActivity' || true; }
devtools() { adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1 || true; }
wait_for() { # wait_for <секунды> '<условие>'
  local limit=$1
  shift
  for ((i = 0; i < limit; i++)); do
    if eval "$*"; then return 0; fi
    sleep 1
  done
  return 1
}
tap_id() { # нажать на кнопку по её resource-id
  local bounds
  bounds=$(ui | grep -o "resource-id=\"$1\"[^>]*bounds=\"[^\"]*\"" | grep -o 'bounds="[^"]*"' | head -1 || true)
  [ -n "$bounds" ] || return 1
  read -r x1 y1 x2 y2 <<< "$(echo "$bounds" | grep -o '[0-9]\+' | tr '\n' ' ')"
  adb shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
}
attach_devtools() {
  wait_for 60 '[ -n "$(devtools)" ]' || fail "WebView не запустился"
  adb forward --remove-all
  adb forward tcp:9222 "localabstract:$(devtools)"
  wait_for 60 'page ready > /dev/null 2>&1' || fail "Страница не открылась"
}
finish() {
  adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
  # Уменьшенные снимки одной картинкой прямо в журнал — чтобы посмотреть их, не скачивая Artifacts.
  local shots=()
  for name in 01-start 03-database 04-players 06-installer 99-failure; do
    [ -s "$OUT/$name.png" ] && shots+=("$OUT/$name.png")
  done
  if [ ${#shots[@]} -gt 0 ] && command -v convert > /dev/null; then
    convert "${shots[@]}" -resize 180x +append -quality 50 "$OUT/montage.jpg" \
      && echo "MONTAGE ${shots[*]##*/} $(base64 -w0 "$OUT/montage.jpg")"
  fi
  echo
  echo "=== Журнал приложения (последние строки)"
  grep -E 'HYPERBOREA|AndroidRuntime' "$OUT/logcat.txt" | tail -40 || true
}
trap finish EXIT

step "Сервер с «новой версией» для проверки обновления"
printf '{"version":"99.0.0","url":"http://10.0.2.2:8765/HYPERBOREA-99.0.0.apk"}' > "$APKS/latest-android.json"
python3 -m http.server 8765 --directory "$APKS" > "$OUT/http.log" 2>&1 &

step "Установка и запуск"
adb logcat -c || true
adb install -r "$APKS/app-debug.apk"
adb shell am start -W -n "$PKG/.MainActivity"
attach_devtools
sleep 3
shot 01-start

step "Предложение обновиться"
wait_for 40 'grep -q "99.0.0" <<< "$(ui)"' || fail "Не появилось предложение обновиться"
shot 02-update-offer
tap_id "android:id/button2" || fail "Нет кнопки «Позже»"
sleep 1

step "Проверки страницы"
page checks || fail "Не все проверки страницы прошли"

step "Вход в базу и кнопка «Назад»"
page enter || fail "Не удалось войти в базу"
sleep 2
shot 03-database
page open-players || fail "Не открылся раздел PLAYERS"
sleep 2
shot 04-players
adb shell input keyevent KEYCODE_BACK
wait_for 10 'grep -q "/ DATABASE" <<< "$(page where)"' || fail "«Назад» не вернул из раздела PLAYERS в базу: $(page where)"
echo "«Назад» вернул в базу: $(page where)"
shot 05-after-back
adb shell input keyevent KEYCODE_BACK
wait_for 10 '! grep -q "$PKG" <<< "$(resumed)"' || fail "«Назад» на главном экране базы не свернул приложение"
echo "«Назад» на главном экране свернул приложение: $(resumed)"

step "Возврат в приложение"
adb shell am start -W -n "$PKG/.MainActivity"
sleep 2
grep -q "/ DATABASE" <<< "$(page where)" || fail "После возврата приложение открылось не там, где было: $(page where)"
echo "Открылось там же: $(page where)"

step "Обновление до 99.0.0"
adb shell appops set "$PKG" REQUEST_INSTALL_PACKAGES allow
adb shell am force-stop "$PKG"
adb shell am start -W -n "$PKG/.MainActivity"
wait_for 40 'grep -q "99.0.0" <<< "$(ui)"' || fail "После перезапуска не появилось предложение обновиться"
tap_id "android:id/button1" || fail "Нет кнопки «Обновить»"
wait_for 120 'grep -qi packageinstaller <<< "$(resumed)"' || fail "Не открылась установка обновления: $(resumed)"
sleep 3
shot 06-installer
echo "На экране установки: $(ui | grep -o 'text="[^"]\+"' | tr '\n' ' ')"
tap_id "android:id/button1" || fail "Нет кнопки установки"
wait_for 120 'grep -q "versionName=99.0.0" <<< "$(adb shell dumpsys package "$PKG")"' || fail "Обновление не установилось"
sleep 2
shot 07-updated
echo "Обновление установлено: $(adb shell dumpsys package "$PKG" | grep -m1 versionName)"

step "Все проверки прошли"
