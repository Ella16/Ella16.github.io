const CACHE = 'malssum-v52';
const ASSETS = ['./', './index.html', './data.js', './manifest.webmanifest', './icon.svg',
  './icon-192.png', './icon-512.png', './icon-maskable-192.png', './icon-maskable-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
// 새 판은 바로 끼어들지 않고 기다린다. 쓰던 화면이 갑자기 새로고침되지 않게.
// 사용자가 '업데이트'를 누르면 그때 자리를 넘겨받는다.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// network-first: always fresh when online, falls back to cache offline
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const sameOrigin = new URL(e.request.url).origin === self.location.origin;
  e.respondWith(
    fetch(e.request).then(res => {
      if (sameOrigin) {  // 광고 등 외부 리소스는 캐시하지 않음
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
