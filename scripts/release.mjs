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
const token = execFileSync(gh, ['auth', 'token'], {encoding: 'utf8'}).trim();

if (bump !== 'current') execSync(`npm version ${bump} --no-git-tag-version`, {stdio: 'inherit'});
const {version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
console.log(`Выпускаю версию ${version}…`);

execSync('node scripts/copy-site.mjs', {stdio: 'inherit'});
execSync('npx electron-builder --win nsis --publish always', {stdio: 'inherit', env: {...process.env, GH_TOKEN: token}});
console.log(`Готово: версия ${version} выложена, приложения обновятся при следующем запуске.`);
