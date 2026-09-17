const CACHE = 'malssum-v54';
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
// 캐시 먼저, 새 것은 뒤에서 받아 둔다.
// 예전에는 켤 때마다 서버에 다녀온 다음에야 화면을 그려서, 홈 화면 앱은 그동안 시작 화면
// (안드로이드가 그리는 흰 화면)이 떠 있었다. 이제 갖고 있던 걸 바로 그리므로 그 시간이 사라진다.
// 새로 받은 건 다음에 켤 때 쓰이고, 바뀐 게 있으면 머리말의 '업데이트' 버튼이 켜진다.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;  // 광고 등 바깥 것은 손대지 않는다
  e.respondWith(
    caches.match(e.request).then(hit => {
      const fresh = fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);           // 오프라인이면 갖고 있던 것으로
      return hit || fresh;           // 갖고 있으면 그걸 먼저 보여주고, 받는 건 뒤에서
    })
  );
});
