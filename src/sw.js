/**
 * Service worker: keeps the whole app in the browser so it opens and works
 * offline. The build fills in VERSION and PRECACHE (see vite.config.ts).
 *
 * Everything is served cache-first. A new version installs in the background
 * and waits; the page offers a reload, then sends "skip-waiting".
 */
const CACHE = 'koimidi-__VERSION__';
const PRECACHE = __PRECACHE__;

const scoped = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  // bypass the HTTP cache: a stale page from it could point at assets of the previous build
  const requests = PRECACHE.map((path) => new Request(scoped(path), { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(requests)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('koimidi-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  // the page itself: always the cached shell of this version
  if (req.mode === 'navigate') {
    event.respondWith(caches.match(scoped('./'), { ignoreVary: true }).then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(
    // ignoreVary: module scripts are requested with an Origin header the precache request did not have
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          // files not precached (older font formats) are kept once fetched
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            void caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
