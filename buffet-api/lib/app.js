// 동네 한식뷔페 오늘 메뉴 게시판 API.
// 저장 위치 (모두 한 저장소 안의 경로):
//   d/<날짜>/<글id>/post-<브라우저>-<IP>.json   글 본문
//   d/<날짜>/<글id>/c/<시각>-<난수>-<브라우저>-<IP>.json  댓글
//   d/<날짜>/<글id>/like/<브라우저>             맛있어요 (브라우저당 1번)
//   d/<날짜>/<글id>/report/<IP>                 신고 (IP 당 1번, 3건이면 숨김)
//   p/<글id>-<난수>.jpg                          사진
// 브라우저 식별값과 IP 는 소금 친 해시로만 저장하고, 응답에는 넣지 않는다.
import crypto from 'node:crypto';

const REPORT_LIMIT = 3;
const POSTS_PER_MIN = 3;
const COMMENTS_PER_MIN = 6;
const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
const LIM = { nick: 20, menuLines: 30, menuLine: 40, price: 30, note: 300, comment: 200 };

export function kstDate(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9]{8,32}$/;
const CKEY_RE = /^[a-z0-9]{6,40}$/;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = msg => new HttpError(400, msg);

function cleanText(v, max, field, required) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw bad(field + ' 형식이 맞지 않아요');
  // 제어 문자 제거(줄바꿈은 남김), 앞뒤 공백 정리
  v = v.replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '').replace(/\r\n?/g, '\n').trim();
  if (required && !v) throw bad(field + '을(를) 적어 주세요');
  if ([...v].length > max) throw bad(`${field}은(는) ${max}자까지 적을 수 있어요`);
  return v;
}

export function createApp({ store, salt, adminPassword, allowedOrigins, now = () => Date.now() }) {
  if (!salt) salt = 'buffet-default-salt';
  const h = v => crypto.createHash('sha256').update(salt + '|' + v).digest('hex').slice(0, 16);
  const rid = n => crypto.randomBytes(n).toString('hex');
  const newId = () => now().toString(36) + rid(4);

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
  async function loadDay(date) {
    const blobs = await store.list(`d/${date}/`);
    const posts = new Map();
    const get = id => { if (!posts.has(id)) posts.set(id, { id, post: null, comments: [], likes: 0, reports: 0, at: 0 }); return posts.get(id); };
    for (const b of blobs) {
      const parts = b.pathname.split('/'); // d, date, id, ...
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
      out.push({ id: g.id, date: p.date, at: p.at, nick: p.nick, menu: p.menu, price: p.price, note: p.note, photo: p.photo || null,
                 likes: g.likes, comments, ...(includeHidden ? { hidden, reports: g.reports } : {}) });
    }));
    return out.sort((a, b) => b.at - a.at);
  }

  async function findPost(date, postId) {
    if (!DATE_RE.test(date || '')) throw bad('날짜가 맞지 않아요');
    if (!ID_RE.test(postId || '')) throw bad('글 번호가 맞지 않아요');
    const blobs = await store.list(`d/${date}/${postId}/`);
    const post = blobs.find(b => /^post-/.test(b.pathname.split('/')[3] || ''));
    if (!post) throw new HttpError(404, '글을 찾지 못했어요');
    return { blobs, post, reports: blobs.filter(b => b.pathname.split('/')[3] === 'report').length };
  }

  const routes = {
    async days() {
      const folders = await store.folders('d/');
      const dates = folders.map(f => f.split('/')[1]).filter(d => DATE_RE.test(d)).sort().reverse().slice(0, 90);
      return { today: kstDate(now()), dates };
    },

    async day(req) {
      const date = new URL(req.url).searchParams.get('date') || kstDate(now());
      if (!DATE_RE.test(date)) throw bad('날짜가 맞지 않아요');
      return { date, today: kstDate(now()), posts: await render(await loadDay(date)) };
    },

    async post(req) {
      const me = who(req);
      const b = await readJson(req);
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
      const recent = (await loadDay(date)).filter(g => (g.cid === me.cid || g.ip === me.ip) && t - g.at < 60_000);
      if (recent.length >= POSTS_PER_MIN) throw new HttpError(429, '잠시 뒤에 다시 올려 주세요 (1분에 3개까지)');

      const id = newId();
      let photo = null;
      if (photoBuf) photo = (await store.put(`p/${id}-${rid(8)}.jpg`, photoBuf, 'image/jpeg')).url;
      const doc = { id, date, at: t, nick, menu, price, note, photo };
      await store.put(`d/${date}/${id}/post-${me.cid}-${me.ip}.json`, JSON.stringify(doc), 'application/json');
      return { ok: true, id, date };
    },

    async comment(req) {
      const me = who(req);
      const b = await readJson(req);
      const { blobs, reports } = await findPost(b.date, b.postId);
      if (reports >= REPORT_LIMIT) throw new HttpError(404, '글을 찾지 못했어요');
      const nick = cleanText(b.nick, LIM.nick, '별명', true);
      const text = cleanText(b.text, LIM.comment, '댓글', true);
      const t = now();
      const mine = blobs.filter(x => x.pathname.split('/')[3] === 'c').filter(x => {
        const [ts, , cid, ip] = x.pathname.split('/')[4].replace(/\.json$/, '').split('-');
        return (cid === me.cid || ip === me.ip) && t - parseInt(ts, 36) < 60_000;
      });
      if (mine.length >= COMMENTS_PER_MIN) throw new HttpError(429, '잠시 뒤에 다시 달아 주세요');
      await store.put(`d/${b.date}/${b.postId}/c/${t.toString(36)}-${rid(3)}-${me.cid}-${me.ip}.json`,
        JSON.stringify({ nick, text, at: t }), 'application/json');
      return { ok: true };
    },

    async like(req) {
      const me = who(req);
      const b = await readJson(req);
      await findPost(b.date, b.postId);
      await store.putOnce(`d/${b.date}/${b.postId}/like/${me.cid}`, '1', 'text/plain');
      return { ok: true };
    },

    async report(req) {
      const me = who(req);
      const b = await readJson(req);
      const { post } = await findPost(b.date, b.postId);
      const created = await store.putOnce(`d/${b.date}/${b.postId}/report/${me.ip}`, '1', 'text/plain');
      if (created) {
        const after = await store.list(`d/${b.date}/${b.postId}/report/`);
        if (after.length >= REPORT_LIMIT) {
          // 숨겨진 글의 사진은 주소를 아는 사람도 못 보게 지운다
          const p = await store.getJSON(post.url);
          if (p.photo) await store.del([p.photo]);
        }
      }
      return { ok: true };
    },

    async admin(req) {
      const b = await readJson(req);
      if (!adminPassword) throw new HttpError(503, '관리자 비밀번호가 설정되지 않았어요');
      const a = crypto.createHash('sha256').update(String(b.password || '')).digest();
      const e = crypto.createHash('sha256').update(adminPassword).digest();
      if (!crypto.timingSafeEqual(a, e)) { await new Promise(r => setTimeout(r, 800)); throw new HttpError(403, '비밀번호가 틀려요'); }
      if (b.action === 'check') return { ok: true };
      if (b.action === 'list') {
        const date = b.date || kstDate(now());
        if (!DATE_RE.test(date)) throw bad('날짜가 맞지 않아요');
        return { date, posts: await render(await loadDay(date), { includeHidden: true }) };
      }
      if (b.action === 'deletePost') {
        const { blobs, post } = await findPost(b.date, b.postId);
        const p = await store.getJSON(post.url);
        await store.del([...(p.photo ? [p.photo] : []), ...blobs.map(x => x.url)]);
        return { ok: true };
      }
      if (b.action === 'deleteComment') {
        const { blobs } = await findPost(b.date, b.postId);
        if (!CKEY_RE.test(b.commentKey || '')) throw bad('댓글 번호가 맞지 않아요');
        const c = blobs.find(x => { const s = x.pathname.split('/'); if (s[3] !== 'c') return false; const [ts, r] = s[4].split('-'); return ts + r === b.commentKey; });
        if (!c) throw new HttpError(404, '댓글을 찾지 못했어요');
        await store.del([c.url]);
        return { ok: true };
      }
      throw bad('알 수 없는 요청이에요');
    },
  };

  const METHOD = { days: 'GET', day: 'GET', post: 'POST', comment: 'POST', like: 'POST', report: 'POST', admin: 'POST' };
  const CACHE = { days: 'public, s-maxage=30, stale-while-revalidate=60', day: 'public, s-maxage=10, stale-while-revalidate=30' };

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
      if (e instanceof HttpError) return json(e.status, { error: e.message }, { 'Cache-Control': 'no-store' });
      console.error(e);
      return json(500, { error: '서버에 문제가 생겼어요. 잠시 뒤 다시 해 주세요' }, { 'Cache-Control': 'no-store' });
    }
  };
}
