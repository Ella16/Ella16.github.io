// 고칠 때마다 CACHE 버전을 올린다. 그래야 설치한 앱에 '업데이트' 버튼이 켜진다.
const CACHE = 'hsk6-v1';
const ASSETS = ['./', './index.html', './answers.html', './data.js', './vocab.js', './audio/chapters.js',
  './audio/hsk6-listening.mp3', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
// 새 판은 바로 끼어들지 않고 기다린다. '업데이트'를 누르면 그때 자리를 넘겨받는다.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 음원은 브라우저가 구간(Range)으로 달라고 한다. 캐시에 통째로 있으면 그 구간만 잘라 206 으로 준다(오프라인에서도 듣고 넘기기).
async function ranged(req) {
  const hit = await caches.match(req.url);
  if (!hit) return fetch(req);
  const buf = await hit.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  const start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' }
  });
}
// 캐시 먼저, 새 것은 뒤에서 받아 둔다. 바뀐 게 있으면 다음에 켤 때 쓰인다.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;  // 광고·글꼴 등 바깥 것은 손대지 않는다
  if (e.request.headers.has('range')) { e.respondWith(ranged(e.request)); return; }
  e.respondWith(
    caches.match(e.request).then(hit => {
      const fresh = fetch(e.request).then(res => {
        if (res && res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || fresh;
    })
  );
});
