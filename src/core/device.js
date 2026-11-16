// What this device is and what it can do: input (touch or not), GPU features the renderer leans
// on, and a quality tier that sizes every big render target. Read once at boot; everything that
// allocates something large asks here first.
//
// URL overrides: ?tier=low|medium|high, ?touch=1|0, ?f16 (force the half-float height map path,
// as on GPUs without 32-bit float filtering), ?q= and ?dpr= as before.

const params = new URLSearchParams(location.search);

/** The tiers. `scale` is where the adaptive resolution starts; `fps` the rate it tries to hold. */
export const TIERS = {
  high: {
    dpr: 1.5, samples: 4, meadow: 'high', clouds: [4096, 1024], strip: 4096, wake: 1024,
    bloomLevels: 7, rays: true, blur: 1, reflection: 0.5, riderShadow: 1024, townShadowMax: 4096,
    scale: 1, fps: [48, 58], aniso: 8,
  },
  medium: {
    dpr: 1.25, samples: 2, meadow: 'medium', clouds: [2048, 512], strip: 2048, wake: 512,
    bloomLevels: 5, rays: true, blur: 0.8, reflection: 0.35, riderShadow: 1024, townShadowMax: 2048,
    scale: 0.85, fps: [26, 50], aniso: 4,
  },
  low: {
    dpr: 1, samples: 0, meadow: 'low', clouds: [2048, 512], strip: 2048, wake: 512,
    bloomLevels: 4, rays: false, blur: 0.6, reflection: 0.25, riderShadow: 512, townShadowMax: 1024,
    scale: 0.72, fps: [24, 45], aniso: 2,
  },
};

function isTouchDevice() {
  if (params.has('touch')) return params.get('touch') !== '0';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const fine = window.matchMedia?.('(any-pointer: fine)').matches;
  // a touch laptop has a fine pointer too: give it the keyboard layout, with touch still working
  return !!coarse && !fine || (navigator.maxTouchPoints > 1 && !fine);
}

function isMobile() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod|Android|Mobile|Silk|Kindle/i.test(ua)) return true;
  // iPadOS reports itself as a Mac
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

export const Device = {
  touch: isTouchDevice(),
  mobile: isMobile(),
  ios: /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
  standalone: window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true,
  // filled in by probe()
  webgl2: false,
  floatLinear: false,
  halfFloatRT: false,
  tier: 'high',
  q: TIERS.high,
};

/** Is there WebGL2 at all? (Checked before three.js is asked for a renderer.) */
export function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ok = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch { return false; }
}

/** Look at the renderer's context and settle the tier. */
export function probe(renderer) {
  const gl = renderer.getContext();
  Device.webgl2 = true;
  Device.floatLinear = !!gl.getExtension('OES_texture_float_linear') && !params.has('f16');
  Device.halfFloatRT = !!(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
  const maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;

  let tier = params.get('tier');
  if (!TIERS[tier]) {
    if (!Device.mobile) tier = 'high';
    else {
      // phones and tablets: a big-memory, recent device gets medium, the rest low
      const mem = navigator.deviceMemory || (Device.ios ? 4 : 3);
      const cores = navigator.hardwareConcurrency || 4;
      tier = mem >= 6 && cores >= 6 ? 'medium' : 'low';
      if (Device.ios && Math.min(screen.width, screen.height) >= 744) tier = 'medium';   // iPads
    }
  }
  const q = { ...TIERS[tier] };
  q.samples = Math.min(q.samples, maxSamples);
  if (params.has('dpr')) q.dpr = Number(params.get('dpr')) || q.dpr;
  if (params.has('q')) q.meadow = params.get('q');
  Device.tier = tier;
  Device.q = q;
  return Device;
}

/** The type for HDR render targets: half float where the GPU can render to it, bytes where not. */
export function hdrType(THREE) {
  return Device.halfFloatRT ? THREE.HalfFloatType : THREE.UnsignedByteType;
}
