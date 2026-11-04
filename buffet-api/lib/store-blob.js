// Vercel Blob 저장소. BLOB_READ_WRITE_TOKEN 환경 변수를 쓴다(스토어를 프로젝트에 연결하면 Vercel 이 넣어 준다).
import { put, list, del } from '@vercel/blob';

export const blobStore = {
  async put(pathname, body, contentType) {
    const r = await put(pathname, body, { access: 'public', contentType, addRandomSuffix: false });
    return { url: r.url };
  },
  async putOnce(pathname, body, contentType) {
    // 같은 사람이 같은 글에 두 번 누르면 이미 있다는 오류가 나는데, 그건 괜찮다.
    try { return await this.put(pathname, body, contentType); }
    catch (e) { if (/already exists/i.test(String(e && e.message))) return null; throw e; }
  },
  async list(prefix) {
    const out = [];
    let cursor;
    do {
      const r = await list({ prefix, cursor, limit: 1000 });
      for (const b of r.blobs) out.push({ pathname: b.pathname, url: b.url, uploadedAt: new Date(b.uploadedAt).getTime() });
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    return out;
  },
  async folders(prefix) {
    const r = await list({ prefix, mode: 'folded', limit: 1000 });
    return r.folders;
  },
  async del(urls) { if (urls.length) await del(urls); },
  async getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('blob fetch ' + res.status);
    return res.json();
  },
};
