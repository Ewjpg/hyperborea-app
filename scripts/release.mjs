// Выпуск обновления: поднимает версию, берёт свежий сайт, собирает установщик и выкладывает его на GitHub.
// Запуск: npm run release            — маленькое обновление (1.1.0 → 1.1.1)
//         npm run release -- minor   — заметное обновление (1.1.0 → 1.2.0)
//         npm run release -- current — выложить текущую версию без повышения номера
import {execFileSync, execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const bump = process.argv[2] ?? 'patch';
if (!['patch', 'minor', 'major', 'current'].includes(bump)) {
  console.error('Можно: patch, minor, major или current');
  process.exit(1);
}

const gh = process.env.GH_PATH ?? 'C:/Program Files/GitHub CLI/gh.exe';
const repo = 'Ewjpg/hyperborea-app';
const token = execFileSync(gh, ['auth', 'token'], {encoding: 'utf8'}).trim();

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

const assets = JSON.parse(execFileSync(gh, ['release', 'view', tag, '--repo', repo, '--json', 'assets'], {encoding: 'utf8'})).assets.map(asset => asset.name);
const missing = [`HYPERBOREA-Setup-${version}.exe`, `HYPERBOREA-Setup-${version}.exe.blockmap`, 'latest.yml'].filter(name => !assets.includes(name));
if (missing.length) {
  console.error(`В черновике ${tag} не хватает: ${missing.join(', ')}. Он не опубликован — запустите «npm run release -- current» ещё раз.`);
  process.exit(1);
}
execFileSync(gh, ['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest'], {stdio: 'inherit'});
console.log(`Готово: версия ${version} выложена, приложения обновятся при следующем запуске.`);
