import { createApp } from './app.js';
import { blobStore } from './store-blob.js';

const handle = createApp({
  store: blobStore,
  salt: process.env.BUFFET_SALT,
  adminPassword: process.env.BUFFET_ADMIN_PASSWORD,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'https://ella16.github.io').split(',').map(s => s.trim()),
});

export function route(name) {
  const fn = req => handle(name, req);
  return { GET: fn, POST: fn, OPTIONS: fn };
}
