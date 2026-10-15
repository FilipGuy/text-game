/* =====================================================================
 *  ISLAND — a first-person ASCII island explorer
 *  Single-file, dependency-free. Sections:
 *   10 core (rng / hash / noise / math)      50 renderer (ASCII perspective)
 *   20 world generation (geography)          60 map
 *   25 mountain visibility guarantee         70 atmosphere (day/night, weather, audio, life)
 *   30 chunks (local scenery)                80 game (menus, settings, loop)
 *   40 player (movement / collision)
 * ===================================================================== */

// ----------------------------------------------------------------- math
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const fract = (x) => x - Math.floor(x);

// ----------------------------------------------------------------- seed hashing / RNG
// cyrb128: string -> 4x32bit
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}
// sfc32 PRNG
function sfc32(a, b, c, d) {
  return function () {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = (c << 21 | c >>> 11);
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
}
class RNG {
  constructor(seedStr) {
    const s = cyrb128(String(seedStr));
    this.next = sfc32(s[0], s[1], s[2], s[3]);
    for (let i = 0; i < 12; i++) this.next();
  }
  float() { return this.next(); }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
}
// integer coordinate hash -> [0,1)
function hash2(seed, x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function hash3(seed, x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647 ^ 0x27d4eb2d) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ----------------------------------------------------------------- noise
// Seeded 2D gradient noise (Perlin-style) + fBm + ridged
class Noise2D {
  constructor(rng) {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rng.float() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.gx = new Float32Array(256); this.gz = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const a = rng.float() * TAU; this.gx[i] = Math.cos(a); this.gz[i] = Math.sin(a); }
  }
  // returns roughly [-1, 1]
  get(x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y;
    const xi = X & 255, yi = Y & 255;
    const p = this.perm;
    const g00 = p[p[xi] + yi], g10 = p[p[xi + 1] + yi], g01 = p[p[xi] + yi + 1], g11 = p[p[xi + 1] + yi + 1];
    const d00 = this.gx[g00] * xf + this.gz[g00] * yf;
    const d10 = this.gx[g10] * (xf - 1) + this.gz[g10] * yf;
    const d01 = this.gx[g01] * xf + this.gz[g01] * (yf - 1);
    const d11 = this.gx[g11] * (xf - 1) + this.gz[g11] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    return lerp(lerp(d00, d10, u), lerp(d01, d11, u), v) * 1.41;
  }
  fbm(x, y, octaves, lacunarity = 2.0, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let i = 0; i < octaves; i++) {
      sum += this.get(x * f, y * f) * amp; norm += amp; amp *= gain; f *= lacunarity;
    }
    return sum / norm;
  }
  ridged(x, y, octaves) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.get(x * f, y * f)); sum += n * n * amp; norm += amp; amp *= 0.5; f *= 2.1;
    }
    return sum / norm;
  }
}

// ----------------------------------------------------------------- colors
// Colors are packed ints 0xRRGGBB
const rgb = (r, g, b) => ((clamp(r, 0, 255) | 0) << 16) | ((clamp(g, 0, 255) | 0) << 8) | (clamp(b, 0, 255) | 0);
function mixColor(a, b, t) {
  if (t <= 0) return a; if (t >= 1) return b;
  const ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255;
  const br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
  return ((ar + (br - ar) * t) << 16 | (ag + (bg - ag) * t) << 8 | (ab + (bb - ab) * t)) >>> 0 & 0xffffff;
}
function scaleColor(c, s) {
  let r = (c >> 16 & 255) * s, g = (c >> 8 & 255) * s, b = (c & 255) * s;
  if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
  return (r << 16 | g << 8 | b) >>> 0 & 0xffffff;
}
// multiply color by light color (0xRRGGBB used as per-channel multipliers /255) and scalar
function lightColor(c, lightRGB, s) {
  let r = (c >> 16 & 255) * (lightRGB >> 16 & 255) / 255 * s;
  let g = (c >> 8 & 255) * (lightRGB >> 8 & 255) / 255 * s;
  let b = (c & 255) * (lightRGB & 255) / 255 * s;
  if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
  return (r << 16 | g << 8 | b) >>> 0 & 0xffffff;
}
const cssColor = (c) => '#' + (c & 0xffffff).toString(16).padStart(6, '0');

// ----------------------------------------------------------------- async yield for loading
const nextTick = () => new Promise(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));
