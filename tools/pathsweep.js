/* sweep: does the founding nest ALWAYS connect to open sky?
   for many seeds x many placements, carve chamber + shaft, run the real flow
   field, and report the success rate.  node tools/pathsweep.js [trials] */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const noop = () => {};
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
    if (k === 'getImageData' || k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w || 1) * (h || 1) * 4)), width: w, height: h });
    if (k in t) return t[k];
    return noop;
  },
  set(t, k, v) { t[k] = v; return true; }
});
const mkCanvas = (w, h) => ({ width: w || 1, height: h || 1, style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, getContext: () => ctxStub, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) });
const sandbox = {
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, isNaN, parseInt, parseFloat,
  Uint8Array, Uint8ClampedArray, Int8Array, Int16Array, Int32Array, Set, Map, Symbol, RegExp, Function,
  Infinity, NaN, undefined,
  document: { createElement: (t) => t === 'canvas' ? mkCanvas() : { style: {}, classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, appendChild: noop }, getElementById: () => null, addEventListener: noop, readyState: 'x' }
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['util.js', 'pixel.js', 'world.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.CFG, U = sandbox.U, T = sandbox.T, World = sandbox.World;

/* --- the real algorithms, lifted from game.js --- */
function carveEntrance(w, x, dir, len) {
  for (let i = 0; i <= (len || 8); i++) {
    const c = x + dir * i;
    if (c < 1 || c >= w.w - 1) break;
    w.set(c, w.surface[c] - 1, T.TUNNEL);
    w.set(c, w.surface[c] - 2, T.TUNNEL);
  }
}
function carveShaft(w, sx, sy, dir) {
  let F = sy, x = sx, guard = 0;
  while (guard++ < 400) {
    if (!w.inBounds(x, F) || !w.inBounds(x, F - 2)) return false;
    if (F > w.surface[x]) {
      if (!World.isSolid(w.at(x, F))) w.set(x, F, T.DIRT);
      if (!World.isSolid(w.at(x, F + 1))) w.set(x, F + 1, T.DIRT);
      if (!World.isSolid(w.at(x, F + 2))) w.set(x, F + 2, T.DIRT);
    }
    w.set(x, F - 1, T.TUNNEL);
    w.set(x, F - 2, T.TUNNEL);
    if (F - 1 <= w.surface[x]) {
      if (F - 1 === w.surface[x]) w.set(x, w.surface[x] - 1, T.TUNNEL);
      carveEntrance(w, x, dir, 9);
      return true;
    }
    const nx = x + dir;
    if (nx < 1 || nx >= w.w - 1) return false;
    if (w.at(nx, F - 1) === T.STONE) return false;
    x = nx; F -= 1;
  }
  return false;
}
function surfaceReachable(w, qx, qy) {
  const f = { tx: -999, ty: -999, stamp: -1, used: 0, dist: new Uint16Array(w.n), dir: new Int8Array(w.n) };
  if (!w.computeField(f, qx, qy)) return false;
  for (let x = 0; x < w.w; x++) {
    for (let y = 0; y <= w.surface[x] - 1; y++) {
      const i = y * w.w + x;
      if (w.tiles[i] === T.AIR && f.dist[i] < 0xFFFF) return true;
    }
  }
  return false;
}

const TRIALS = Number(process.argv[2] || 300);
function entrancePlan(w, tx, ty) {
  const surf = w.surface[U.clamp(tx, 0, w.w - 1)];
  const drift = Math.max(2, (ty - surf) + 2);
  const right = (w.w - 2) - (tx + 4);
  const left = (tx - 4) - 1;
  const side = right >= left ? 1 : -1;
  return { side, drift, ok: (side > 0 ? right : left) >= drift };
}
let pass = 0, skipped = 0; const fails = [];
for (let n = 0; n < TRIALS; n++) {
  const seed = (n * 2654435761) >>> 0;
  const w = new World(seed);
  // pick a placement like canPlace would
  const tx = 6 + (n * 7) % (w.w - 12);
  const ty = w.surface[tx] + 6 + (n * 3) % Math.max(1, w.h - 8 - w.surface[tx] - 6);
  if (ty > w.h - 6) { skipped++; continue; }
  const plan = entrancePlan(w, tx, ty);
  if (!plan.ok) { skipped++; continue; }          // placement rejected by canPlace

  w.carveBox(tx - 3, ty, 7, 2);
  carveShaft(w, tx + 4 * plan.side, ty + 2, plan.side);
  if (surfaceReachable(w, tx, ty + 1)) pass++;
  else fails.push({ seed, tx, ty, side: plan.side, drift: plan.drift });
}

const total = pass + fails.length;
console.log('trials placed  : ' + total + '   (rejected by canPlace: ' + skipped + ')');
console.log('chamber -> sky: ' + pass + ' / ' + total + '  (' + (100 * pass / total).toFixed(1) + '%)');
if (fails.length) {
  console.log('first failures:');
  fails.slice(0, 12).forEach(f => console.log('   seed=' + f.seed + ' chamber=' + f.tx + ',' + f.ty + ' side=' + f.side + ' drift=' + f.drift));
  process.exit(1);
}
console.log('*** PASS ***');
