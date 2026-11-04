// 동네 한식뷔페 오늘 메뉴 게시판 API.
// 저장 위치 (모두 한 저장소 안의 경로):
//   b/<역>/<뷔페id>-<브라우저>-<IP>.json             뷔페 (이름·주소·좌표·도보 시간)
//   br/<역>/<뷔페id>/<IP>                            뷔페 신고 (3건이면 숨김)
//   d/<날짜>/<역>/<글id>/post-<브라우저>-<IP>.json   글 본문 (어느 뷔페인지 buffetId 로 가리킴)
//   d/<날짜>/<역>/<글id>/c/<시각>-<난수>-<브라우저>-<IP>.json  댓글
//   d/<날짜>/<역>/<글id>/like/<브라우저>             맛있어요 (브라우저당 1번)
//   d/<날짜>/<역>/<글id>/report/<IP>                 신고 (IP 당 1번, 3건이면 숨김)
//   p/<글id>-<난수>.jpg                               사진
// 글은 오늘 포함 8일치(오늘 + 지난 7일)만 보여 주고, 매일 밤 그보다 오래된 글·사진은 지운다.
// 브라우저 식별값과 IP 는 소금 친 해시로만 저장하고, 응답에는 넣지 않는다.
import crypto from 'node:crypto';
import { STATIONS, STATION_BY_ID } from './stations.js';
import * as realGeo from './geo.js';

const REPORT_LIMIT = 3;
const POSTS_PER_MIN = 3;
const COMMENTS_PER_MIN = 6;
const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
const KEEP_DAYS = 7;
const BUFFETS_PER_10MIN = 3;
const MAX_STRAIGHT_M = 2500;
const LIM = { buffetName: 30, address: 100, nick: 20, menuLines: 30, menuLine: 40, price: 30, note: 300, comment: 200 };

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function kstDate(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9]{8,32}$/;
const CKEY_RE = /^[a-z0-9]{6,40}$/;
const BID_RE = /^[a-z0-9]{8,32}$/;

class HttpError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }
const bad = msg => new HttpError(400, msg);
function stationOf(id) { const s = STATION_BY_ID.get(id); if (!s) throw bad('역을 골라 주세요'); return s; }

function cleanText(v, max, field, required) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw bad(field + ' 형식이 맞지 않아요');
  // 제어 문자 제거(줄바꿈은 남김), 앞뒤 공백 정리
  v = v.replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '').replace(/\r\n?/g, '\n').trim();
  if (required && !v) throw bad(field + '을(를) 적어 주세요');
  if ([...v].length > max) throw bad(`${field}은(는) ${max}자까지 적을 수 있어요`);
  return v;
}

export function createApp({ store, salt, adminPassword, cronSecret, allowedOrigins, geo = realGeo, now = () => Date.now() }) {
  if (!salt) salt = 'buffet-default-salt';
  const h = v => crypto.createHash('sha256').update(salt + '|' + v).digest('hex').slice(0, 16);
  const rid = n => crypto.randomBytes(n).toString('hex');
  const newId = () => now().toString(36) + rid(4);
  // 오늘(한국 시간)부터 7일 전까지만 볼 수 있다
  function checkDate(date) {
    if (!DATE_RE.test(date || '')) throw bad('날짜가 맞지 않아요');
    const today = kstDate(now());
    if (date > today || date < addDays(today, -KEEP_DAYS)) throw new HttpError(404, '지난 메뉴는 7일까지만 볼 수 있어요');
    return date;
  }

  async function loadBuffets(station, { includeHidden = false } = {}) {
    const [blobs, reps] = await Promise.all([store.list(`b/${station}/`), store.list(`br/${station}/`)]);
    const reportCount = new Map();
    for (const r of reps) { const id = r.pathname.split('/')[2]; reportCount.set(id, (reportCount.get(id) || 0) + 1); }
    const out = await Promise.all(blobs.map(async b => {
      const [id, cid, ip] = b.pathname.split('/')[2].replace(/\.json$/, '').split('-');
      const reports = reportCount.get(id) || 0;
      if (reports >= REPORT_LIMIT && !includeHidden) return null;
      const j = await store.getJSON(b.url);
      return { id, name: j.name, address: j.address, walkMin: j.walkMin, meters: j.meters, via: j.via,
               cid, ip, at: j.at, blob: b, ...(includeHidden ? { hidden: reports >= REPORT_LIMIT, reports } : {}) };
    }));
    return out.filter(Boolean).sort((a, b) => a.walkMin - b.walkMin || a.name.localeCompare(b.name, 'ko'));
  }
  const publicBuffet = b => { const { cid, ip, blob, ...rest } = b; return rest; };

  function who(req) {
    const cid = (req.headers.get('x-client-id') || '').slice(0, 64);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(cid)) throw bad('브라우저 식별값이 없어요. 새로고침해 주세요');
    const ip = (req.headers.get('x-real-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || 'local').trim();
    return { cid: h('c:' + cid), ip: h('i:' + ip) };
  }

  async function readJson(req) {
    const t = await req.text();
    if (t.length > 2.2 * 1024 * 1024) throw new HttpError(413, '보내는 내용이 너무 커요');
    try { const v = JSON.parse(t); if (v && typeof v === 'object') return v; } catch {}
    throw bad('보낸 내용을 읽지 못했어요');
  }

  // 하루치 저장 목록을 글 단위로 묶는다
  async function loadDay(date, station) {
    const blobs = await store.list(`d/${date}/${station}/`);
    const posts = new Map();
    const get = id => { if (!posts.has(id)) posts.set(id, { id, post: null, comments: [], likes: 0, reports: 0, at: 0 }); return posts.get(id); };
    for (const b of blobs) {
      const parts = b.pathname.split('/').slice(1); // date, station, id, ... → 아래에서 station 을 빼고 본다
      parts.splice(1, 1);
      parts.unshift('d');
      if (parts.length < 4) continue;
      const g = get(parts[2]);
      const rest = parts.slice(3);
      if (rest.length === 1 && rest[0].startsWith('post-')) {
        const [, cid, ip] = rest[0].replace(/\.json$/, '').split('-');
        g.post = b; g.cid = cid; g.ip = ip; g.at = parseInt(g.id.slice(0, -8), 36);
      } else if (rest[0] === 'c' && rest.length === 2) {
        const [ts, r, cid, ip] = rest[1].replace(/\.json$/, '').split('-');
        g.comments.push({ blob: b, key: ts + r, cid, ip, at: parseInt(ts, 36) });
      } else if (rest[0] === 'like') g.likes++;
      else if (rest[0] === 'report') g.reports++;
    }
    return [...posts.values()].filter(g => g.post);
  }

  async function render(groups, { includeHidden = false } = {}) {
    const out = [];
    await Promise.all(groups.map(async g => {
      const hidden = g.reports >= REPORT_LIMIT;
      if (hidden && !includeHidden) return;
      const p = await store.getJSON(g.post.url);
      const comments = await Promise.all(g.comments.sort((a, b) => a.at - b.at).map(async c => {
        const j = await store.getJSON(c.blob.url);
        return { key: c.key, nick: j.nick, text: j.text, at: j.at };
      }));
      out.push({ id: g.id, buffetId: p.buffetId, date: p.date, at: p.at, nick: p.nick, menu: p.menu, price: p.price, note: p.note, photo: p.photo || null,
                 likes: g.likes, comments, ...(includeHidden ? { hidden, reports: g.reports } : {}) });
    }));
    return out.sort((a, b) => b.at - a.at);
  }

  async function findPost(date, station, postId) {
    checkDate(date);
    stationOf(station);
    if (!ID_RE.test(postId || '')) throw bad('글 번호가 맞지 않아요');
    const base = `d/${date}/${station}/${postId}/`;
    const blobs = (await store.list(base)).map(b => ({ ...b, rel: b.pathname.slice(base.length).split('/') }));
    const post = blobs.find(b => b.rel.length === 1 && /^post-/.test(b.rel[0]));
    if (!post) throw new HttpError(404, '글을 찾지 못했어요');
    return { blobs, post, base, reports: blobs.filter(b => b.rel[0] === 'report').length };
  }

  const routes = {
    async stations() {
      return { stations: STATIONS.map(({ id, name, area }) => ({ id, name, area })) };
    },

    async days() {
      const today = kstDate(now());
      return { today, dates: Array.from({ length: KEEP_DAYS + 1 }, (_, i) => addDays(today, -i)) };
    },

    async day(req) {
      const q = new URL(req.url).searchParams;
      const station = stationOf(q.get('station')).id;
      const date = checkDate(q.get('date') || kstDate(now()));
      const [buffets, groups] = await Promise.all([loadBuffets(station), loadDay(date, station)]);
      const ok = new Set(buffets.map(b => b.id));
      const posts = (await render(groups)).filter(p => ok.has(p.buffetId));
      return { date, today: kstDate(now()), station, buffets: buffets.map(publicBuffet), posts };
    },

    async buffet(req) {
      const me = who(req);
      const b = await readJson(req);
      const st = stationOf(b.station);
      const name = cleanText(b.name, LIM.buffetName, '뷔페 이름', true);
      const address = cleanText(b.address, LIM.address, '주소', true);
      const t = now();
      const existing = await loadBuffets(st.id, { includeHidden: true });
      const norm = v => v.replace(/\s+/g, '').toLowerCase();
      if (existing.some(x => norm(x.name) === norm(name))) throw new HttpError(409, '이 역에 같은 이름의 뷔페가 이미 있어요');
      const mine = existing.filter(x => (x.cid === me.cid || x.ip === me.ip) && t - parseInt(x.id.slice(0, -8), 36) < 600_000);
      if (mine.length >= BUFFETS_PER_10MIN) throw new HttpError(429, '잠시 뒤에 다시 등록해 주세요');

      let meters, via, lat = null, lng = null;
      const manual = b.walkMin == null || b.walkMin === '' ? null : Number(b.walkMin);
      if (manual != null) {
        if (!Number.isInteger(manual) || manual < 1 || manual > 40) throw bad('도보 시간은 1~40분 사이로 적어 주세요');
        via = 'manual'; meters = null;
      } else {
        const pt = await geo.geocode(address, st);
        if (!pt) throw new HttpError(422, '주소로 위치를 찾지 못했어요. 도로명 주소로 다시 적거나, 역에서 걸어서 몇 분인지 직접 적어 주세요', 'geocode_failed');
        const straight = geo.haversine(st, pt);
        if (straight > MAX_STRAIGHT_M) throw new HttpError(422, `찾은 위치가 ${st.name}에서 ${(straight / 1000).toFixed(1)}km 떨어져 있어요. 주소를 확인하거나, 걸어서 몇 분인지 직접 적어 주세요`, 'geocode_far');
        const w = await geo.walkFrom(st, pt);
        meters = w.meters; via = w.via; lat = Math.round(pt.lat * 1e5) / 1e5; lng = Math.round(pt.lng * 1e5) / 1e5;
      }
      const walkMin = manual != null ? manual : geo.minutesFor(meters);
      const id = newId();
      const doc = { id, station: st.id, name, address, lat, lng, meters, walkMin, via, at: t };
      await store.put(`b/${st.id}/${id}-${me.cid}-${me.ip}.json`, JSON.stringify(doc), 'application/json');
      return { ok: true, buffet: { id, name, address, walkMin, meters, via, at: t } };
    },

    async reportBuffet(req) {
      const me = who(req);
      const b = await readJson(req);
      const st = stationOf(b.station);
      if (!BID_RE.test(b.buffetId || '')) throw bad('뷔페 번호가 맞지 않아요');
      if (!(await store.list(`b/${st.id}/${b.buffetId}-`)).length) throw new HttpError(404, '뷔페를 찾지 못했어요');
      await store.putOnce(`br/${st.id}/${b.buffetId}/${me.ip}`, '1', 'text/plain');
      return { ok: true };
    },

    async post(req) {
      const me = who(req);
      const b = await readJson(req);
      const st = stationOf(b.station);
      if (!BID_RE.test(b.buffetId || '')) throw bad('어느 뷔페인지 골라 주세요');
      const buffets = await loadBuffets(st.id);
      if (!buffets.some(x => x.id === b.buffetId)) throw bad('어느 뷔페인지 골라 주세요');
      const nick = cleanText(b.nick, LIM.nick, '별명', true);
      const menuRaw = Array.isArray(b.menu) ? b.menu.join('\n') : b.menu;
      const menu = cleanText(menuRaw, LIM.menuLines * (LIM.menuLine + 1), '메뉴', true)
        .split('\n').map(s => s.trim()).filter(Boolean);
      if (menu.length > LIM.menuLines) throw bad(`메뉴는 ${LIM.menuLines}줄까지 적을 수 있어요`);
      if (menu.some(m => [...m].length > LIM.menuLine)) throw bad(`메뉴 한 줄은 ${LIM.menuLine}자까지예요`);
      const price = cleanText(b.price, LIM.price, '가격', false);
      const note = cleanText(b.note, LIM.note, '한마디', false);

      let photoBuf = null;
      if (b.photo != null && b.photo !== '') {
        const m = typeof b.photo === 'string' && b.photo.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
        if (!m) throw bad('사진은 JPEG 로 보내야 해요');
        photoBuf = Buffer.from(m[1], 'base64');
        if (photoBuf.length > MAX_PHOTO_BYTES) throw bad('사진이 너무 커요');
        if (!(photoBuf[0] === 0xff && photoBuf[1] === 0xd8 && photoBuf[2] === 0xff)) throw bad('사진 파일이 아니에요');
      }

      const t = now();
      const date = kstDate(t);
      // 도배 검사는 역에 상관없이 그날 전체에서 본다
      const all = await store.list(`d/${date}/`);
      const recent = all.filter(x => {
        const f = x.pathname.split('/')[4] || '';
        if (!f.startsWith('post-')) return false;
        const [, cid, ip] = f.replace(/\.json$/, '').split('-');
        return (cid === me.cid || ip === me.ip) && t - parseInt(x.pathname.split('/')[3].slice(0, -8), 36) < 60_000;
      });
      if (recent.length >= POSTS_PER_MIN) throw new HttpError(429, '잠시 뒤에 다시 올려 주세요 (1분에 3개까지)');

      const id = newId();
      let photo = null;
      if (photoBuf) photo = (await store.put(`p/${id}-${rid(8)}.jpg`, photoBuf, 'image/jpeg')).url;
      const doc = { id, date, station: st.id, buffetId: b.buffetId, at: t, nick, menu, price, note, photo };
      await store.put(`d/${date}/${st.id}/${id}/post-${me.cid}-${me.ip}.json`, JSON.stringify(doc), 'application/json');
      return { ok: true, id, date };
    },

    async comment(req) {
      const me = who(req);
      const b = await readJson(req);
      const { blobs, base, reports } = await findPost(b.date, b.station, b.postId);
      if (reports >= REPORT_LIMIT) throw new HttpError(404, '글을 찾지 못했어요');
      const nick = cleanText(b.nick, LIM.nick, '별명', true);
      const text = cleanText(b.text, LIM.comment, '댓글', true);
      const t = now();
      const mine = blobs.filter(x => x.rel[0] === 'c' && x.rel.length === 2).filter(x => {
        const [ts, , cid, ip] = x.rel[1].replace(/\.json$/, '').split('-');
        return (cid === me.cid || ip === me.ip) && t - parseInt(ts, 36) < 60_000;
      });
      if (mine.length >= COMMENTS_PER_MIN) throw new HttpError(429, '잠시 뒤에 다시 달아 주세요');
      await store.put(`${base}c/${t.toString(36)}-${rid(3)}-${me.cid}-${me.ip}.json`, JSON.stringify({ nick, text, at: t }), 'application/json');
      return { ok: true };
    },

    async like(req) {
      const me = who(req);
      const b = await readJson(req);
      const { base } = await findPost(b.date, b.station, b.postId);
      await store.putOnce(`${base}like/${me.cid}`, '1', 'text/plain');
      return { ok: true };
    },

    async report(req) {
      const me = who(req);
      const b = await readJson(req);
      const { post, base } = await findPost(b.date, b.station, b.postId);
      const created = await store.putOnce(`${base}report/${me.ip}`, '1', 'text/plain');
      if (created) {
        const after = await store.list(`${base}report/`);
        if (after.length >= REPORT_LIMIT) {
          // 숨겨진 글의 사진은 주소를 아는 사람도 못 보게 지운다
          const p = await store.getJSON(post.url);
          if (p.photo) await store.del([p.photo]);
        }
      }
      return { ok: true };
    },

    // 매일 밤 Vercel Cron 이 부른다. 7일보다 오래된 글·댓글·사진을 지운다.
    async cleanup(req) {
      if (!cronSecret || req.headers.get('authorization') !== 'Bearer ' + cronSecret) throw new HttpError(401, '권한이 없어요');
      const cutoff = addDays(kstDate(now()), -KEEP_DAYS);
      const old = (await store.folders('d/')).map(f => f.split('/')[1]).filter(d => DATE_RE.test(d) && d < cutoff);
      let removed = 0;
      for (const date of old) {
        const blobs = await store.list(`d/${date}/`);
        const photos = [];
        for (const b of blobs) if (/\/post-[^/]+\.json$/.test(b.pathname)) {
          try { const p = await store.getJSON(b.url); if (p.photo) photos.push(p.photo); } catch {}
        }
        const urls = [...photos, ...blobs.map(b => b.url)];
        for (let i = 0; i < urls.length; i += 500) await store.del(urls.slice(i, i + 500));
        removed += urls.length;
      }
      return { ok: true, cutoff, dates: old, removed };
    },

    async admin(req) {
      const b = await readJson(req);
      if (!adminPassword) throw new HttpError(503, '관리자 비밀번호가 설정되지 않았어요');
      const a = crypto.createHash('sha256').update(String(b.password || '')).digest();
      const e = crypto.createHash('sha256').update(adminPassword).digest();
      if (!crypto.timingSafeEqual(a, e)) { await new Promise(r => setTimeout(r, 800)); throw new HttpError(403, '비밀번호가 틀려요'); }
      if (b.action === 'check') return { ok: true };
      if (b.action === 'list') {
        const station = stationOf(b.station).id;
        const date = checkDate(b.date || kstDate(now()));
        const [buffets, groups] = await Promise.all([loadBuffets(station, { includeHidden: true }), loadDay(date, station)]);
        return { date, today: kstDate(now()), station, buffets: buffets.map(publicBuffet), posts: await render(groups, { includeHidden: true }) };
      }
      if (b.action === 'deletePost') {
        const { blobs, post } = await findPost(b.date, b.station, b.postId);
        const p = await store.getJSON(post.url);
        await store.del([...(p.photo ? [p.photo] : []), ...blobs.map(x => x.url)]);
        return { ok: true };
      }
      if (b.action === 'deleteComment') {
        const { blobs } = await findPost(b.date, b.station, b.postId);
        if (!CKEY_RE.test(b.commentKey || '')) throw bad('댓글 번호가 맞지 않아요');
        const c = blobs.find(x => { if (x.rel[0] !== 'c' || x.rel.length !== 2) return false; const [ts, r] = x.rel[1].split('-'); return ts + r === b.commentKey; });
        if (!c) throw new HttpError(404, '댓글을 찾지 못했어요');
        await store.del([c.url]);
        return { ok: true };
      }
      if (b.action === 'deleteBuffet') {
        const st = stationOf(b.station);
        if (!BID_RE.test(b.buffetId || '')) throw bad('뷔페 번호가 맞지 않아요');
        const blobs = [...await store.list(`b/${st.id}/${b.buffetId}-`), ...await store.list(`br/${st.id}/${b.buffetId}/`)];
        if (!blobs.length) throw new HttpError(404, '뷔페를 찾지 못했어요');
        await store.del(blobs.map(x => x.url));
        return { ok: true };
      }
      throw bad('알 수 없는 요청이에요');
    },
  };

  const METHOD = { stations: 'GET', days: 'GET', day: 'GET', buffet: 'POST', reportBuffet: 'POST', post: 'POST', comment: 'POST', like: 'POST', report: 'POST', admin: 'POST', cleanup: 'GET' };
  const CACHE = { stations: 'public, s-maxage=3600, stale-while-revalidate=86400', days: 'public, s-maxage=60', day: 'public, s-maxage=10, stale-while-revalidate=30' };

  return async function handle(name, req) {
    const origin = req.headers.get('origin');
    const cors = {};
    if (origin && allowedOrigins.includes(origin)) {
      cors['Access-Control-Allow-Origin'] = origin;
      cors['Vary'] = 'Origin';
    }
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, x-client-id', 'Access-Control-Max-Age': '86400' } });
    }
    const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra } });
    try {
      if (!routes[name] || req.method !== METHOD[name]) throw new HttpError(405, '허용되지 않는 요청이에요');
      const body = await routes[name](req);
      return json(200, body, { 'Cache-Control': CACHE[name] || 'no-store' });
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message, ...(e.code ? { code: e.code } : {}) }, { 'Cache-Control': 'no-store' });
      console.error(e);
      return json(500, { error: '서버에 문제가 생겼어요. 잠시 뒤 다시 해 주세요' }, { 'Cache-Control': 'no-store' });
    }
  };
}
