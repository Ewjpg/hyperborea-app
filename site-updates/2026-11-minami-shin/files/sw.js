const CACHE = 'hyperborea-minami-shin-1';
// Music is requested only when played, rather than downloading every track on arrival.
const CORE = ['./', './index.html', './manifest.webmanifest', './fear.css', './fear-font.css', './fear.js?v=51', './fear-experience.js?v=3', './fear-experience.css?v=2', './fear-world.js?v=3', './fear-sound.js?v=3', './fear-darkness-model.mjs?v=1', './fear-stats.js?v=36', './weapon-data.mjs?v=28', './mobile.css', './mobile.js?v=37', './fear-submit.js?v=36', './fear-submit.css', './wahhiyyy.css?v=35', './roster-popout.css', './frog.css?v=34', './frog.js?v=36', './frog-audio.js?v=35', './frog-coin.js?v=34', './players-space.css?v=49', './players-space.js?v=48', './assets/frog-cutout.webp', './boot-events.css', './sound-mixer.js?v=5', './sound-mixer.css?v=3', './azure-latch.css?v=1','./tactics.css?v=27', './tactics.js?v=47', './simulation.css?v=32', './simulation.js?v=47', './sim-renderer.js?v=31', './reaction-renderer.js?v=32', './chemistry-rules.js?v=29', './pass-model.js?v=31', './vendor/three.module.min.js', './vendor/three.core.min.js', './boot-events.js?v=26', './assets/boot-crash-icon.png', './wahhiyyy.js?v=58', './kle-experience.css?v=58', './kle-experience.js?v=58', './kle-rubik.js?v=58', './kle-cube-model.mjs?v=57', './wah-puzzle-rain.js?v=35', './wah-audio.js?v=38', './wah-submit.js?v=36', './rating-model.mjs?v=36', './player-ratings.mjs?v=36', './player-ratings.css?v=36', './assets/wahhiyyy-kit-v2.webp', './assets/fear-cutout.png', './assets/bluelock-mark.svg', './icons/icon-192.png', './icons/icon-512.png', './higanbana.mjs?v=1', './swarggy.js?v=60', './swarggy.css?v=60', './player-identity.css?v=52', './profile-overview.js?v=50', './new-players.css?v=52', './new-players.js?v=52', './emiliano-audio.js?v=55', './new-players-cinematic.js?v=52', './assets/emiliano-cutout.png', './assets/yoru-cutout.png', './assets/minami-shin-manga.webp', './assets/minami-shin-color.webp'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('hyperborea-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if(new URL(event.request.url).pathname.startsWith('/api/')) return;
  // Let the browser handle audio range requests for normal media playback.
  if(event.request.headers.has('range')) return;
  if(event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      if(response.ok) event.waitUntil(caches.open(CACHE).then(cache => cache.put('./index.html', response.clone())));
      return response;
    }).catch(() => caches.open(CACHE).then(cache => cache.match('./index.html'))));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    if(cached) return cached;
    const response = await fetch(event.request);
    if(response.ok) event.waitUntil(cache.put(event.request, response.clone()));
    return response;
  }));
});



