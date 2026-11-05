// Вносит в папку сайта обновления из site-updates/ (по порядку, каждое — один раз).
// Запуск: npm run site-update
//         npm run site-update -- --music "C:\Музыка\Run Up.mp3"   — заодно положить трек темы
//         npm run site-update -- --check                          — только показать, что будет сделано
// Перед изменениями все заменяемые и удаляемые файлы копируются в site-backups/<дата>/.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SITE_DIR} from './site-path.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const updatesDir = path.join(root, 'site-updates');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const musicIndex = args.indexOf('--music');
const musicFile = musicIndex >= 0 ? args[musicIndex + 1] : null;
if (musicIndex >= 0 && !musicFile) fail('После --music укажите путь к файлу трека.');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const inSite = relative => {
  const file = path.resolve(SITE_DIR, relative);
  if (!file.startsWith(path.resolve(SITE_DIR) + path.sep)) fail(`Неверный путь в обновлении: ${relative}`);
  return file;
};

if (!existsSync(path.join(SITE_DIR, 'index.html'))) {
  fail(`Не найден сайт в ${SITE_DIR}\nУкажите папку сайта: set HYPERBOREA_SITE=C:\\путь\\к\\public`);
}

// git нужен, только если файл на компьютере успели изменить после 1.1.3: тогда вносятся лишь правки, а не весь файл.
const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
})();
function gitApply(patch, files, check) {
  const flags = files.map(file => `--include=${file}`);
  try {
    execFileSync('git', ['apply', ...(check ? ['--check'] : []), '--whitespace=nowarn', ...flags, patch], {
      cwd: SITE_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Не искать репозиторий выше папки сайта: пути в правках идут от самой папки сайта.
      env: {...process.env, GIT_CEILING_DIRECTORIES: path.dirname(path.resolve(SITE_DIR))},
    });
    return true;
  } catch {
    return false;
  }
}

const updates = existsSync(updatesDir)
  ? readdirSync(updatesDir, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  : [];
if (!updates.length) fail('В site-updates/ нет обновлений.');

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const backupDir = path.join(root, 'site-backups', stamp);
let changedAnything = false;
let music = null;

for (const name of updates) {
  const dir = path.join(updatesDir, name);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (manifest.music) music = manifest.music;
  const plan = [];
  const conflicts = [];
  for (const entry of manifest.files) {
    const file = inSite(entry.path);
    const current = existsSync(file) ? sha(file) : null;
    if (current === entry.after) continue;
    if (entry.after === null) plan.push({...entry, action: 'delete', file});
    else if (current === entry.before) plan.push({...entry, action: current ? 'replace' : 'create', file});
    else conflicts.push({...entry, file, current});
  }
  if (!plan.length && !conflicts.length) {
    console.log(`✓ ${manifest.title} — уже внесено.`);
    continue;
  }

  // Файлы, изменённые на компьютере после 1.1.3: пробуем внести только правки.
  const patch = path.join(dir, 'changes.patch');
  const patchable = conflicts.filter(entry => entry.current && entry.before && readFileSync(patch, 'utf8').includes(`diff --git a/${entry.path} b/${entry.path}`));
  const unresolved = conflicts.filter(entry => !patchable.includes(entry));
  const patchOk = patchable.length ? gitApply(patch, patchable.map(entry => entry.path), true) : true;
  if (unresolved.length || !patchOk) {
    console.error(`✗ ${manifest.title}: эти файлы на компьютере уже отличаются от версии 1.1.3, и правки к ним не подходят:`);
    for (const entry of unresolved.length ? unresolved : patchable) console.error(`   ${entry.path}`);
    if (!patchOk && !hasGit) console.error('   (чтобы внести только правки, нужен git — https://git-scm.com/download/win)');
    console.error('Ничего не изменено. Попросите внести это обновление вручную, приложив эти файлы.');
    process.exit(1);
  }

  console.log(`→ ${manifest.title}`);
  for (const entry of plan) console.log(`   ${{replace: 'заменить', create: 'добавить', delete: 'удалить'}[entry.action]}: ${entry.path}`);
  for (const entry of patchable) console.log(`   внести правки (файл менялся после 1.1.3): ${entry.path}`);
  if (checkOnly) continue;

  for (const entry of [...plan, ...patchable]) {
    if (!existsSync(entry.file)) continue;
    const copy = path.join(backupDir, entry.path);
    mkdirSync(path.dirname(copy), {recursive: true});
    copyFileSync(entry.file, copy);
  }
  for (const entry of plan) {
    if (entry.action === 'delete') {
      rmSync(entry.file, {force: true});
      continue;
    }
    mkdirSync(path.dirname(entry.file), {recursive: true});
    writeFileSync(entry.file, readFileSync(path.join(dir, 'files', entry.path)));
  }
  if (patchable.length && !gitApply(patch, patchable.map(entry => entry.path), false)) {
    fail(`Не удалось внести правки. Прежние файлы лежат в ${backupDir}`);
  }
  changedAnything = true;
}

// Трек темы не хранится в репозитории: его кладут отдельно.
if (music) {
  const target = inSite(music.path);
  if (musicFile) {
    if (!existsSync(musicFile)) fail(`Не найден файл трека: ${musicFile}`);
    if (checkOnly) {
      console.log(`→ трек «${music.title}» будет скопирован в ${music.path}`);
    } else if (path.extname(musicFile).toLowerCase() === '.mp3') {
      mkdirSync(path.dirname(target), {recursive: true});
      copyFileSync(musicFile, target);
      console.log(`✓ Трек «${music.title}» → ${music.path}`);
    } else {
      // Другой формат переводим в MP3, если установлен ffmpeg.
      try {
        execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', musicFile, '-vn', '-ac', '2', '-b:a', '160k', target], {stdio: 'inherit'});
        console.log(`✓ Трек «${music.title}» переведён в MP3 → ${music.path}`);
      } catch {
        fail('Трек должен быть в формате MP3 (или установите ffmpeg, чтобы перевести его автоматически).');
      }
    }
  } else if (!existsSync(target)) {
    console.warn(`! Нет трека «${music.title}». Положите его в ${path.join(SITE_DIR, music.path)}`);
    console.warn('  или запустите: npm run site-update -- --music "путь\\к\\треку.mp3"');
  }
}

if (checkOnly) console.log('Проверка закончена, ничего не изменено.');
else if (changedAnything) console.log(`Готово. Прежние версии файлов сохранены в ${path.relative(root, backupDir)}`);
