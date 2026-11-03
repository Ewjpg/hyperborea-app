// HYPERBOREA для Android: этот скрипт приложение подключает первым на каждой странице сайта.
(() => {
  'use strict';

  // 1. Service worker не нужен: все файлы и так лежат внутри приложения,
  //    а его кэш после обновления приложения показывал бы старую версию сайта.
  const workers = navigator.serviceWorker;
  if (workers) {
    try {
      workers.register = () => Promise.reject(new DOMException('Service worker is not used in the app', 'NotSupportedError'));
      workers.getRegistrations().then(list => list.forEach(registration => registration.unregister())).catch(() => {});
    } catch {}
  }

  // 2. Запросы к /api/ с телом (отправка карточек) уходят на сервер через приложение:
  //    WebView не показывает приложению тело запроса, поэтому fetch передаёт его сам.
  const native = window.HyperboreaAndroid;
  if (native) {
    const nativeFetch = window.fetch.bind(window);
    const pending = new Map();
    let next = 0;

    window.__hyperboreaApiDone = (id, status, type, body) => {
      const call = pending.get(id);
      if (!call) return;
      pending.delete(id);
      if (status < 200 || status > 599) status = 502;
      const empty = status === 204 || status === 205 || status === 304;
      call.resolve(new Response(empty ? null : body, {status, headers: {'Content-Type': type}}));
    };

    window.fetch = function fetch(input, init) {
      let request;
      try {
        request = new Request(input, init);
      } catch {
        return nativeFetch(input, init);
      }
      const url = new URL(request.url);
      if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || request.method === 'GET' || request.method === 'HEAD') {
        return nativeFetch(input, init);
      }
      const signal = (init && init.signal) || request.signal;
      if (signal.aborted) return Promise.reject(signal.reason);
      return request.text().then(body => new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        const id = ++next;
        pending.set(id, {resolve});
        signal.addEventListener('abort', () => {
          if (pending.delete(id)) reject(signal.reason);
        }, {once: true});
        native.request(id, request.method, url.pathname + url.search, request.headers.get('Content-Type') || '', body);
      }));
    };
  }

  // 3. Кнопка «Назад» на телефоне работает как Escape на ПК: закрывает открытые разделы сайта.
  //    Возвращает true, если страница что-то сделала, иначе приложение уйдёт в фон.
  window.__hyperboreaBack = () => {
    const target = document.activeElement || document.body || document.documentElement;
    const init = {key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true};
    const watcher = new MutationObserver(() => {});
    watcher.observe(document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
    const prevented = !target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    const changed = watcher.takeRecords().length > 0;
    watcher.disconnect();
    return prevented || changed;
  };
})();
