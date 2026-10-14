/* ============================================================
  tools/smoke.js  headless simulation harness
  Runs the colony with no browser so the sim can be verified.
    node tools/smoke.js [seconds]
  ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- minimal DOM / canvas stub ---------- */
function stubCtx() {
  const noop = () => {};
  return {
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: false, font: '', textAlign: 'left', textBaseline: 'top',
    fillRect: noop, strokeRect: noop, clearRect: noop,
    drawImage: noop, beginPath: noop, closePath: noop, arc: noop, fill: noop,
    stroke: noop, save: noop, restore: noop, scale: noop, translate: noop,
    rotate: noop, setTransform: noop, transform: noop, rect: noop, clip: noop,
    fillText: noop, strokeText: noop, measureText: () => ({ width: 0 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData: noop, createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null
  };
}

function makeCanvas(w, h) {
  const c = { width: w || 300, height: h || 150, style: { cssText: '', width: '', height: '' }, nodeName: 'CANVAS', classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false } };
  const ctx = stubCtx();
  ctx.canvas = c;
  c.getContext = () => ctx;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
  c.addEventListener = () => {};
  c.removeEventListener = () => {};
  return c;
}

const store = {};
function stubEl(id) {
  return {
    id: id || '', textContent: '', innerHTML: '', value: '', disabled: false,
    style: { cssText: '' },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener: () => {}, removeEventListener: () => {},
    appendChild: () => {}, remove: () => {}, closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 288 }),
    setAttribute: () => {}, getAttribute: () => null, parentNode: { appendChild: () => {} },
    offsetWidth: 480, offsetHeight: 288
  };
}

const els = {};
const document = {
  readyState: 'loading',
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : stubEl()),
  getElementById: (id) => (els[id] || (els[id] = stubEl(id))),
  addEventListener: () => {}
};

const sandbox = {
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, isNaN, parseInt, parseFloat,
  Uint8Array, Uint8ClampedArray, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array,
  Set, Map, Promise, Symbol, RegExp, Function, Infinity, NaN, undefined,
  document,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  window: null
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.confirm = () => false;
sandbox.innerWidth = 1280;
sandbox.innerHeight = 800;

vm.createContext(sandbox);

/* ---------- load the game modules in order ---------- */
const root = path.join(__dirname, '..', 'js');
const files = ['util.js', 'pixel.js', 'world.js', 'entities.js', 'catalog.js', 'ants.js', 'events.js', 'ui.js', 'game.js'];
for (const f of files) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: f });
  } catch (e) {
    console.error('LOAD FAIL ' + f + ': ' + e.stack);
    process.exit(1);
  }
}

/* ---------- drive the simulation ---------- */
const CFG = sandbox.CFG, T = sandbox.T;
const SECONDS = Number(process.argv[2] || 150);
const STEP = 1 / 60;
const LAY_ROTATION = ['gatherer', 'builder', 'nurse', 'army', 'gatherer', 'builder', 'nurse', 'gatherer'];

const gameCanvas = makeCanvas(480, 288);
els['game'] = gameCanvas;
const game = new sandbox.Game(gameCanvas);
game.AI = sandbox.AntAI;
game.ui.resize = () => {};

const t0 = Date.now();
let lays = 0, raids = 0, rains = 0, sands = 0, debris = 0;

if (process.env.SEED) {
  game.setupWorld(Number(process.env.SEED) >>> 0);
}
game.beginPlacement();
const origFire = game.events.fire.bind(game.events);
game.events.fire = function (k) {
  if (k === 'raid') raids++;
  if (k === 'rain') rains++;
  if (k === 'sand') sands++;
  if (k === 'debris') debris++;
  return origFire(k);
};

// find a valid queen spot near the middle
let placed = false;
outer:
for (let ty = 22; ty < 42; ty++) {
  for (let tx = 30; tx < 66; tx++) {
    const wx = tx * 8 + 4, wy = ty * 8 + 4;
    if (game.canPlace(wx, wy)) { game.placeQueen(wx, wy); placed = true; break outer; }
  }
}
if (!placed) { console.error('could not find a queen placement'); process.exit(1); }

let steps = 0;
let renderEvery = 3;
let maxAnts = 0;
const errors = [];
const history = [];

for (let t = 0; t < SECONDS; t += STEP) {
  if (game.layPromptOpen) {
    const role = LAY_ROTATION[lays % LAY_ROTATION.length];
    lays++;
    game.chooseLay(role);
  }
  try {
    game.step(STEP);
    if (steps % renderEvery === 0) game.render();
  } catch (e) {
    errors.push({ t: t.toFixed(1), stack: e.stack });
  }
  if (process.env.TRACE && steps % 300 === 0) {
    const line = game.ants.filter(a => !a.isEnemy).map(a => {
      let extra = '';
      if (a.field) {
        const w = game.world;
        const d8 = w.stepToward(a.field, a.tileX(), a.tileY());
        const px = d8 >= 0 ? a.tileX() + w.DX8[d8] : -1;
        const py = d8 >= 0 ? a.tileY() + w.DY8[d8] : -1;
        const pk = game.AI.pickStep(w, a.field, a.tileX(), a.tileY(), a);
        // what would the climb probe see for the chosen step?
        let climb = '';
        if (pk >= 0) {
          const s = (pk === 0 || pk === 2 || pk === 3 || pk === 4 || pk === 5 || pk === 7) ? (a.facing || 1) : (a.facing || 1);
          const nx = a.x + s * (a.w / 2 + 0.9), ny = a.y - 8;
          climb = ' c' + s + '[' + w.solidPx(nx, ny + 0.01) + '/' + w.solidPx(nx, ny - 0.01) + ']';
        }
        extra = '/k' + pk + '/d' + w.distAt(a.field, a.tileX(), a.tileY()) + '>' + px + ',' + py +
          '{' + a.field.tx + ',' + a.field.ty + '}' +
          (game.entrance ? 'E' + game.entrance.x + ',' + game.entrance.y : 'Enull') +
          ' [' + a.x.toFixed(0) + ',' + a.y.toFixed(0) + ' vx' + a.vx.toFixed(0) +
          (a.onGround ? ' G' : ' a') + (a.hitX ? ' X' : '') + ']' + climb;
      }
      return a.role + ':' + a.state + (a.dbg ? '(' + a.dbg + ')' : '') + '@' + a.tileX() + ',' + a.tileY() + extra + (a.carry ? '+' + a.carry : '');
    }).join('  ');
    history.push('t=' + t.toFixed(0) + 's food=' + Math.floor(game.food) +
      ' gath=' + game.stats.gathered + ' | ' + line);
  }
  maxAnts = Math.max(maxAnts, game.ants.length);
  steps++;
}
if (process.env.TRACE) history.forEach(h => console.log(h));
const elapsed = Date.now() - t0;

/* ---------- report ---------- */
const counts = {};
for (const a of game.ants) {
  const k = (a.isEnemy ? 'enemy:' : '') + a.role;
  counts[k] = (counts[k] || 0) + 1;
}
const T_ = game.world;
let tun = 0, wood = 0, thatch = 0, water = 0, sand = 0;
for (let i = 0; i < T_.n; i++) {
  if (T_.tiles[i] === T.TUNNEL) tun++;
  if (T_.tiles[i] === T.WOOD) wood++;
  if (T_.tiles[i] === T.THATCH) thatch++;
  water += T_.water[i];
  sand += T_.sand[i];
}

console.log('--- ANT FARM SMOKE TEST ---');
console.log('simulated      : ' + SECONDS + 's in ' + (elapsed / 1000).toFixed(2) + 's real (' +
  (SECONDS / (elapsed / 1000)).toFixed(0) + 'x realtime)');
console.log('steps / renders : ' + steps + ' / ' + Math.ceil(steps / renderEvery));
console.log('phase          : ' + game.phase + (game.gameOver ? ' (GAME OVER)' : ''));
console.log('day            : ' + game.events.day);
console.log('queen HP       : ' + (game.queen ? game.queen.hp.toFixed(1) : 'dead'));
console.log('ants           : ' + JSON.stringify(counts));
console.log('peak ants      : ' + maxAnts);
console.log('eggs           : ' + game.eggs.length);
console.log('food           : ' + game.food);
console.log('materials      : ' + JSON.stringify(game.mat));
console.log('lay prompts    : ' + lays);
console.log('events         : raids=' + raids + ' rain=' + rains + ' sand=' + sands + ' debris=' + debris);
console.log('tunnels / wood : ' + tun + ' / ' + wood + ' (thatch ' + thatch + ')');
console.log('water / sand   : ' + water + ' / ' + sand);
console.log('stats          : ' + JSON.stringify(game.stats));

if (process.env.DEBUG) {
  console.log('\n--- DEBUG ---');
  const q = game.queen;
  console.log('queen tile     : ' + (q ? q.tileX() + ',' + q.tileY() : '-') + '  worldPos ' + (q ? q.x + ',' + q.y : '-'));
  console.log('surfaceY(qx)   : ' + (q ? game.surfaceY(q.tileX()) : '-'));
  console.log('surfaceAccess  : ' + game.hasSurfaceAccess());
  console.log('foods on map   : ' + game.foods.length);
  game.foods.slice(0, 10).forEach(f => console.log('   food ' + f.kind +
    ' at ' + (f.x | 0) + ',' + (f.y | 0) + ' tile ' + (f.x / 8 | 0) + ',' + (f.y / 8 | 0) +
    ' ground=' + f.onGround + ' claim=' + f.claimed + ' dead=' + f.dead));
  game.foodNodes.slice(0, 4).forEach(n => console.log('   node at ' + n.tx + ',' + n.ty + ' t=' + n.t.toFixed(1)));
  game.ants.forEach(a => {
    console.log('   ant ' + a.role + ' state=' + a.state + ' tile=' + a.tileX() + ',' + a.tileY() +
      ' pos=' + (a.x | 0) + ',' + (a.y | 0) + ' hp=' + a.hp.toFixed(1) + ' carry=' + a.carry +
      ' field=' + (a.field ? a.field.tx + ',' + a.field.ty + ' d=' + game.world.distAt(a.field, a.tileX(), a.tileY()) : 'none') +
      ' onGround=' + a.onGround + ' stuck=' + a.stuckT.toFixed(1));
  });
  console.log('jobs           : ' + JSON.stringify(game.jobs.map(j => j.kind + '@' + j.x + ',' + j.y + ' p' + j.p + ' by' + j.by)));
  const hf = game.world.refreshHome();
  const rows = [];
  for (let x = 0; x < game.world.w; x++) {
    const s = game.world.surface[x];
    const i = (s - 1) * game.world.w + x;
    const i2 = (s - 2) * game.world.w + x;
    const i3 = (s) * game.world.w + x;
    const d = hf.dist[i] === 0xFFFF ? '  --' : String(hf.dist[i]).padStart(3);
    rows.push(x + ':s' + s + ' w' + game.world.tiles[i] + '/' + d +
      ' h' + game.world.tiles[i2] + ' f' + game.world.tiles[i3]);
  }
  console.log('\nsurface walk-row costs (tile / dist-to-queen):');
  for (let i = 0; i < rows.length; i += 6) console.log('  ' + rows.slice(i, i + 6).join('  '));
  let reach = 0; const unreach = [];
  for (let x = 0; x < game.world.w; x++) {
    for (let y = 0; y < game.world.h; y++) {
      const i = y * game.world.w + x;
      if (game.world.tiles[i] !== 3) continue;
      if (hf.dist[i] < 0xFFFF) reach++;
      else if (unreach.length < 24 && x > 30 && x < 75) unreach.push(x + ',' + y);
    }
  }
  console.log('\ntunnel cells reachable from the queen: ' + reach);
  console.log('unreachable tunnel cells (mid-map): ' + unreach.join(' '));
  {
    const q = game.queen;
    const qx = q ? q.tileX() : 48;
    const cols = [];
    for (let x = Math.max(0, qx + 2); x < Math.min(game.world.w, qx + 22); x++) cols.push(x);
    console.log('\nentrance grid  (row, col) tile/dist   cols ' + cols.join(' '));
    for (let y = 8; y <= 18; y++) {
      let line = '  y=' + String(y).padStart(2) + ' ';
      for (const x of cols) {
        const i = y * game.world.w + x;
        const ch = game.world.tiles[i] === 3 ? '.' : game.world.tiles[i] === 0 ? ' ' :
          game.world.tiles[i] === 2 ? '#' : game.world.tiles[i] === 6 ? 'X' : game.world.tiles[i] === 4 ? 'W' : game.world.tiles[i] === 5 ? 'T' : 'o';
        const d = hf.dist[i] === 0xFFFF ? '--' : String(hf.dist[i]).padStart(2);
        line += (ch + d).padStart(4);
      }
      console.log(line);
    }
  }
  const ent = game.entranceSpot();
  if (ent) {
    const g2 = { tx: -999, ty: -999, stamp: -1, used: 0, dist: new Uint16Array(game.world.n), dir: new Int8Array(game.world.n) };
    game.world.computeField(g2, ent.x, ent.y);
    const ga = game.ants.find(a => a.role === 'gatherer');
    console.log('entrance ' + ent.x + ',' + ent.y + ' tile=' + game.world.at(ent.x, ent.y) +
      ' freshSrc=' + g2.tx + ',' + g2.ty +
      (ga ? ' distToGatherer=' + g2.dist[ga.tileY() * game.world.w + ga.tileX()] : '') +
      ' distToQueen=' + g2.dist[(game.queen ? game.queen.tileY() : 0) * game.world.w + (game.queen ? game.queen.tileX() : 0)]);
  } else {
    console.log('entrance = null');
  }

  {
    const q = game.queen;
    const qx = q ? q.tileX() : 48;
    const c0 = Math.max(0, qx - 6), c1 = Math.min(game.world.w, qx + 8);
    console.log('\nchamber grid  cols ' + c0 + '..' + (c1 - 1));
    for (let y = 18; y <= 28; y++) {
      let line = '  y=' + String(y).padStart(2) + ' ';
      for (let x = c0; x < c1; x++) {
        const t = game.world.tiles[y * game.world.w + x];
        const ch = t === 3 ? '.' : t === 0 ? ' ' : t === 2 ? '#' : t === 6 ? 'X' : t === 4 ? 'W' : t === 5 ? 'T' : 'o';
        line += ch + hf.dist[y * game.world.w + x] === undefined ? '?' : ch.padStart(3) + ' ';
      }
      console.log(line);
    }
  }
  {
    const ent = game.entranceSpot();
    const base = ent ? ent.x : (game.queen ? game.queen.tileX() : 48);
    const c0 = Math.max(0, base - 6), c1 = Math.min(game.world.w, base + 7);
    console.log('\nentrance grid @' + (ent ? ent.x + ',' + ent.y : 'null') + '  cols ' + c0 + '..' + (c1 - 1));
    for (let y = 8; y <= 22; y++) {
      let line = '  y=' + String(y).padStart(2) + ' ';
      for (let x = c0; x < c1; x++) {
        const t = game.world.tiles[y * game.world.w + x];
        const ch = t === 3 ? '.' : t === 0 ? ' ' : t === 2 ? '#' : t === 6 ? 'X' : t === 4 ? 'W' : t === 5 ? 'T' : 'o';
        const d = hf.dist[y * game.world.w + x] === 0xFFFF ? '--' : String(hf.dist[y * game.world.w + x]).padStart(2);
        line += (ch + d).padStart(4);
      }
      console.log(line);
    }
    game.ants.forEach(a => {
      const tx = a.tileX(), ty = a.tileY();
      if (a.isEnemy) {
        console.log('  ' + a.role + ' at ' + tx + ',' + ty + ' state=' + a.state);
        return;
      }
      console.log('  ' + a.role + ' at ' + tx + ',' + ty + ' state=' + a.state +
        ' floor=' + game.world.at(tx, ty + 1) + ' cellOpen=' + game.world.isOpen(tx, ty) +
        ' sd=' + game.world.sandAtPx(a.x, a.y - 2) +
        (a.role === 'builder' ? ' dig=' + JSON.stringify(game.nearestDig(a)) +
          ' jobs=' + game.jobs.map(j => j.kind + '@' + j.x + ',' + j.y).join(' ') : ''));
    });
  }
  let bestSky = null, bestD = 0xFFFF;
  for (let x = 0; x < game.world.w; x++) {
    for (let y = 0; y <= game.world.surface[x] - 1; y++) {
      const i = y * game.world.w + x;
      if (game.world.tiles[i] !== 0) continue;
      if (hf.dist[i] < bestD) { bestD = hf.dist[i]; bestSky = [x, y]; }
    }
  }
  console.log('closest reachable sky from queen: ' + JSON.stringify(bestSky) + ' dist=' + bestD);
  console.log('home field src : ' + game.world.homeField.tx + ',' + game.world.homeField.ty +
    '   homeTx/homeTy=' + game.world.homeTx + ',' + game.world.homeTy +
    '   open(' + game.world.homeTx + ',' + game.world.homeTy + ')=' + game.world.isOpen(game.world.homeTx, game.world.homeTy) +
    '   distToQueen=' + game.world.distAt(game.world.homeField, game.queen.tileX(), game.queen.tileY()));
}

/* ---------- assertions ---------- */
const fail = [];
if (errors.length) fail.push('runtime errors: ' + errors.length + '\n' + errors.slice(0, 3).map(e => '  t=' + e.t + ' ' + e.stack.split('\n').slice(0, 2).join(' | ')).join('\n'));
if (maxAnts < 3) fail.push('colony never grew (peak ants = ' + maxAnts + ')');
if (lays < 1) fail.push('queen never laid eggs');
if (tun < 80) fail.push('builders barely dug (tunnels = ' + tun + ')');
if (game.stats.born < 1) fail.push('no ants hatched');
if (game.queen && game.queen.hp <= 0) fail.push('the queen died');

if (fail.length) {
  console.log('\n*** ISSUES ***');
  fail.forEach(f => console.log(' - ' + f));
} else {
  console.log('\n*** PASS ***');
}


