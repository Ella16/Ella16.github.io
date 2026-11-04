import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, kstDate, addDays } from '../lib/app.js';
import { fsStore } from '../lib/store-fs.js';
import { haversine, minutesFor, addressVariants } from '../lib/geo.js';

const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
const GANGNAM = { lat: 37.49795, lng: 127.02763 };
// 가짜 주소 검색: '먼곳' 이 들어가면 5km 밖, '없는' 이면 못 찾음, 나머지는 강남역에서 동쪽 400m
const fakeGeo = {
  haversine, minutesFor,
  async geocode(addr, st) {
    if (/없는/.test(addr)) return null;
    if (/먼곳/.test(addr)) return { lat: st.lat + 0.045, lng: st.lng };
    return { lat: st.lat, lng: st.lng + 400 / (111320 * Math.cos(st.lat * Math.PI / 180)) };
  },
  async walkFrom(st, pt) { return { meters: Math.round(haversine(st, pt) * 1.25), via: 'route' }; },
};

async function setup(nowRef = { t: Date.parse('2026-11-04T03:00:00Z') }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'buffet-'));
  const store = fsStore(dir, 'http://blob.test');
  const handle = createApp({ store, salt: 's', adminPassword: 'pw-123', cronSecret: 'cron-1', allowedOrigins: ['https://ella16.github.io'], geo: fakeGeo, now: () => nowRef.t });
  const call = async (name, { body, cid = 'browser-aaaaaaaaaaaaaa', ip = '1.1.1.1', query = '', method, origin, auth } = {}) => {
    const headers = { 'x-client-id': cid, 'x-real-ip': ip, 'content-type': 'application/json' };
    if (origin) headers.origin = origin;
    if (auth) headers.authorization = auth;
    const r = await handle(name, new Request('http://x/api/' + name + query, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, headers: r.headers, json: r.status === 204 ? null : await r.json() };
  };
  const addBuffet = async (name = '맛있는집', extra = {}) => {
    const r = await call('buffet', { body: { station: 'gangnam', name, address: '서울 강남구 테헤란로 1', ...extra }, ...extra.opts });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.buffet;
  };
  const day = async (q = '') => (await call('day', { query: '?station=gangnam' + q })).json;
  return { call, dir, store, nowRef, addBuffet, day };
}

test('날짜 계산', () => {
  assert.equal(kstDate(Date.parse('2026-11-04T14:59:00Z')), '2026-11-04');
  assert.equal(kstDate(Date.parse('2026-11-04T15:00:00Z')), '2026-11-05');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-11-04', -7), '2026-10-28');
});

test('주소 정리와 도보 시간', () => {
  assert.deepEqual(addressVariants('서울 강남구 테헤란로 152 (역삼동) 지하1층'), ['서울 강남구 테헤란로 152 지하1층', '서울 강남구 테헤란로 152']);
  assert.equal(minutesFor(0), 1);
  assert.equal(minutesFor(670), 10);
  assert.equal(minutesFor(671), 11);
  assert.ok(Math.abs(haversine(GANGNAM, { lat: 37.50064, lng: 127.03646 }) - 840) < 30, '강남역-역삼역 약 840m');
});

test('역 목록', async () => {
  const { call } = await setup();
  const r = await call('stations');
  assert.ok(r.json.stations.some(s => s.id === 'gangnam' && s.name === '강남역'));
  assert.ok(!('lat' in r.json.stations[0]));
});

test('뷔페 등록: 주소로 도보 시간, 못 찾으면 직접 입력, 중복·먼 곳 거부', async () => {
  const { call, addBuffet, day } = await setup();
  const b = await addBuffet();
  assert.ok(Math.abs(b.meters - 500) <= 2); assert.equal(b.walkMin, 8); assert.equal(b.via, 'route');
  assert.equal((await call('buffet', { body: { station: 'gangnam', name: '맛있는 집', address: 'x' } })).status, 409);
  const nf = await call('buffet', { body: { station: 'gangnam', name: '두번째', address: '없는 주소' } });
  assert.equal(nf.status, 422); assert.equal(nf.json.code, 'geocode_failed');
  const far = await call('buffet', { body: { station: 'gangnam', name: '두번째', address: '먼곳 1' } });
  assert.equal(far.status, 422); assert.equal(far.json.code, 'geocode_far');
  assert.equal((await call('buffet', { body: { station: 'gangnam', name: '두번째', address: '없는 주소', walkMin: 0 } })).status, 400);
  const m = await call('buffet', { body: { station: 'gangnam', name: '두번째', address: '없는 주소', walkMin: 3 } });
  assert.equal(m.json.buffet.via, 'manual');
  assert.equal((await call('buffet', { body: { station: 'nowhere', name: 'a', address: 'b' } })).status, 400);
  const d = await day();
  assert.deepEqual(d.buffets.map(x => [x.name, x.walkMin]), [['두번째', 3], ['맛있는집', 8]], '가까운 순');
  assert.ok(!JSON.stringify(d).match(/"cid"|"ip"/));
  // 10분에 3개까지
  assert.equal((await call('buffet', { body: { station: 'gangnam', name: '세번째', address: 'a' } })).status, 200);
  assert.equal((await call('buffet', { body: { station: 'gangnam', name: '네번째', address: 'a' } })).status, 429);
});

test('글: 뷔페를 골라야 하고, 역별로 나뉨, 사진·댓글·맛있어요', async () => {
  const { call, addBuffet, day } = await setup();
  const b = await addBuffet();
  assert.equal((await call('post', { body: { station: 'gangnam', nick: 'a', menu: '밥' } })).status, 400);
  assert.equal((await call('post', { body: { station: 'yeoksam', buffetId: b.id, nick: 'a', menu: '밥' } })).status, 400, '다른 역 뷔페');
  const r = await call('post', { body: { station: 'gangnam', buffetId: b.id, nick: '이웃', menu: '제육\n\n 잡채 ', note: '<script>x</script>', photo: JPEG } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let d = await day();
  assert.equal(d.posts.length, 1);
  const p = d.posts[0];
  assert.equal(p.buffetId, b.id); assert.deepEqual(p.menu, ['제육', '잡채']); assert.equal(p.note, '<script>x</script>');
  assert.equal((await call('day', { query: '?station=yeoksam' })).json.posts.length, 0);
  await call('like', { body: { date: p.date, station: 'gangnam', postId: p.id } });
  await call('like', { body: { date: p.date, station: 'gangnam', postId: p.id } });
  assert.equal((await call('like', { body: { date: p.date, station: 'yeoksam', postId: p.id } })).status, 404);
  await call('comment', { body: { date: p.date, station: 'gangnam', postId: p.id, nick: '옆집', text: '굿' } });
  d = await day();
  assert.equal(d.posts[0].likes, 1); assert.equal(d.posts[0].comments[0].text, '굿');
});

test('지난 메뉴는 7일까지만', async () => {
  const { call, addBuffet, nowRef, day } = await setup();
  const b = await addBuffet();
  const r = await call('post', { body: { station: 'gangnam', buffetId: b.id, nick: 'a', menu: '밥' } });
  const days = (await call('days')).json.dates;
  assert.equal(days.length, 8); assert.equal(days[0], '2026-11-04'); assert.equal(days[7], '2026-10-28');
  nowRef.t += 7 * 86400_000;
  assert.equal((await day('&date=2026-11-04')).posts.length, 1, '7일 뒤에도 보임');
  assert.equal((await call('like', { body: { date: r.json.date, station: 'gangnam', postId: r.json.id } })).status, 200);
  nowRef.t += 86400_000;
  assert.equal((await call('day', { query: '?station=gangnam&date=2026-11-04' })).status, 404, '8일 지나면 안 보임');
  assert.equal((await call('day', { query: '?station=gangnam&date=2026-12-30' })).status, 404, '앞날짜도 안 됨');
});

test('밤 정리: 7일 넘은 글과 사진을 지우고 뷔페는 남김', async () => {
  const { call, addBuffet, nowRef, dir } = await setup();
  const b = await addBuffet();
  await call('post', { body: { station: 'gangnam', buffetId: b.id, nick: 'a', menu: '밥', photo: JPEG } });
  assert.equal((await call('cleanup')).status, 401);
  assert.equal((await call('cleanup', { auth: 'Bearer wrong' })).status, 401);
  assert.deepEqual((await call('cleanup', { auth: 'Bearer cron-1' })).json.dates, []);
  nowRef.t += 8 * 86400_000;
  const c = await call('cleanup', { auth: 'Bearer cron-1' });
  assert.deepEqual(c.json.dates, ['2026-11-04']); assert.equal(c.json.removed, 2);
  const files = await (async function walk(d) { let o = []; for (const e of await fs.readdir(d, { withFileTypes: true })) o = o.concat(e.isDirectory() ? await walk(path.join(d, e.name)) : [e.name]); return o; })(dir);
  assert.equal(files.length, 1); assert.match(files[0], /\.json$/);
});

test('도배: 1분에 글 3개 (역이 달라도)', async () => {
  const { call, addBuffet, nowRef } = await setup();
  const b = await addBuffet();
  const b2 = (await call('buffet', { body: { station: 'yeoksam', name: 'x', address: 'a' } })).json.buffet;
  for (let i = 0; i < 2; i++) assert.equal((await call('post', { body: { station: 'gangnam', buffetId: b.id, nick: 'a', menu: '밥' } })).status, 200);
  assert.equal((await call('post', { body: { station: 'yeoksam', buffetId: b2.id, nick: 'a', menu: '밥' } })).status, 200);
  assert.equal((await call('post', { body: { station: 'yeoksam', buffetId: b2.id, nick: 'a', menu: '밥' }, cid: 'browser-zzzzzzzzzzzzzz' })).status, 429);
  nowRef.t += 61_000;
  assert.equal((await call('post', { body: { station: 'gangnam', buffetId: b.id, nick: 'a', menu: '밥' } })).status, 200);
});

test('신고 3건이면 글 숨김·사진 삭제, 뷔페도 신고 3건이면 숨김', async () => {
  const { call, addBuffet, day, dir } = await setup();
  const b = await addBuffet();
  const { json: { id, date } } = await call('post', { body: { station: 'gangnam', buffetId: b.id, nick: 'a', menu: '밥', photo: JPEG } });
  const photo = (await day()).posts[0].photo;
  for (const ip of ['9.1', '9.1', '9.2', '9.3']) await call('report', { body: { date, station: 'gangnam', postId: id }, ip });
  assert.equal((await day()).posts.length, 0);
  await assert.rejects(fs.access(path.join(dir, photo.replace('http://blob.test/', ''))));
  for (const ip of ['8.1', '8.2']) await call('reportBuffet', { body: { station: 'gangnam', buffetId: b.id }, ip });
  assert.equal((await day()).buffets.length, 1);
  await call('reportBuffet', { body: { station: 'gangnam', buffetId: b.id }, ip: '8.3' });
  assert.equal((await day()).buffets.length, 0);
  const a = await call('admin', { body: { password: 'pw-123', action: 'list', station: 'gangnam' } });
  assert.equal(a.json.buffets[0].hidden, true); assert.equal(a.json.posts[0].hidden, true);
});

test('관리자: 비밀번호, 글·댓글·뷔페 삭제', async () => {
  const { call, addBuffet, day } = await setup();
  const b = await addBuffet();
  const { json: { id, date } } = await call('post', { body: { station: 'gangnam', buffetId: b.id, nick: 'a', menu: '밥' } });
  await call('comment', { body: { date, station: 'gangnam', postId: id, nick: 'x', text: '지울 댓글' } });
  assert.equal((await call('admin', { body: { password: 'wrong', action: 'check' } })).status, 403);
  const key = (await day()).posts[0].comments[0].key;
  assert.equal((await call('admin', { body: { password: 'pw-123', action: 'deleteComment', date, station: 'gangnam', postId: id, commentKey: key } })).status, 200);
  assert.equal((await day()).posts[0].comments.length, 0);
  assert.equal((await call('admin', { body: { password: 'pw-123', action: 'deletePost', date, station: 'gangnam', postId: id } })).status, 200);
  assert.equal((await day()).posts.length, 0);
  assert.equal((await call('admin', { body: { password: 'pw-123', action: 'deleteBuffet', station: 'gangnam', buffetId: b.id } })).status, 200);
  assert.equal((await day()).buffets.length, 0);
});

test('입력 검사와 CORS', async () => {
  const { call } = await setup();
  assert.equal((await call('day', { query: '?station=gangnam&date=../../x' })).status, 400);
  assert.equal((await call('day')).status, 400, '역 없음');
  assert.equal((await call('like', { body: { date: '2026-11-04', station: 'gangnam', postId: '../../etc' } })).status, 400);
  assert.equal((await call('post', { method: 'GET' })).status, 405);
  assert.equal((await call('constructor')).status, 405);
  assert.equal((await call('days', { origin: 'https://ella16.github.io' })).headers.get('access-control-allow-origin'), 'https://ella16.github.io');
  assert.equal((await call('days', { origin: 'https://evil.example' })).headers.get('access-control-allow-origin'), null);
});
