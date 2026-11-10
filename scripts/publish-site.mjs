// Публикует сайт на GitHub Pages: копирует папку сайта (SITE_DIR) в pages/ — клон репозитория
// Ewjpg/hyperborea-site, — делает коммит и отправляет его. Через минуту-две новая версия открыта по адресу ниже.
//   npm run publish-site                      — сообщение коммита «Сайт: <дата>»
//   npm run publish-site -- "Что изменилось"   — своё сообщение (каждый аргумент — отдельный абзац)
import {cpSync, existsSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SITE_DIR} from './site-path.mjs';

const REPO = 'Ewjpg/hyperborea-site';
const URL = 'https://ewjpg.github.io/hyperborea-site/';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, 'pages');
const run = (args, opts = {}) => (execFileSync('git', args, {cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts}) ?? '').trim();

if (!existsSync(path.join(SITE_DIR, 'index.html'))) {
  console.error('Не найден сайт в ' + SITE_DIR);
  process.exit(1);
}
if (!existsSync(path.join(dir, '.git'))) {
  console.log('Скачиваю репозиторий ' + REPO + '…');
  execFileSync('git', ['clone', `https://github.com/${REPO}.git`, dir], {stdio: 'inherit'});
}
run(['config', 'core.autocrlf', 'false']); // файлы сайта уходят байт в байт, без замены переводов строк
try { run(['pull', '--ff-only', '--quiet']); } catch { /* пустой репозиторий: тянуть нечего */ }

// Папка pages/ = то, что лежит в папке сайта (+ служебный файл для GitHub Pages).
// Без описаний: README из папки сайта на GitHub не попадает (по просьбе владельца страница репозитория пустая).
for (const name of readdirSync(dir)) if (name !== '.git') rmSync(path.join(dir, name), {recursive: true, force: true});
cpSync(SITE_DIR, dir, {recursive: true, filter: src => !/^readme(\.[a-z]+)?$/i.test(path.basename(src))});
writeFileSync(path.join(dir, '.nojekyll'), ''); // отдавать файлы как есть, без обработки Jekyll

run(['add', '-A']);
if (!run(['status', '--porcelain'])) {
  console.log('Изменений нет — сайт уже опубликован: ' + URL);
  process.exit(0);
}
const notes = process.argv.slice(2).filter(Boolean);
const message = notes.length ? notes : ['Сайт: ' + new Date().toLocaleString('ru-RU')];
run(['-c', 'user.name=Ewjpg', '-c', 'user.email=Ewjpg@users.noreply.github.com', 'commit', '--quiet', ...message.flatMap(m => ['-m', m])]);
run(['push', '--quiet', 'origin', 'HEAD:main'], {stdio: 'inherit'});
console.log('Опубликовано. Через 1–2 минуты новая версия будет здесь: ' + URL);
