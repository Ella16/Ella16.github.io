// 시험용 저장소: Vercel Blob 과 같은 모양을 로컬 폴더로 흉내 낸다. 배포에는 쓰지 않는다.
import fs from 'node:fs/promises';
import path from 'node:path';

export function fsStore(root, publicBase) {
  const file = p => path.join(root, p);
  const meta = new Map();
  return {
    async put(pathname, body, contentType) {
      try { await fs.access(file(pathname)); throw new Error('This blob already exists'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await fs.mkdir(path.dirname(file(pathname)), { recursive: true });
      await fs.writeFile(file(pathname), body);
      meta.set(pathname, Date.now());
      return { url: publicBase + '/' + pathname };
    },
    async putOnce(pathname, body, ct) {
      try { return await this.put(pathname, body, ct); }
      catch (e) { if (/already exists/i.test(e.message)) return null; throw e; }
    },
    async list(prefix) {
      const out = [];
      async function walk(dir) {
        let ents; try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) await walk(full);
          else {
            const pathname = path.relative(root, full).split(path.sep).join('/');
            if (pathname.startsWith(prefix)) out.push({ pathname, url: publicBase + '/' + pathname, uploadedAt: meta.get(pathname) || (await fs.stat(full)).mtimeMs });
          }
        }
      }
      await walk(root);
      return out;
    },
    async folders(prefix) {
      try { return (await fs.readdir(file(prefix), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => prefix + e.name + '/'); }
      catch { return []; }
    },
    async del(urls) {
      for (const u of urls) { const p = u.slice(publicBase.length + 1); await fs.rm(file(p), { force: true }); meta.delete(p); }
    },
    async getJSON(url) { return JSON.parse(await fs.readFile(file(url.slice(publicBase.length + 1)), 'utf8')); },
  };
}
