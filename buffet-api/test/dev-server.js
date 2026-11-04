// 로컬 시험 서버: 8788 에 API(+ 가짜 Blob), 8787 에 사이트 정적 파일.
// node test/dev-server.js <저장 폴더>
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../lib/app.js';
import { fsStore } from '../lib/store-fs.js';
import { blobStore } from '../lib/store-blob.js';

const root = path.resolve(process.argv[2] || './.local-blob');
const API = Number(process.env.API_PORT || 8788), WEB = Number(process.env.WEB_PORT || 8787);
const site = path.resolve(new URL('../..', import.meta.url).pathname);
// STORE=blob 이면 실제 Vercel Blob (BLOB_READ_WRITE_TOKEN 필요)
const store = process.env.STORE === 'blob' ? blobStore : fsStore(root, `http://localhost:${API}/blob`);
const handle = createApp({ store, salt: 'test', adminPassword: process.env.ADMIN || 'test-admin', allowedOrigins: [`http://localhost:${WEB}`] });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.xml': 'application/xml' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${API}`);
  if (u.pathname.startsWith('/blob/')) {
    try { const b = await fs.readFile(path.join(root, decodeURIComponent(u.pathname.slice(6)))); res.writeHead(200, { 'Content-Type': types[path.extname(u.pathname)] || 'application/octet-stream' }); return res.end(b); }
    catch { res.writeHead(404); return res.end(); }
  }
  const name = u.pathname.replace(/^\/api\//, '');
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = new Request(u, { method: req.method, headers: { ...req.headers, 'x-real-ip': req.headers['x-test-ip'] || '127.0.0.1' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const out = await handle(name, r);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(API);

http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try { const b = await fs.readFile(path.join(site, p)); res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(WEB, () => console.log(`web http://localhost:${WEB}/buffet/  api http://localhost:${API}`));
