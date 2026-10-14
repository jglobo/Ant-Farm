/* Render real frames of the game to PNG so the visuals can be checked.
   node tools/shot.js [outDir] [seed] [seconds] */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, encodePNG } = require('./raster');

const outDir = process.argv[2] || path.join(__dirname, '..', 'shots');
const SEED = Number(process.argv[3] || 39585) >>> 0;
const SECS = Number(process.argv[4] || 120);

/* ---------- DOM stub that uses the software canvas ---------- */
const els = {};
function stubEl(id) {
  return {
    id: id || '', textContent: '', innerHTML: '', value: '',
    style: { cssText: '', width: '', height: '' },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, f) { if (f) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 288 }),
    appendChild() {}, remove() {}, closest: () => null,
    getAttribute: () => null, setAttribute() {},
    parentNode: { appendChild() {} },
    parentElement: null,
    width: 480, height: 288, offsetWidth: 480, offsetHeight: 288
  };
}
const gameCanvas = createCanvas(480, 288);
els['game'] = gameCanvas;
els['s-qhp'] = stubEl('s-qhp');
els['s-qhp'].parentElement = stubEl('stat-queen');

const document = {
  readyState: 'complete',
  createElement: (t) => (t === 'canvas' ? createCanvas(1, 1) : stubEl(t)),
  getElementById: (id) => (els[id] || (els[id] = stubEl(id))),
  addEventListener() {}
};

const sandbox = {
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, isNaN, parseInt, parseFloat,
  Uint8Array, Uint8ClampedArray, Int8Array, Int16Array, Int32Array, Set, Map, Promise, Symbol, RegExp,
  Function, Infinity, NaN, undefined, document,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  innerWidth: 1280, innerHeight: 900,
  addEventListener() {}, removeEventListener() {}, confirm: () => false,
  localStorage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); } },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary')
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['util.js', 'pixel.js', 'world.js', 'entities.js', 'catalog.js', 'ants.js', 'events.js', 'ui.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox, { filename: f });
}

const CFG = sandbox.CFG, T8 = CFG.TILE;
const game = new sandbox.Game(gameCanvas);
game.ui.resize = () => {};
game.setupWorld(SEED);
game.beginPlacement();

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function save(name) {
  fs.writeFileSync(path.join(outDir, name), encodePNG(gameCanvas));
  console.log('  wrote ' + name);
}
// world.flushDirty() lives inside step(), so a frame rendered before the first
// step has no dirt tiles painted on it yet.
function paint() { game.step(1 / 600); }

/* frame 1: the placement screen, cursor parked on a valid deep spot */
let spot = null;
for (let ty = 24; ty < 40 && !spot; ty++) {
  for (let tx = 34; tx < 62; tx++) if (game.canPlace(tx * 8 + 4, ty * 8 + 4)) { spot = { tx, ty }; break; }
}
game.mouse.x = spot.tx * 8 + 4 - game.camX;
game.mouse.y = spot.ty * 8 + 4 - game.camY;
game.mouse.over = true;
paint();
game.render();
save('1-placement.png');

/* frame 2: the surface, as soon as the queen is placed */
game.placeQueen(spot.tx * 8 + 4, spot.ty * 8 + 4);
game.followQueen = false;
game.camX = U_clamp((game.entrance ? game.entrance.x * 8 : 0) - 480 / 2, 0, 96 * 8 - 480);
game.camY = U_clamp(0, 0, 48 * 8 - 288);
game.camTargetX = game.camX; game.camTargetY = game.camY;
paint();
game.render();
save('2-surface.png');
function U_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* frame 3: deep underground at the queen's chamber */
game.followQueen = true;
game.snapCamToQueen();
game.camTargetX = game.camX; game.camTargetY = game.camY;
paint();
game.render();
save('3-chamber.png');

/* frame 4: after a while, zoomed out, with events and structures */
const STEP = 1 / 60;
const rot = ['gatherer', 'builder', 'nurse', 'army'];
let n = 0;
for (let t = 0; t < SECS; t += STEP) {
  if (game.layPromptOpen) game.chooseLay(rot[n++ % rot.length]);
  game.step(STEP);
}
game.ui.update(0.016);
game.render();
save('4-colony.png');
console.log('\n  day ' + game.events.day + '  ants ' + game.ants.length +
  '  food ' + Math.floor(game.food) + '  tunnels ' + game.world.countTile(sandbox.T.TUNNEL) +
  '  wood ' + game.world.countTile(sandbox.T.WOOD) + '  thatch ' + game.world.countTile(sandbox.T.THATCH) +
  '  water ' + game.waterCountOf ? '' : '');
console.log('  out: ' + outDir);
