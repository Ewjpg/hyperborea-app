// Проверка страницы внутри приложения через отладчик WebView (работает только в проверочных сборках).
// Запускает android/ci/smoke-test.sh на GitHub. Перед запуском: adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
// node check-page.mjs ready | checks | enter | open-players | where
const PAGE = 'https://appassets.androidplatform.net/';
// Если WebView перестал отвечать, не ждём бесконечно.
setTimeout(() => {
  console.log('Страница не отвечает');
  process.exit(2);
}, 100000).unref();

async function connect() {
  const targets = await (await fetch('http://127.0.0.1:9222/json', {signal: AbortSignal.timeout(10000)})).json();
  const target = targets.find(item => item.type === 'page' && item.url.startsWith(PAGE));
  if (!target) throw new Error('Нет страницы приложения среди ' + JSON.stringify(targets.map(item => item.url)));
  const socket = new WebSocket(`ws://127.0.0.1:9222/devtools/page/${target.id}`);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('Нет связи с отладчиком WebView'));
  });
  let next = 0;
  const waiting = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  };
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, ({error, result}) => {
      if (error) reject(new Error(error.message));
      else if (result.exceptionDetails) reject(new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text));
      else resolve(result.result.value);
    });
    socket.send(JSON.stringify({id, method: 'Runtime.evaluate', params: {expression, awaitPromise: true, returnByValue: true, userGesture: true}}));
  });
  return {evaluate, close: () => socket.close()};
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(evaluate, expression, seconds) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await evaluate(expression)) return true;
    await sleep(500);
  }
  return false;
}

// [название, выражение на странице, проверка результата]
const CHECKS = [
  ['скрипт приложения подключён первым', `document.head.firstElementChild?.src ?? ''`, value => value.endsWith('/__android/bridge.js')],
  ['мост к серверу есть', `typeof HyperboreaAndroid`, value => value === 'object'],
  ['service worker выключен', `navigator.serviceWorker.register('./sw.js').then(() => 'registered', error => error.name)`, value => value === 'NotSupportedError'],
  ['файл сайта', `fetch('./manifest.webmanifest').then(response => response.status + ' ' + response.headers.get('content-type'))`, value => value.startsWith('200 application/manifest+json')],
  ['нет такого файла → 404', `fetch('./no-such-file.js').then(response => response.status)`, value => value === 404],
  ['модуль three.js', `import('./vendor/three.module.min.js').then(module => typeof module.WebGLRenderer)`, value => value === 'function'],
  ['кусок файла (Range 100-199)', `fetch('./assets/mi-bombo.mp3', {headers: {Range: 'bytes=100-199'}}).then(async response => [response.status, response.headers.get('content-range'), (await response.arrayBuffer()).byteLength].join(' '))`, value => /^206 bytes 100-199\/\d+ 100$/.test(value)],
  ['кусок файла (Range 1000-)', `fetch('./assets/mi-bombo.mp3', {headers: {Range: 'bytes=1000-'}}).then(async response => [response.status, response.headers.get('content-range'), (await response.arrayBuffer()).byteLength].join(' '))`, value => {
    const match = /^206 bytes 1000-(\d+)\/(\d+) (\d+)$/.exec(value);
    return Boolean(match) && Number(match[1]) === Number(match[2]) - 1 && Number(match[3]) === Number(match[2]) - 1000;
  }],
  ['перемотка музыки в <audio>', `new Promise(resolve => {
    const audio = new Audio('./assets/mi-bombo.mp3');
    audio.muted = true;
    const timer = setTimeout(() => resolve('timeout, readyState ' + audio.readyState), 20000);
    audio.addEventListener('error', () => { clearTimeout(timer); resolve('error ' + audio.error?.code); });
    audio.addEventListener('loadedmetadata', () => {
      audio.addEventListener('seeked', () => { clearTimeout(timer); resolve('seeked ' + Math.round(audio.currentTime) + '/' + Math.round(audio.duration)); }, {once: true});
      audio.currentTime = Math.min(audio.duration / 2, 30);
    }, {once: true});
    audio.load();
  })`, value => /^seeked [1-9]\d*\/\d+$/.test(value)],
  ['шрифт Press Start 2P', `document.fonts.load('16px "Press Start 2P"').then(() => document.fonts.check('16px "Press Start 2P"'))`, value => value === true],
  ['есть связь', `navigator.onLine`, value => value === true],
  ['сервер: получить форму (GET)', `fetch('/api/fear/form', {cache: 'no-store'}).then(async response => response.status + ' ' + Object.keys(await response.json()).join(','))`, value => /^200 .*token/.test(value)],
  ['сервер: отправка через мост (POST, заведомо неверная)', `fetch('/api/fear/submit', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: 'android-ci-check', token: 'invalid', payload: {}, website: ''}), signal: AbortSignal.timeout(45000)}).then(async response => response.status + ' ' + (await response.text()).slice(0, 300))`, value => !value.startsWith('503') && !value.includes('Unsupported request')],
  ['«Назад» на заставке ничего не закрывает', `window.__hyperboreaBack()`, value => value === false],
  ['размер страницы', `innerWidth + 'x' + innerHeight + ' @' + devicePixelRatio`, () => true],
];

const command = process.argv[2];
const {evaluate, close} = await connect();
let ok = true;
try {
  if (command === 'ready') {
    ok = (await evaluate('document.readyState')) === 'complete';
  } else if (command === 'checks') {
    for (const [name, expression, check] of CHECKS) {
      let value;
      try {
        value = await evaluate(expression);
      } catch (error) {
        value = 'ошибка: ' + error.message;
      }
      const passed = check(value);
      ok &&= passed;
      console.log(`${passed ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(value)}`);
    }
  } else if (command === 'enter') {
    // Заставка: «CONNECT» → загрузка → «ENTER SYSTEM» → база.
    await evaluate(`document.getElementById('connectStart').click()`);
    ok = await waitFor(evaluate, `!document.getElementById('landing').hidden && !window.BootEvents?.active`, 40);
    if (ok) {
      await sleep(1500);
      await evaluate(`document.getElementById('enter').click()`);
      // Когда переход закончен, сайт ставит фокус на раздел PLAYERS.
      ok = await waitFor(evaluate, `document.getElementById('database').classList.contains('active') && document.activeElement?.id === 'openPlayers'`, 30);
    }
    console.log(ok ? 'Вошли в базу' : 'Не удалось войти в базу');
  } else if (command === 'open-players') {
    await evaluate(`document.getElementById('openPlayers').click()`);
    ok = await waitFor(evaluate, `/PLAYERS/.test(document.querySelector('#database .db-header')?.innerText ?? '')`, 15);
    console.log(ok ? 'Открыт раздел PLAYERS' : 'Раздел PLAYERS не открылся');
  } else if (command === 'where') {
    console.log(await evaluate(`document.querySelector('#database .db-header')?.innerText.replace(/\\s+/g, ' ') ?? ''`));
  } else {
    throw new Error('Неизвестная команда: ' + command);
  }
} finally {
  close();
}
process.exit(ok ? 0 : 1);
