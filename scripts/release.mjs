// Выпуск обновления: поднимает версию, берёт свежий сайт, собирает установщик для Windows и APK для Android
// и выкладывает их на GitHub.
// Запуск: npm run release            — маленькое обновление (1.1.0 → 1.1.1)
//         npm run release -- minor   — заметное обновление (1.1.0 → 1.2.0)
//         npm run release -- current — выложить текущую версию без повышения номера
import {execFileSync, execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {ensureAndroidKey} from './android-key.mjs';

const bump = process.argv[2] ?? 'patch';
if (!['patch', 'minor', 'major', 'current'].includes(bump)) {
  console.error('Можно: patch, minor, major или current');
  process.exit(1);
}

const gh = process.env.GH_PATH ?? 'C:/Program Files/GitHub CLI/gh.exe';
const repo = 'Ewjpg/hyperborea-app';
const token = execFileSync(gh, ['auth', 'token'], {encoding: 'utf8'}).trim();

// Ключ подписи Android нужен до сборки; при первом выпуске он создаётся здесь.
ensureAndroidKey(gh, repo);

if (bump !== 'current') execSync(`npm version ${bump} --no-git-tag-version`, {stdio: 'inherit'});
const {version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = `v${version}`;
console.log(`Выпускаю версию ${version}…`);

// electron-builder загружает файлы двумя потоками сразу; если релиза ещё нет, оба пытаются его создать,
// и второй падает (так сломался выпуск 1.1.2: в релизе не оказалось latest.yml).
// Поэтому черновик создаём заранее, а публикуем, только когда в нём лежат все файлы.
let existing = null;
try {
  existing = JSON.parse(execFileSync(gh, ['release', 'view', tag, '--repo', repo, '--json', 'isDraft'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}));
} catch {}
if (existing && !existing.isDraft) {
  console.error(`Релиз ${tag} уже опубликован. Поднимите версию или удалите его на GitHub.`);
  process.exit(1);
}
if (!existing) execFileSync(gh, ['release', 'create', tag, '--repo', repo, '--draft', '--title', version, '--notes', '', '--target', 'main'], {stdio: 'inherit'});

execSync('node scripts/copy-site.mjs', {stdio: 'inherit'});
execSync('npx electron-builder --win nsis --publish always', {stdio: 'inherit', env: {...process.env, GH_TOKEN: token}});

// APK собирает GitHub (.github/workflows/android.yml): берёт сайт из только что выложенного установщика,
// подписывает ключом из секретов и кладёт APK в этот же черновик. Обычно это занимает 5–10 минут.
const androidRuns = () => execFileSync(gh, ['run', 'list', '--repo', repo, '--workflow', 'android.yml', '--event', 'workflow_dispatch', '--limit', '20', '--json', 'databaseId', '--jq', '.[].databaseId'], {encoding: 'utf8'})
  .split(/\s+/).filter(Boolean);
const before = new Set(androidRuns());
execFileSync(gh, ['workflow', 'run', 'android.yml', '--repo', repo, '--ref', 'main', '-f', `tag=${tag}`], {stdio: 'inherit'});
let run;
for (let attempt = 0; attempt < 30 && !run; attempt++) {
  await sleep(3000);
  run = androidRuns().find(id => !before.has(id));
}
if (!run) {
  console.error(`Сборка Android на GitHub не запустилась. Черновик ${tag} не опубликован — запустите «npm run release -- current» ещё раз.`);
  process.exit(1);
}
console.log(`Собираю APK для Android на GitHub: https://github.com/${repo}/actions/runs/${run}`);
try {
  execFileSync(gh, ['run', 'watch', run, '--repo', repo, '--exit-status', '--interval', '15'], {stdio: 'inherit'});
} catch {
  console.error(`Сборка Android не удалась: https://github.com/${repo}/actions/runs/${run}`);
  console.error(`Черновик ${tag} не опубликован. После исправления запустите «npm run release -- current».`);
  process.exit(1);
}

const assets = JSON.parse(execFileSync(gh, ['release', 'view', tag, '--repo', repo, '--json', 'assets'], {encoding: 'utf8'})).assets.map(asset => asset.name);
const expected = [
  `HYPERBOREA-Setup-${version}.exe`, `HYPERBOREA-Setup-${version}.exe.blockmap`, 'latest.yml',
  `HYPERBOREA-${version}.apk`, 'latest-android.json',
];
const missing = expected.filter(name => !assets.includes(name));
if (missing.length) {
  console.error(`В черновике ${tag} не хватает: ${missing.join(', ')}. Он не опубликован — запустите «npm run release -- current» ещё раз.`);
  process.exit(1);
}
execFileSync(gh, ['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest'], {stdio: 'inherit'});
console.log(`Готово: версия ${version} выложена, приложения на ПК и Android обновятся при следующем запуске.`);
