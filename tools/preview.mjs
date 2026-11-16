#!/usr/bin/env node
// Serve the built game (dist/) the way a static host would: same file types and cache headers.
//
//   node tools/preview.mjs [port] [host]      default 6281 on 127.0.0.1
//
// To try it on a phone on the same network: node tools/preview.mjs 6281 0.0.0.0, then open
// http://<this computer's address>:6281 on the phone.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.argv[2]) || 6281;
const host = process.argv[3] || '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
};

http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || p.split('/').some((s) => s.startsWith('.') && s.length > 1)) throw new Error('no');
    const data = await fs.readFile(file);
    const immutable = /^\/(a|c)\//.test(p);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': data.length,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, host, () => console.log(`petalwake (dist): http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`));
