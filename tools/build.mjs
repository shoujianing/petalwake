#!/usr/bin/env node
// Builds a deployable copy of the game in dist/ (no dependencies beyond Node 18+).
//
//   node tools/build.mjs [--out dist] [--asset-base https://cdn.example.com/petalwake] [--no-gzip]
//
// What it does:
//   - the code (src/, vendor/) goes to c/<hash>/, one folder per version of the code, so it can be
//     cached for good and a new deploy is a new address;
//   - every file under assets/ gets a name with its own hash in it (a/terrain/height.1a2b3c4d.u16),
//     so a deploy that changes one model costs returning players one model, not 95 MB;
//   - the big binaries (.u16, .bin, .glb) are stored gzipped (.pwz) and unzipped in the browser,
//     because most static hosts do not compress application/octet-stream (this saves ~45% of the
//     download, and keeps every file under Cloudflare Pages' 25 MiB limit);
//   - index.html gets the map from old names to new and a small fetch shim (tools/deploy/shim.js),
//     and the host configs (_headers for Netlify and Cloudflare Pages) go alongside.
//
// --asset-base serves the assets from somewhere else (an object store or CDN): upload dist/a/ there.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, constants as zc } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const OUT = path.resolve(ROOT, opt('out', 'dist'));
const ASSET_BASE = (opt('asset-base', '') || '').replace(/\/+$/, '');
const GZIP = !args.includes('--no-gzip');
const GZIP_EXT = new Set(['.u16', '.bin', '.glb']);
const MAX_FILE = 25 * 1024 * 1024;   // Cloudflare Pages' per-file limit, the tightest of the usual hosts

const t0 = Date.now();
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const hash = (buf, n = 10) => createHash('sha256').update(buf).digest('hex').slice(0, n);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile()) out.push(p);
  }
  return out.sort();
}
async function put(dest, data) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, data);
}

await fs.rm(OUT, { recursive: true, force: true });

// ---------------------------------------------------------------------------------- code
const codeFiles = [...(await walk(path.join(ROOT, 'src'))), ...(await walk(path.join(ROOT, 'vendor')))];
const codeHash = createHash('sha256');
const code = [];
for (const f of codeFiles) {
  const data = await fs.readFile(f);
  codeHash.update(rel(f)).update('\0').update(data);
  code.push([f, data]);
}
const CODE = `c/${codeHash.digest('hex').slice(0, 10)}`;
let codeBytes = 0;
for (const [f, data] of code) { await put(path.join(OUT, CODE, rel(f)), data); codeBytes += data.length; }

// ---------------------------------------------------------------------------------- assets
const map = {};
let rawBytes = 0, outBytes = 0, zipped = 0;
const tooBig = [];
for (const f of await walk(path.join(ROOT, 'assets'))) {
  const r = rel(f);                                   // assets/terrain/height.u16
  const data = await fs.readFile(f);
  const ext = path.extname(r);
  const base = r.slice('assets/'.length, -ext.length || undefined);
  let body = data, name = `${base}.${hash(data, 8)}${ext}`;
  if (GZIP && GZIP_EXT.has(ext) && data.length > 64 * 1024) {
    const z = gzipSync(data, { level: 9, memLevel: 9, strategy: zc.Z_DEFAULT_STRATEGY });
    if (z.length < data.length * 0.9) { body = z; name += '.pwz'; zipped++; }
  }
  const to = `a/${name}`;
  await put(path.join(OUT, to), body);
  map[r] = ASSET_BASE ? `${ASSET_BASE}/${to}` : to;
  rawBytes += data.length; outBytes += body.length;
  if (body.length > MAX_FILE) tooBig.push(`${to} (${mb(body.length)})`);
}

// ---------------------------------------------------------------------------------- page
const shim = await fs.readFile(path.join(ROOT, 'tools/deploy/shim.js'), 'utf8');
let html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html: expected to find ${from}`);
  html = html.split(from).join(to);
};
swap('href="./src/', `href="./${CODE}/src/`);
swap('src="./src/', `src="./${CODE}/src/`);
swap('"./vendor/', `"./${CODE}/vendor/`);
const boot = `<script>window.PETALWAKE_MAP=${JSON.stringify(map)};window.PETALWAKE_BUILD=${JSON.stringify({ code: CODE, built: new Date().toISOString() })};</script>\n<script>${shim.replace(/^\/\/.*\n/gm, '')}</script>\n`;
swap('<script type="importmap">', `${boot}<script type="importmap">`);
// start fetching the code while the fonts and styles come in
html = html.replace('</head>', `<link rel="modulepreload" href="./${CODE}/vendor/three/build/three.module.js">\n<link rel="modulepreload" href="./${CODE}/src/main.js">\n</head>`);
await put(path.join(OUT, 'index.html'), html);

// ---------------------------------------------------------------------------------- the rest
for (const f of ['manifest.webmanifest', 'LICENSE', ...(await walk(path.join(ROOT, 'icons'))).map(rel)]) {
  await put(path.join(OUT, f), await fs.readFile(path.join(ROOT, f)));
}
await fs.cp(path.join(ROOT, 'tools/deploy/_headers'), path.join(OUT, '_headers'));
await put(path.join(OUT, '.nojekyll'), '');               // GitHub Pages: serve the files as they are
await put(path.join(OUT, 'version.json'), JSON.stringify({ code: CODE, assets: Object.keys(map).length, built: new Date().toISOString() }, null, 2) + '\n');

// ---------------------------------------------------------------------------------- report
console.log(`petalwake build -> ${path.relative(process.cwd(), OUT) || '.'}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
console.log(`  code    ${CODE}  ${code.length} files, ${mb(codeBytes)}`);
console.log(`  assets  ${Object.keys(map).length} files, ${mb(rawBytes)} -> ${mb(outBytes)} (${zipped} gzipped)${ASSET_BASE ? `, served from ${ASSET_BASE}` : ''}`);
if (tooBig.length) {
  console.warn(`  warning: over 25 MiB, too big for Cloudflare Pages:\n    ${tooBig.join('\n    ')}`);
}
