// Копирует свежие файлы сайта в папку site/, которая попадает внутрь приложения.
import {cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {SITE_DIR} from './site-path.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = SITE_DIR;
const target = path.join(root, 'site');

if (!existsSync(path.join(source, 'index.html'))) {
  console.error(`Не найден сайт в ${source}`);
  process.exit(1);
}
// Обновления из site-updates/, которые ещё не внесены в папку сайта (npm run site-update):
// у внесённого есть все его новые файлы и нет удалённых.
const updatesDir = path.join(root, 'site-updates');
for (const name of existsSync(updatesDir) ? readdirSync(updatesDir).sort() : []) {
  const manifestPath = path.join(updatesDir, name, 'manifest.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const done = manifest.files.every(({path: file, after}) => {
    const full = path.join(source, file);
    return after === null ? !existsSync(full) : existsSync(full);
  });
  if (!done) console.warn(`Внимание: в сайт не внесено обновление «${manifest.title}». Сначала запустите: npm run site-update`);
}

rmSync(target, {recursive: true, force: true});
cpSync(source, target, {recursive: true});

// Шрифт берём из приложения, а не из Google Fonts, чтобы он был и без интернета.
const googleFont = "@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');";
const indexPath = path.join(target, 'index.html');
const index = readFileSync(indexPath, 'utf8');
if (index.includes(googleFont)) {
  cpSync(path.join(root, 'fonts'), path.join(target, 'app-fonts'), {recursive: true});
  writeFileSync(indexPath, index.replace(googleFont, "@import url('./app-fonts/press-start-2p.css');"));
} else if (index.includes('fonts.googleapis.com')) {
  console.warn('Внимание: на сайте изменилось подключение шрифтов, проверьте их без интернета.');
}

// Музыка и видео, на которые ссылается страница, но которых нет в папке (например, трек темы ещё не положили).
const media = [...index.matchAll(/<(?:audio|video|source)\b[^>]*\bsrc="\.\/([^"?#]+)"/g)].map(match => match[1]);
const missing = [...new Set(media)].filter(file => !existsSync(path.join(target, file)));
if (missing.length) console.warn(`Внимание: на сайте нет файлов: ${missing.join(', ')} — без них эта музыка не будет играть.`);

console.log(`Сайт скопирован: ${source} → ${target}`);
