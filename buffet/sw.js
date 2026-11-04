// 앱 화면 파일만 저장한다. 메뉴 데이터(API)는 다른 주소라서 여기서 손대지 않고 항상 새로 받는다.
// 그래야 어제 메뉴가 오늘 메뉴처럼 보이지 않는다.
const CACHE = 'buffet-v1';
const ASSETS = ['./', './index.html', './config.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 화면 파일은 네트워크 먼저, 안 되면 저장해 둔 것.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); }
    return res;
  }).catch(() => caches.match(e.request)));
});
