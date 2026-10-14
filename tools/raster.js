/* A tiny software 2D canvas, enough of the API for Ant Farm's renderer.
   Lets us rasterise real frames under Node and eyeball them. */
'use strict';

function parseColor(str) {
  if (typeof str !== 'string') return [255, 0, 255, 1];
  str = str.trim();
  if (str[0] === '#') {
    let h = str.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  let m = /^rgba?\(([^)]+)\)$/.exec(str);
  if (m) {
    const p = m[1].split(',').map(s => parseFloat(s));
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? p[3] : 1];
  }
  return [255, 0, 255, 1];
}

function createCanvas(w, h) {
  w = w | 0; h = h | 0;
  let data = new Uint8ClampedArray(w * h * 4);
  // PX.makeCanvas builds a 1x1 and then assigns .width/.height, so the buffer
  // has to follow the properties rather than being fixed at construction.
  const dims = { w: w, h: h };
  const canvas = {
    get width() { return dims.w; },
    set width(v) { v = v | 0; if (v !== dims.w) { dims.w = v; resize(); } },
    get height() { return dims.h; },
    set height(v) { v = v | 0; if (v !== dims.h) { dims.h = v; resize(); } },
    get data() { return data; },
    set data(v) { data = v; },
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: dims.w, height: dims.h })
  };
  function resize() { data = new Uint8ClampedArray(dims.w * dims.h * 4); }

  const st = {
    fillStyle: '#000', strokeStyle: '#000',
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    lineWidth: 1
  };
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack = [];
  let fillStyleObj = { kind: 'solid', color: [0, 0, 0, 1] };
  let strokeStyleObj = { kind: 'solid', color: [0, 0, 0, 1] };
  let path = null;

  const apply = (x, y, px, py, sa) => {
    const ax = m.a, ay = m.b, cx = m.c, dy = m.d, ex = m.e, fy = m.f;
    const det = ax * dy - ay * cx;
    if (Math.abs(det) < 1e-9) return false;
    const dx = px - ex, dy2 = py - fy;
    const u = (dx * dy - dy2 * cx) / det;
    const v = (ax * dy2 - ay * dx) / det;
    return u >= x && u < x + sa[0] && v >= y && v < y + sa[1];
  };

  function shade(style, x, y) {
    if (style.kind === 'solid') return style.color;
    if (style.kind === 'linear') {
      const { x0, y0, x1, y1, stops } = style;
      const dx = x1 - x0, dy = y1 - y0;
      const len2 = dx * dx + dy * dy;
      let t = len2 < 1e-9 ? 0 : ((x - x0) * dx + (y - y0) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return sampleStops(stops, t);
    }
    if (style.kind === 'radial') {
      const { x0, y0, r0, x1, y1, r1, stops } = style;
      const d = Math.hypot(x - x1, y - y1);
      const span = r1 - r0;
      let t = span < 1e-9 ? (d < r1 ? 1 : 0) : (d - r0) / span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return sampleStops(stops, t);
    }
    return [0, 0, 0, 1];
  }

  function sampleStops(stops, t) {
    if (!stops.length) return [0, 0, 0, 1];
    let prev = stops[0];
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      if (t <= s[0] || i === stops.length - 1) {
        const span = s[0] - prev[0];
        const lt = span < 1e-9 ? 0 : (t - prev[0]) / span;
        const k = lt < 0 ? 0 : lt > 1 ? 1 : lt;
        return [
          prev[1][0] + (s[1][0] - prev[1][0]) * k,
          prev[1][1] + (s[1][1] - prev[1][1]) * k,
          prev[1][2] + (s[1][2] - prev[1][2]) * k,
          prev[1][3] + (s[1][3] - prev[1][3]) * k
        ];
      }
      prev = s;
    }
    return prev[1];
  }

  function blend(px, py, src, alpha) {
    if (alpha <= 0) return;
    const i = (py * dims.w + px) * 4;
    const op = st.globalCompositeOperation;
    let r = src[0], g = src[1], b = src[2];
    if (op === 'multiply') {
      r = (r * data[i]) / 255; g = (g * data[i + 1]) / 255; b = (b * data[i + 2]) / 255;
    } else if (op === 'lighter') {
      r = r * alpha; g = g * alpha; b = b * alpha;
      data[i] = Math.min(255, data[i] + r);
      data[i + 1] = Math.min(255, data[i + 1] + g);
      data[i + 2] = Math.min(255, data[i + 2] + b);
      data[i + 3] = 255;
      return;
    }
    const a = alpha * (src[3] == null ? 1 : src[3]);
    data[i] = r * a + data[i] * (1 - a);
    data[i + 1] = g * a + data[i + 1] * (1 - a);
    data[i + 2] = b * a + data[i + 2] * (1 - a);
    data[i + 3] = 255;
  }

  function fillRect(x, y, rw, rh) {
    if (rw <= 0 || rh <= 0) return;
    const p0 = map(x, y), p1 = map(x + rw, y), p2 = map(x, y + rh), p3 = map(x + rw, y + rh);
    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0], p3[0])));
    const maxX = Math.min(dims.w - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0], p3[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1], p3[1])));
    const maxY = Math.min(dims.h - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1], p3[1])));
    const sa = [rw, rh];
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        if (!apply(x, y, px + 0.5, py + 0.5, sa)) continue;
        const u = invX(px + 0.5, py + 0.5), v = invY(px + 0.5, py + 0.5);
        blend(px, py, shade(fillStyleObj, u, v), st.globalAlpha);
      }
    }
  }

  function map(x, y) { return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; }
  function invX(px, py) {
    const det = m.a * m.d - m.b * m.c;
    if (Math.abs(det) < 1e-9) return 0;
    return ((px - m.e) * m.d - (py - m.f) * m.c) / det;
  }
  function invY(px, py) {
    const det = m.a * m.d - m.b * m.c;
    if (Math.abs(det) < 1e-9) return 0;
    return (m.a * (py - m.f) - m.b * (px - m.e)) / det;
  }

  function drawImage(img, dx, dy, dw, dh) {
    const sw = img.width, sh = img.height;
    if (dw === undefined) { dw = sw; dh = sh; }
    const p0 = map(dx, dy), p1 = map(dx + dw, dy), p2 = map(dx, dy + dh), p3 = map(dx + dw, dy + dh);
    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0], p3[0])));
    const maxX = Math.min(dims.w - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0], p3[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1], p3[1])));
    const maxY = Math.min(dims.h - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1], p3[1])));
    const sxScale = sw / dw, syScale = sh / dh;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const u = invX(px + 0.5, py + 0.5), v = invY(px + 0.5, py + 0.5);
        const uu = u - dx, vv = v - dy;
        if (uu < 0 || uu >= dw || vv < 0 || vv >= dh) continue;
        const sxp = Math.min(sw - 1, Math.max(0, Math.floor(uu * sxScale)));
        const syp = Math.min(sh - 1, Math.max(0, Math.floor(vv * syScale)));
        const si = (syp * sw + sxp) * 4;
        const sa = img.data[si + 3] / 255;
        if (sa <= 0) continue;
        blend(px, py, [img.data[si], img.data[si + 1], img.data[si + 2], 1], st.globalAlpha * sa);
      }
    }
  }

  const ctx = {
    get fillStyle() { return st.fillStyle; },
    set fillStyle(v) { st.fillStyle = v; fillStyleObj = (v && v.kind) ? v : { kind: 'solid', color: parseColor(v) }; },
    get strokeStyle() { return st.strokeStyle; },
    set strokeStyle(v) { st.strokeStyle = v; strokeStyleObj = (v && v.kind) ? v : { kind: 'solid', color: parseColor(v) }; },
    globalAlpha: 1,
    get globalAlpha() { return st.globalAlpha; },
    set globalAlpha(v) { st.globalAlpha = v; },
    get globalCompositeOperation() { return st.globalCompositeOperation; },
    set globalCompositeOperation(v) { st.globalCompositeOperation = v; },
    get lineWidth() { return st.lineWidth; },
    set lineWidth(v) { st.lineWidth = v; },
    imageSmoothingEnabled: false,
    font: '', textAlign: 'left', textBaseline: 'top',

    save() { stack.push({ st: Object.assign({}, st), m: Object.assign({}, m), fs: fillStyleObj, ss: strokeStyleObj }); },
    restore() { const s = stack.pop(); if (!s) return; st.fillStyle = s.st.fillStyle; st.strokeStyle = s.st.strokeStyle; st.globalAlpha = s.st.globalAlpha; st.globalCompositeOperation = s.st.globalCompositeOperation; st.lineWidth = s.st.lineWidth; m = s.m; fillStyleObj = s.fs; strokeStyleObj = s.ss; },
    translate(x, y) { m.e += m.a * x + m.c * y; m.f += m.b * x + m.d * y; },
    scale(x, y) { m.a *= x; m.b *= x; m.c *= y; m.d *= y; },
    setTransform(a, b, c, d, e, f) { m = { a, b, c, d, e, f }; },
    transform(a, b, c, d, e, f) {
      m.a = m.a * a + m.c * b; m.b = m.b * a + m.d * b;
      m.c = m.a * c + m.c * d; m.d = m.b * c + m.d * d;
      m.e = m.a * e + m.c * f + m.e; m.f = m.b * e + m.d * f + m.f;
    },
    resetTransform() { m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    rotate() {},

    clearRect(x, y, rw, rh) {
      const saveOp = st.globalCompositeOperation, saveA = st.globalAlpha;
      st.globalCompositeOperation = 'source-over'; st.globalAlpha = 1;
      const p0 = map(x, y), p1 = map(x + rw, y), p2 = map(x, y + rh), p3 = map(x + rw, y + rh);
      const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0], p3[0])));
      const maxX = Math.min(dims.w - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0], p3[0])));
      const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1], p3[1])));
      const maxY = Math.min(dims.h - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1], p3[1])));
      const sa = [rw, rh];
      for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
        if (!apply(x, y, px + 0.5, py + 0.5, sa)) continue;
        const i = (py * dims.w + px) * 4;
        data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
      }
      st.globalCompositeOperation = saveOp; st.globalAlpha = saveA;
    },
    fillRect: fillRect,
    drawImage: drawImage,

    strokeRect(x, y, rw, rh) {
      const saveFill = fillStyleObj, saveOp = st.globalCompositeOperation;
      fillStyleObj = strokeStyleObj; st.globalCompositeOperation = 'source-over';
      const t = Math.max(1, st.lineWidth);
      fillRect(x, y, rw, t); fillRect(x, y + rh - t, rw, t);
      fillRect(x, y, t, rh); fillRect(x + rw - t, y, t, rh);
      fillStyleObj = saveFill; st.globalCompositeOperation = saveOp;
    },

    beginPath() { path = []; },
    arc(cx, cy, r, a0, a1) { path = { circle: [cx, cy, r] }; },
    closePath() {},
    moveTo() {}, lineTo() {},
    fill() {
      if (!path || !path.circle) return;
      const [cx, cy, r] = path.circle;
      const p0 = map(cx - r, cy - r), p1 = map(cx + r, cy + r);
      const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0])));
      const maxX = Math.min(dims.w - 1, Math.ceil(Math.max(p0[0], p1[0])));
      const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1])));
      const maxY = Math.min(dims.h - 1, Math.ceil(Math.max(p0[1], p1[1])));
      const saveOp = st.globalCompositeOperation;
      for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
        const u = invX(px + 0.5, py + 0.5), v = invY(px + 0.5, py + 0.5);
        const d = Math.hypot(u - cx, v - cy);
        if (d > r) continue;
        blend(px, py, shade(fillStyleObj, u, v), st.globalAlpha);
      }
      st.globalCompositeOperation = saveOp;
    },
    stroke() {}, clip() {},

    createLinearGradient(x0, y0, x1, y1) {
      return { kind: 'linear', x0, y0, x1, y1, stops: [], addColorStop(o, c) { this.stops.push([o, parseColor(c)]); } };
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      return { kind: 'radial', x0, y0, r0, x1, y1, r1, stops: [], addColorStop(o, c) { this.stops.push([o, parseColor(c)]); } };
    },
    fillText() {}, strokeText() {},
    measureText(s) { return { width: s.length * 6 }; },
    getImageData(x, y, rw, rh) { return { data: new Uint8ClampedArray(Math.max(0, rw * rh * 4)), width: rw, height: rh }; },
    putImageData() {}, createImageData: (a, b) => ({ data: new Uint8ClampedArray(Math.max(0, a * b * 4)), width: a, height: b }),
    createPattern: () => null
  };

  Object.defineProperty(ctx, 'globalAlpha', {
    get() { return st.globalAlpha; }, set(v) { st.globalAlpha = v; }, enumerable: true
  });

  canvas.getContext = () => ctx;
  return canvas;
}

/* ---- minimal PNG encoder ---- */
const zlib = require('zlib');

function crc32(buf) {
  let c, table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(canvas) {
  const w = canvas.width, h = canvas.height, d = canvas.data;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w * 4; x++) raw[y * (w * 4 + 1) + 1 + x] = d[y * w * 4 + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { createCanvas, encodePNG };
