// Копирует свежие файлы сайта в папку site/, которая попадает внутрь приложения.
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = process.env.HYPERBOREA_SITE
  ?? 'C:/Users/stark/Documents/ChatGPT/hyper/sites/hyperborea-azure-latch/public';
const target = path.join(root, 'site');

if (!existsSync(path.join(source, 'index.html'))) {
  console.error(`Не найден сайт в ${source}`);
  process.exit(1);
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

mkdirSync(path.join(root, 'build'), {recursive: true});
cpSync(path.join(source, 'icons/icon-512.png'), path.join(root, 'build/icon.png'));
console.log(`Сайт скопирован: ${source} → ${target}`);
