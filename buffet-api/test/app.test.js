import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, kstDate } from '../lib/app.js';
import { fsStore } from '../lib/store-fs.js';

const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
async function setup(nowRef = { t: Date.parse('2026-11-04T03:00:00Z') }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'buffet-'));
  const store = fsStore(dir, 'http://blob.test');
  const handle = createApp({ store, salt: 's', adminPassword: 'pw-123', allowedOrigins: ['https://ella16.github.io'], now: () => nowRef.t });
  const call = async (name, { body, cid = 'browser-aaaaaaaaaaaaaa', ip = '1.1.1.1', query = '', method, origin } = {}) => {
    const headers = { 'x-client-id': cid, 'x-real-ip': ip, 'content-type': 'application/json' };
    if (origin) headers.origin = origin;
    const r = await handle(name, new Request('http://x/api/' + name + query, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, headers: r.headers, json: r.status === 204 ? null : await r.json() };
  };
  return { call, dir, store, nowRef };
}

test('KST 날짜: UTC 15시는 다음 날', () => {
  assert.equal(kstDate(Date.parse('2026-11-04T14:59:00Z')), '2026-11-04');
  assert.equal(kstDate(Date.parse('2026-11-04T15:00:00Z')), '2026-11-05');
});

test('글 올리고 읽기, 사진, 댓글, 맛있어요 중복 방지', async () => {
  const { call } = await setup();
  const r = await call('post', { body: { nick: '이웃', menu: '제육\n\n 잡채 \n', price: '9000원', note: '<script>alert(1)</script>', photo: JPEG } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.date, '2026-11-04');
  let d = await call('day', { query: '?date=2026-11-04' });
  assert.equal(d.json.posts.length, 1);
  const p = d.json.posts[0];
  assert.deepEqual(p.menu, ['제육', '잡채']);
  assert.equal(p.note, '<script>alert(1)</script>');
  assert.match(p.photo, /^http:\/\/blob\.test\/p\/.+\.jpg$/);
  assert.ok(!JSON.stringify(d.json).includes('post-'), '저장 경로(식별 해시)가 응답에 나오지 않음');
  await call('like', { body: { date: p.date, postId: p.id } });
  await call('like', { body: { date: p.date, postId: p.id } });
  await call('like', { body: { date: p.date, postId: p.id }, cid: 'browser-bbbbbbbbbbbbbb' });
  const c = await call('comment', { body: { date: p.date, postId: p.id, nick: '옆집', text: '맛있겠다' } });
  assert.equal(c.status, 200);
  d = await call('day', { query: '?date=2026-11-04' });
  assert.equal(d.json.posts[0].likes, 2);
  assert.equal(d.json.posts[0].comments[0].text, '맛있겠다');
  assert.equal(d.headers.get('cache-control'), 'public, s-maxage=10, stale-while-revalidate=30');
  const days = await call('days');
  assert.deepEqual(days.json.dates, ['2026-11-04']);
});

test('입력 검사', async () => {
  const { call } = await setup();
  assert.equal((await call('post', { body: { nick: '', menu: '밥' } })).status, 400);
  assert.equal((await call('post', { body: { nick: 'a', menu: '' } })).status, 400);
  assert.equal((await call('post', { body: { nick: 'a'.repeat(21), menu: '밥' } })).status, 400);
  assert.equal((await call('post', { body: { nick: 'a', menu: 'x'.repeat(41) } })).status, 400);
  assert.equal((await call('post', { body: { nick: 'a', menu: '밥', photo: 'data:image/png;base64,AAAA' } })).status, 400);
  assert.equal((await call('post', { body: { nick: 'a', menu: '밥', photo: 'data:image/jpeg;base64,' + Buffer.from('GIF89a').toString('base64') } })).status, 400);
  assert.equal((await call('post', { body: { nick: 'a', menu: '밥' }, cid: 'short' })).status, 400);
  assert.equal((await call('day', { query: '?date=../../x' })).status, 400);
  assert.equal((await call('like', { body: { date: '2026-11-04', postId: '../../../etc' } })).status, 400);
  assert.equal((await call('like', { body: { date: '2026-11-04', postId: 'abcdefgh1234' } })).status, 404);
  assert.equal((await call('post', { method: 'GET' })).status, 405);
  assert.equal((await call('nope')).status, 405);
});

test('1분에 글 3개까지, 다른 IP·브라우저로 바꿔도 하나가 같으면 막힘', async () => {
  const { call, nowRef } = await setup();
  for (let i = 0; i < 3; i++) assert.equal((await call('post', { body: { nick: 'a', menu: '밥' + i } })).status, 200);
  assert.equal((await call('post', { body: { nick: 'a', menu: '밥' } })).status, 429);
  assert.equal((await call('post', { body: { nick: 'a', menu: '밥' }, cid: 'browser-zzzzzzzzzzzzzz' })).status, 429);
  assert.equal((await call('post', { body: { nick: 'a', menu: '밥' }, cid: 'browser-zzzzzzzzzzzzzz', ip: '2.2.2.2' })).status, 200);
  nowRef.t += 61_000;
  assert.equal((await call('post', { body: { nick: 'a', menu: '밥' } })).status, 200);
});

test('신고 3건(IP 기준)이면 숨기고 사진도 지움', async () => {
  const { call, dir } = await setup();
  const { json: { id, date } } = await call('post', { body: { nick: 'a', menu: '밥', photo: JPEG } });
  const photo = (await call('day', { query: '?date=' + date })).json.posts[0].photo;
  await call('report', { body: { date, postId: id }, ip: '9.9.9.1' });
  await call('report', { body: { date, postId: id }, ip: '9.9.9.1', cid: 'browser-other111111111' }); // 같은 IP 는 1건
  await call('report', { body: { date, postId: id }, ip: '9.9.9.2' });
  assert.equal((await call('day', { query: '?date=' + date })).json.posts.length, 1);
  await call('report', { body: { date, postId: id }, ip: '9.9.9.3' });
  assert.equal((await call('day', { query: '?date=' + date })).json.posts.length, 0);
  await assert.rejects(fs.access(path.join(dir, photo.replace('http://blob.test/', ''))));
  assert.equal((await call('comment', { body: { date, postId: id, nick: 'x', text: 'y' } })).status, 404);
  const a = await call('admin', { body: { password: 'pw-123', action: 'list', date } });
  assert.equal(a.json.posts[0].hidden, true);
});

test('관리자: 틀린 비밀번호 거부, 글·댓글 삭제', async () => {
  const { call, dir } = await setup();
  const { json: { id, date } } = await call('post', { body: { nick: 'a', menu: '밥', photo: JPEG } });
  await call('comment', { body: { date, postId: id, nick: 'x', text: '지울 댓글' } });
  assert.equal((await call('admin', { body: { password: 'wrong', action: 'deletePost', date, postId: id } })).status, 403);
  const key = (await call('day', { query: '?date=' + date })).json.posts[0].comments[0].key;
  assert.equal((await call('admin', { body: { password: 'pw-123', action: 'deleteComment', date, postId: id, commentKey: key } })).status, 200);
  assert.equal((await call('day', { query: '?date=' + date })).json.posts[0].comments.length, 0);
  assert.equal((await call('admin', { body: { password: 'pw-123', action: 'deletePost', date, postId: id } })).status, 200);
  assert.equal((await call('day', { query: '?date=' + date })).json.posts.length, 0);
  const left = await (async function walk(d) { let n = 0; for (const e of await fs.readdir(d, { withFileTypes: true })) n += e.isDirectory() ? await walk(path.join(d, e.name)) : 1; return n; })(dir);
  assert.equal(left, 0, '사진까지 모두 지워짐');
});

test('CORS: 허용한 주소만', async () => {
  const { call } = await setup();
  assert.equal((await call('days', { origin: 'https://ella16.github.io' })).headers.get('access-control-allow-origin'), 'https://ella16.github.io');
  assert.equal((await call('days', { origin: 'https://evil.example' })).headers.get('access-control-allow-origin'), null);
  const pre = await call('post', { method: 'OPTIONS', origin: 'https://ella16.github.io' });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /x-client-id/);
});
