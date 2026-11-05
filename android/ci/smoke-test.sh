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
ADB=$(command -v adb)

# Ни одна команда не ждёт бесконечно: зависший эмулятор не должен держать проверку до тайм-аута GitHub.
adb() { timeout 120 "$ADB" "$@"; }
page() { timeout 120 node "$HERE/check-page.mjs" "$@"; }

# Условия проверяются через «grep <<< "$(...)"», а не через «... | grep -q»: иначе при set -o pipefail
# совпадение может считаться ошибкой, если grep закончил раньше, чем команда слева.
step() { echo; echo "=== $*"; }
shot() { adb exec-out screencap -p > "$OUT/$1.png" || true; }
fail() {
  echo "::error::$*"
  shot 99-failure
  echo "На экране: $(ui | grep -o 'text="[^"]\+"' | head -20 | tr '\n' ' ')"
  exit 1
}
ui() { adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1 || true; adb shell cat /sdcard/ui.xml 2>/dev/null || true; }
resumed() { adb shell dumpsys activity activities | grep -m1 -E 'topResumedActivity|mResumedActivity' || true; }
devtools() { adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1 || true; }
wait_for() { # wait_for <секунды> '<условие>'
  local deadline=$((SECONDS + $1))
  shift
  while ((SECONDS < deadline)); do
    if eval "$*"; then return 0; fi
    sleep 1
  done
  return 1
}
tap_in() { # tap_in "<снимок экрана>" <resource-id> — нажать на кнопку
  local bounds
  bounds=$(grep -o "resource-id=\"$2\"[^>]*bounds=\"[^\"]*\"" <<< "$1" | grep -o 'bounds="[^"]*"' | head -1 || true)
  [ -n "$bounds" ] || return 1
  read -r x1 y1 x2 y2 <<< "$(grep -o '[0-9]\+' <<< "$bounds" | tr '\n' ' ')"
  adb shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2))
}
# Что на экране (XML). На медленном эмуляторе иногда всплывает системное окно «… isn't responding»
# у других приложений (например, у рабочего стола) и закрывает собой всё — его закрываем кнопкой «Wait».
screen() {
  local xml
  xml=$(ui)
  if tap_in "$xml" "android:id/aerr_wait"; then
    echo "(закрыто системное окно «не отвечает»)" >&2
    sleep 2
    xml=$(ui)
  fi
  printf '%s' "$xml"
}
tap_id() { tap_in "$(screen)" "$1"; }
attach_devtools() {
  wait_for 60 '[ -n "$(devtools)" ]' || fail "WebView не запустился"
  adb forward --remove-all
  adb forward tcp:9222 "localabstract:$(devtools)"
  wait_for 60 'page ready > /dev/null 2>&1' || fail "Страница не открылась"
}
finish() {
  adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
  echo
  echo "=== Журнал приложения (последние строки)"
  grep -E ' HYPERBOREA:' "$OUT/logcat.txt" | tail -30 || true
  grep -A 20 'FATAL EXCEPTION' "$OUT/logcat.txt" || true
}
trap finish EXIT

step "Сервер с «новой версией» для проверки обновления"
printf '{"version":"99.0.0","url":"http://10.0.2.2:8765/HYPERBOREA-99.0.0.apk"}' > "$APKS/latest-android.json"
python3 -m http.server 8765 --directory "$APKS" > "$OUT/http.log" 2>&1 &

step "Эмулятор"
adb shell input keyevent KEYCODE_WAKEUP || true
adb shell wm dismiss-keyguard || true
sleep 20 # после холодного запуска системе нужно успокоиться
screen > /dev/null

step "Установка и запуск"
adb logcat -c || true
adb install -r "$APKS/app-debug.apk"
adb shell am start -W -n "$PKG/.MainActivity"
attach_devtools
sleep 3
shot 01-start

step "Предложение обновиться"
if ! wait_for 90 'grep -q "99.0.0" <<< "$(screen)"'; then
  # Сразу после запуска эмулятора сеть бывает ещё не готова, а следующая проверка в приложении — через 10 минут.
  echo "Окна нет. Журнал приложения: $(adb logcat -d -s HYPERBOREA:I | tail -5)"
  echo "Перезапускаю приложение и пробую ещё раз."
  adb shell am force-stop "$PKG"
  adb shell am start -W -n "$PKG/.MainActivity"
  attach_devtools
  wait_for 90 'grep -q "99.0.0" <<< "$(screen)"' || fail "Не появилось предложение обновиться"
fi
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
wait_for 20 'grep -q "/ DATABASE" <<< "$(page where)"' || fail "«Назад» не вернул из раздела PLAYERS в базу: $(page where)"
echo "«Назад» вернул в базу: $(page where)"
shot 05-after-back
adb shell input keyevent KEYCODE_BACK
wait_for 20 '! grep -q "$PKG" <<< "$(resumed)"' || fail "«Назад» на главном экране базы не свернул приложение"
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
wait_for 90 'grep -q "99.0.0" <<< "$(screen)"' || fail "После перезапуска не появилось предложение обновиться"
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
