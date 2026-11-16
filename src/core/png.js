// A small PNG decoder for the baked data maps (terrain light/splat/tint, town masks).
//
// Those maps keep data in the alpha channel (the light map's alpha is cliffness, mostly near 0).
// Browsers decode images for display, and some (Safari in particular) premultiply the colour by
// alpha whatever createImageBitmap is asked, which zeroes the baked sunlight and leaves the island
// in shadow. Decoding the bytes here gives the same values in every browser.
//
// Handles what the bake writes: 8-bit greyscale, grey+alpha, RGB and RGBA, not interlaced. Returns
// { width, height, data: Uint8Array RGBA, raw: true }, or null for anything else (the caller then
// falls back to the browser's decoder).

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodePNG(buffer) {
  if (typeof DecompressionStream !== 'function') return null;
  const u8 = new Uint8Array(buffer);
  for (let i = 0; i < 8; i++) if (u8[i] !== SIG[i]) return null;
  const dv = new DataView(buffer);
  let pos = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  let idatLen = 0;
  while (pos + 8 <= u8.length) {
    const len = dv.getUint32(pos);
    const name = String.fromCharCode(u8[pos + 4], u8[pos + 5], u8[pos + 6], u8[pos + 7]);
    const body = pos + 8;
    if (name === 'IHDR') {
      width = dv.getUint32(body); height = dv.getUint32(body + 4);
      depth = u8[body + 8]; type = u8[body + 9]; interlace = u8[body + 12];
    } else if (name === 'IDAT') {
      idat.push(u8.subarray(body, body + len)); idatLen += len;
    } else if (name === 'IEND') break;
    pos = body + len + 4;                       // (+ CRC)
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || interlace !== 0 || !channels || !width || !height) return null;

  const z = new Uint8Array(idatLen);
  for (let i = 0, o = 0; i < idat.length; o += idat[i].length, i++) z.set(idat[i], o);
  const raw = await inflate(z);

  // undo the per-row filters
  const bpp = channels, stride = width * bpp;
  const px = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0, r = 0; y < height; y++) {
    const f = raw[r++], row = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0, v = raw[r++];
      switch (f) {
        case 0: row[x] = v; break;
        case 1: row[x] = v + a; break;
        case 2: row[x] = v + b; break;
        case 3: row[x] = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          row[x] = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return null;
      }
    }
    prev = row;
  }

  if (channels === 4) return { width, height, data: px, raw: true };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const o = i * 4;
    if (channels === 3) { data[o] = px[j]; data[o + 1] = px[j + 1]; data[o + 2] = px[j + 2]; data[o + 3] = 255; }
    else { const g = px[j]; data[o] = data[o + 1] = data[o + 2] = g; data[o + 3] = channels === 2 ? px[j + 1] : 255; }
  }
  return { width, height, data, raw: true };
}
