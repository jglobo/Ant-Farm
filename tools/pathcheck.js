 /* focused check: can an ant walk from the queen's chamber to daylight?
   node tools/pathcheck.js [seed] [tx] [ty] */
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
function mkCanvas(w, h) {
  return { width: w || 1, height: h || 1, style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, getContext: () => ctxStub, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) };
}
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

const CFG = sandbox.CFG, U = sandbox.U, T8 = CFG.TILE, T = sandbox.T, World = sandbox.World;
const seed = Number(process.argv[2] || 12345);
const qx = Number(process.argv[3] || 48), qy = Number(process.argv[4] || 22);

const w = new World(seed);
w.carveBox(qx - 3, qy, 7, 2);

function carveShaft(sx, sy, dir) {
  let F = sy, x = sx, guard = 0;
  while (guard++ < 400) {
    if (!w.inBounds(x, F) || !w.inBounds(x, F - 2)) return false;
    if (F > w.surface[x] && !World.isSolid(w.at(x, F))) w.set(x, F, T.DIRT);
    w.set(x, F - 1, T.TUNNEL);
    w.set(x, F - 2, T.TUNNEL);
    if (F - 1 <= w.surface[x]) {
      if (F - 1 === w.surface[x]) w.set(x, w.surface[x] - 1, T.TUNNEL);
      return true;
    }
    const nx = x + dir;
    if (nx < 1 || nx >= w.w - 1) return false;
    if (w.at(nx, F - 1) === T.STONE) return false;
    x = nx; F -= 1;
  }
  return false;
}
const side = ((w.w - 2) - (qx + 4) >= (qx - 4) - 1) ? 1 : -1;
const shaftX = qx + 4 * side;
const hit = carveShaft(shaftX, qy + 1, side);
console.log('seed=' + seed + ' chamber=' + qx + ',' + qy + ' shaft from ' + shaftX + ',' + (qy + 1) + ' side=' + side + ' reachedSky=' + hit);

const f = { tx: -999, ty: -999, stamp: -1, used: 0, dist: new Uint16Array(w.n), dir: new Int8Array(w.n) };
w.computeField(f, qx, qy);
console.log('field src=' + f.tx + ',' + f.ty + '  chamber tiles:');
for (let x = qx - 3; x <= qx + 3; x++) {
  let s = '';
  for (let y = qy - 1; y <= qy + 2; y++) {
    const i = y * w.w + x;
    s += (w.tiles[i] === T.TUNNEL ? '.' : w.tiles[i] === T.AIR ? ' ' : '#') + String(f.dist[i] === 0xFFFF ? '----' : String(f.dist[i]).padStart(3)).slice(-3) + ' ';
  }
  console.log('  x=' + x + '  ' + s);
}

// trace the staircase column by column
console.log('\nshaft columns (surface height, carved rows, field dist of the lowest carved row):');
const lo = Math.max(0, Math.min(qx, shaftX) - 32), hi = Math.min(w.w - 1, Math.max(qx, shaftX) + 4);
for (let x = lo; x <= hi; x++) {
  const rows = [];
  for (let y = 0; y < w.h; y++) if (w.tiles[y * w.w + x] === T.TUNNEL) rows.push(y);
  if (!rows.length) continue;
  const low = rows[rows.length - 1];
  const d = f.dist[low * w.w + x];
  const canStand = w.standable(x, low);
  console.log('  x=' + x + ' surface=' + w.surface[x] + ' tunnelRows=[' + rows.join(',') + ']' +
    ' lowest=' + low + ' dist=' + (d === 0xFFFF ? 'UNREACHABLE' : d) + ' standable=' + canStand);
}

console.log('\nsurface walk row reachability:');
for (let x = qx - 2; x <= Math.min(w.w - 1, qx + 20); x++) {
  const y = w.surface[x] - 1;
  const i = y * w.w + x;
  console.log('  x=' + x + ' walkRow=' + y + ' tile=' + w.tiles[i] + ' standable=' + w.standable(x, y) +
    ' dist=' + (f.dist[i] === 0xFFFF ? 'UNREACHABLE' : f.dist[i]));
}

let best = null, bestD = 0xFFFF;
for (let x = 0; x < w.w; x++) {
  for (let y = 0; y <= w.surface[x] - 1; y++) {
    const i = y * w.w + x;
    if (w.tiles[i] !== T.AIR) continue;
    if (f.dist[i] < bestD) { bestD = f.dist[i]; best = [x, y]; }
  }
}
console.log('\nclosest reachable sky from the chamber: ' + JSON.stringify(best) + ' dist=' + bestD);
console.log('surfaceReachable = ' + (best !== null));

const NAME = ['AIR', 'DIRT', 'GRASS', 'TUNNEL', 'WOOD', 'THATCH', 'STONE', 'ROOT'];
/* which source tiles can reach the sky? */
for (const probe of [[qx, qy], [qx, qy + 1], [qx, qy + 2]]) {
  const g = { tx: -999, ty: -999, stamp: -1, used: 0, dist: new Uint16Array(w.n), dir: new Int8Array(w.n) };
  const ok = w.computeField(g, probe[0], probe[1]);
  let bd = 0xFFFF, bx = null;
  for (let x = 0; x < w.w; x++) for (let y = 0; y <= w.surface[x] - 1; y++) {
    const i = y * w.w + x;
    if (w.tiles[i] !== T.AIR) continue;
    if (g.dist[i] < bd) { bd = g.dist[i]; bx = [x, y]; }
  }
  console.log('  source ' + probe[0] + ',' + probe[1] + ' tile=' + NAME[w.at(probe[0], probe[1])] +
    ' standable=' + w.standable(probe[0], probe[1]) +
    ' -> closest sky ' + JSON.stringify(bx) + ' dist=' + bd);
}

/* ---------- physical climb test ---------- */
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'entities.js'), 'utf8'), sandbox, { filename: 'entities.js' });
const Ant = sandbox.Ant;
const ant = new Ant(qx * 8 + 4, (qy + 2) * 8, 'gatherer');
console.log('\nclimb test: ant at tile ' + ant.tileX() + ',' + ant.tileY() + '  wants to move right');
const fakeGame = { world: w };
let vx = 0, probed = false;
console.log('  tiles around the exit: ' + [-2, -1, 0, 1, 2].map(d =>
  'x' + (shaftX + d) + '=[' + [19, 20, 21, 22, 23, 24].map(r => w.at(shaftX + d, r)).join(',') + ']').join(' '));
for (let f = 0; f < 200; f++) {
  const wasY = ant.y;
  vx += Math.min(7, 26 - vx);
  ant.moveX(w, vx / 60);
  if (ant.hitX && ant.onGround) {
    const nx = ant.x + (ant.w / 2 + 0.9), ny = ant.y - 8;
    const c1 = w.solidPx(nx, ny + 0.01), c2 = w.solidPx(nx, ny - 0.01), c3 = w.solidPx(nx, ny - ant.h - 0.01);
    if (!probed) {
      probed = true;
      console.log('    probe nx=' + nx.toFixed(2) + ' ny=' + ny.toFixed(2) +
        ' ledge=' + c1 + ' room=' + c2 + ' head=' + c3 +
        ' col=' + Math.floor(nx / 8) +
        ' rows[ny+1]=' + w.at(Math.floor(nx / 8), Math.floor((ny + 0.01) / 8)) +
        ' rows[ny]=' + w.at(Math.floor(nx / 8), Math.floor((ny - 0.01) / 8)) +
        ' rows[head]=' + w.at(Math.floor(nx / 8), Math.floor((ny - ant.h - 0.01) / 8)));
    }
    if (!ant.tryStepUp(w, 1) && !probed) console.log('    tryStepUp REFUSED');
  }
  ant.vy += 900 / 60;
  ant.moveY(w, ant.vy / 60);
  if (f % 20 === 0) {
    console.log('  f=' + String(f).padStart(3) + ' pos=' + ant.x.toFixed(2) + ',' + ant.y.toFixed(2) +
      ' tile=' + ant.tileX() + ',' + ant.tileY() + ' hitX=' + ant.hitX + ' onGround=' + ant.onGround);
  }
  if (ant.y < wasY - 0.01) console.log('  f=' + String(f).padStart(3) + ' CLIMBED at ' + ant.x.toFixed(2) + ',' + ant.y.toFixed(2) + ' tile=' + ant.tileX() + ',' + ant.tileY());
  if (ant.vy > 300) ant.vy = 0;
}
console.log('  final tile: ' + ant.tileX() + ',' + ant.tileY() + ' (started at ' + qx + ',' + (qy + 1) + ')');

