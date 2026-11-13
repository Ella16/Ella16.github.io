// 고칠 때마다 CACHE 버전을 올린다. 새 판은 받자마자 바로 자리를 넘겨받는다(기다리지 않는다).
const CACHE = 'hsk6-v14';
const ASSETS = ['./', './index.html', './exam.html', './study.html', './answers.html', './bingju-data.js', './bingju-c01.js', './bingju-c02.js', './bingju-c03.js', './bingju-c04.js', './bingju-c05.js', './bingju-c06.js', './bingju-c07.js', './bingju-c08.js', './bingju-c09.js', './bingju-c10.js',
  './exams/list.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];  // 모의고사 회차·음원은 처음 열 때 저장된다
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
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
// 페이지·문항 파일(html·js)은 인터넷 먼저: 고친 것이 바로 보인다. 인터넷이 없을 때만 저장해 둔 것을 쓴다.
// 음원·아이콘처럼 잘 안 바뀌는 큰 파일은 저장해 둔 것 먼저.
const fresh = req => fetch(req.url, { cache: 'no-cache' }).then(res => {
  if (res && res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
  return res;
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;  // 광고·글꼴 등 바깥 것은 손대지 않는다
  if (e.request.headers.has('range')) { e.respondWith(ranged(e.request)); return; }
  if (/\.(mp3|png|svg)$/.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fresh(e.request)));
    return;
  }
  e.respondWith(fresh(e.request).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
