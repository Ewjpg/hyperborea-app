// HYPERBOREA — приложение для ПК.
// Файлы сайта лежат внутри приложения (папка site), поэтому интернет и VPN для работы не нужны.
// Только отправка карточек (/api/...) пересылается на сервер сайта.
// Обновления приходят с GitHub (github.com/Ewjpg/hyperborea-app, раздел Releases).
const {app, BrowserWindow, Menu, dialog, net, protocol, shell} = require('electron');
const {autoUpdater} = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const {Readable} = require('node:stream');

const SITE_URL = 'https://hyperborea.sharpsong66.chatgpt.site';
const SCHEME = 'hyperborea';
// Адрес страницы внутри приложения. Не менять: к нему привязаны сохранённые данные (localStorage).
const ORIGIN = `${SCHEME}://app`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true},
}]);

function siteRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'site') : path.join(__dirname, 'site');
}

async function serveFile(request) {
  let relative = decodeURIComponent(new URL(request.url).pathname);
  if (relative === '/' || relative === '') relative = '/index.html';
  const root = siteRoot();
  const file = path.normalize(path.join(root, relative));
  if (!file.startsWith(root + path.sep)) return new Response('Forbidden', {status: 403});

  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return new Response('Not found', {status: 404});
  }
  if (!stat.isFile()) return new Response('Not found', {status: 404});

  const headers = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };

  // Частичная загрузка нужна, чтобы можно было перематывать музыку и видео.
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(stat.size - Number(range[2]), 0);
    let end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${stat.size}`}});
    }
    return new Response(Readable.toWeb(fs.createReadStream(file, {start, end})), {
      status: 206,
      headers: {...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1)},
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    headers: {...headers, 'Content-Length': String(stat.size)},
  });
}

async function proxyApi(request) {
  const url = new URL(request.url);
  const init = {
    method: request.method,
    headers: {
      'Content-Type': request.headers.get('content-type') ?? 'application/json',
      // Сервер принимает карточки только «со своего сайта».
      'Origin': SITE_URL,
    },
  };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
  try {
    const response = await net.fetch(SITE_URL + url.pathname + url.search, init);
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: {'Content-Type': response.headers.get('content-type') ?? 'application/json'},
    });
  } catch {
    return Response.json(
      {error: 'Нет связи с сервером. Попробуйте позже или включите VPN. Черновик остаётся на устройстве.'},
      {status: 503},
    );
  }
}

const statePath = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return {width: 1400, height: 900, maximized: false};
  }
}

function saveWindowState(win) {
  const state = {...win.getNormalBounds(), maximized: win.isMaximized()};
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state));
  } catch {}
}

function openExternal(url) {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 800,
    minHeight: 560,
    title: 'HYPERBOREA',
    backgroundColor: '#000000',
    icon: path.join(siteRoot(), 'icons/icon-512.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {contextIsolation: true, sandbox: true},
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveWindowState(win));

  // Ссылки на другие сайты открываются в обычном браузере.
  win.webContents.setWindowOpenHandler(({url}) => {
    if (url.startsWith(ORIGIN)) return {action: 'allow'};
    openExternal(url);
    return {action: 'deny'};
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(ORIGIN)) return;
    event.preventDefault();
    openExternal(url);
  });

  // F11 — полноэкранный режим, Ctrl+R — перезагрузка.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.control && input.key.toLowerCase() === 'r') {
      win.webContents.reload();
      event.preventDefault();
    }
  });

  win.loadURL(`${ORIGIN}/`);
  return win;
}

function setupUpdates() {
  if (!app.isPackaged) return;
  // Журнал последней проверки обновлений: %APPDATA%\HYPERBOREA\updates.log
  const logFile = path.join(app.getPath('userData'), 'updates.log');
  try {
    fs.writeFileSync(logFile, '');
  } catch {}
  const write = level => (...args) => {
    try {
      fs.appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${args.join(' ')}\n`);
    } catch {}
  };
  autoUpdater.logger = {info: write('info'), warn: write('warn'), error: write('error'), debug: () => {}};
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;
  // Без интернета проверка просто не удастся — приложение работает дальше как обычно.
  autoUpdater.on('error', () => {});

  let asked = false;
  autoUpdater.on('update-downloaded', async info => {
    if (asked) return;
    asked = true;
    const {response} = await dialog.showMessageBox(BrowserWindow.getAllWindows()[0], {
      type: 'info',
      title: 'HYPERBOREA',
      message: `Доступна новая версия ${info.version}`,
      detail: 'Обновление уже скачано. Перезапустить приложение сейчас?\nЕсли нажать «Позже», оно установится, когда вы закроете приложение.',
      buttons: ['Перезапустить', 'Позже'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall(true, true);
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 2 * 60 * 60 * 1000);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    protocol.handle(SCHEME, request => {
      const {pathname} = new URL(request.url);
      return pathname.startsWith('/api/') ? proxyApi(request) : serveFile(request);
    });
    createWindow();
    setupUpdates();
  });

  app.on('window-all-closed', () => app.quit());
}
