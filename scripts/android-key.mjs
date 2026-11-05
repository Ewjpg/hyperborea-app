// Ключ подписи приложения для Android.
// Телефон ставит обновление поверх старой версии, только если обе подписаны одним и тем же ключом.
// Поэтому ключ создаётся один раз и хранится в двух местах:
//   - в секретах репозитория на GitHub — им подписывает APK сборка на GitHub (.github/workflows/android.yml);
//   - копией в папке HYPERBOREA-android-key в домашней папке (C:\Users\<имя>\HYPERBOREA-android-key).
// Запуск: npm run android-key — создать ключ, если его ещё нет, и положить в секреты GitHub.
// «npm run release» делает это сам, если секретов ещё нет.
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync, randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import forge from 'node-forge';

export const KEY_DIR = path.join(homedir(), 'HYPERBOREA-android-key');
const KEY_FILE = path.join(KEY_DIR, 'hyperborea-android.p12');
const PASSWORD_FILE = path.join(KEY_DIR, 'password.txt');
const ALIAS = 'hyperborea';
const SECRETS = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD'];

export function createKey() {
  const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 4096});
  const key = forge.pki.privateKeyFromPem(privateKey.export({type: 'pkcs1', format: 'pem'}));
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  cert.serialNumber = '01' + randomBytes(15).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 50);
  const name = [{name: 'commonName', value: 'HYPERBOREA'}, {name: 'organizationName', value: 'HYPERBOREA'}];
  cert.setSubject(name);
  cert.setIssuer(name);
  cert.sign(key, forge.md.sha256.create());

  const password = randomBytes(24).toString('base64url');
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], password, {algorithm: '3des', friendlyName: ALIAS, generateLocalKeyId: true});
  return {file: Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'), password};
}

function saveBackup({file, password}) {
  mkdirSync(KEY_DIR, {recursive: true});
  writeFileSync(KEY_FILE, file);
  writeFileSync(PASSWORD_FILE, password + '\n');
  writeFileSync(path.join(KEY_DIR, 'ПРОЧТИ.txt'), [
    'Ключ подписи приложения HYPERBOREA для Android.',
    '',
    'Не удаляйте эту папку и сохраните её копию (флешка, облако).',
    'Если ключ потеряется, новые версии не встанут поверх старой:',
    'всем придётся удалить приложение и поставить заново, а сохранённые в нём данные пропадут.',
    '',
    'Никому не пересылайте эти файлы: с ними можно выпустить поддельное обновление.',
    '',
    'Положить ключ обратно в секреты GitHub: npm run android-key',
    '',
  ].join('\r\n'));
}

function hasSecrets(gh, repo) {
  const list = execFileSync(gh, ['secret', 'list', '--repo', repo], {encoding: 'utf8'});
  const names = new Set(list.split(/\r?\n/).map(line => line.split(/\s+/)[0]));
  return SECRETS.every(name => names.has(name));
}

/** Проверяет, что ключ есть в секретах GitHub; если нет — берёт копию с компьютера или создаёт новый. */
export function ensureAndroidKey(gh, repo) {
  if (hasSecrets(gh, repo)) return;
  let key;
  if (existsSync(KEY_FILE) && existsSync(PASSWORD_FILE)) {
    key = {file: readFileSync(KEY_FILE), password: readFileSync(PASSWORD_FILE, 'utf8').trim()};
    console.log(`Беру ключ подписи Android из ${KEY_DIR}`);
  } else {
    console.log('Создаю ключ подписи для Android (один раз)…');
    key = createKey();
    saveBackup(key);
    console.log('');
    console.log('========================================================================');
    console.log(`  Ключ подписи Android сохранён в ${KEY_DIR}`);
    console.log('  Сохраните копию этой папки! Без неё обновления не встанут поверх старой версии.');
    console.log('========================================================================');
    console.log('');
  }
  execFileSync(gh, ['secret', 'set', SECRETS[0], '--repo', repo], {input: key.file.toString('base64'), stdio: ['pipe', 'inherit', 'inherit']});
  execFileSync(gh, ['secret', 'set', SECRETS[1], '--repo', repo], {input: key.password, stdio: ['pipe', 'inherit', 'inherit']});
  console.log('Ключ подписи Android добавлен в секреты репозитория на GitHub.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gh = process.env.GH_PATH ?? 'C:/Program Files/GitHub CLI/gh.exe';
  ensureAndroidKey(gh, 'Ewjpg/hyperborea-app');
  console.log('Готово.');
}
