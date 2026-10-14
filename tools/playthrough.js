/* Play a full game headlessly with a brood strategy, log the timeline, and
   render frames along the way.
     node tools/playthrough.js [seed] [seconds] */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas, encodePNG } = require('./raster');

const SEED = Number(process.argv[2] || 39585) >>> 0;
const SECS = Number(process.argv[3] || 420);
const OUT = path.join(__dirname, '..', 'shots');

/* ---------- bootstrap the real game against the software canvas ---------- */
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
    parentNode: { appendChild() {} }, parentElement: null,
    width: 480, height: 288, offsetWidth: 480, offsetHeight: 288
  };
}
const canvas = createCanvas(480, 288);
els['game'] = canvas;
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
  performance: { now: () => Date.now() }, requestAnimationFrame: () => 0,
  innerWidth: 1280, innerHeight: 900,
  addEventListener() {}, removeEventListener() {}, confirm: () => false,
  localStorage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); } },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary')
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['util.js', 'pixel.js', 'world.js', 'entities.js', 'catalog.js', 'ants.js', 'events.js', 'ui.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox, { filename: f });
}

const CFG = sandbox.CFG, T8 = CFG.TILE;
const game = new sandbox.Game(canvas);
game.ui.resize = () => {};
game.setupWorld(SEED);
game.beginPlacement();

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => fs.writeFileSync(path.join(OUT, n), encodePNG(canvas));

/* ---------- a player: place her, then keep the colony balanced ---------- */
let spot = null;
for (let ty = 26; ty < 38 && !spot; ty++) {
  for (let tx = 38; tx < 58; tx++) if (game.canPlace(tx * 8 + 4, ty * 8 + 4)) { spot = { tx, ty }; break; }
}
console.log('seed ' + SEED + '   nest at tile ' + spot.tx + ',' + spot.ty +
  '   (surface row ' + game.world.surface[spot.tx] + ')');
game.mouse.x = spot.tx * 8 + 4 - game.camX;
game.mouse.y = spot.ty * 8 + 4 - game.camY;
game.step(1 / 600);
game.render();
shot('play-00-placement.png');

game.placeQueen(spot.tx * 8 + 4, spot.ty * 8 + 4);
console.log('queen placed. entrance carved to tile ' + game.entrance.x + ',' + game.entrance.y);

// open with a forager and a digger, then keep roughly even numbers
const OPENING = ['gatherer', 'builder', 'nurse', 'army', 'gatherer'];
let layN = 0;
function chooseBrood() {
  if (layN < OPENING.length) return OPENING[layN];
  const c = counts();
  const order = ['builder', 'army', 'gatherer', 'nurse'];
  for (const r of order) if (c[r] < 9) return r;
  return 'gatherer';
}
function counts() {
  const c = { gatherer: 0, builder: 0, nurse: 0, army: 0, queen: 0 };
  for (const a of game.ants) if (!a.dead && !a.isEnemy && c[a.role] != null) c[a.role]++;
  return c;
}

/* ---------- camera helper ---------- */
function look(mode) {
  const w = game.world, V = { w: CFG.VIEW_W / game.zoom, h: CFG.VIEW_H / game.zoom };
  if (mode === 'queen' && game.queen) {
    game.camTargetX = game.queen.x - V.w / 2;
    game.camTargetY = game.queen.y - V.h / 2;
  } else if (mode === 'entrance' && game.entrance) {
    game.camTargetX = game.entrance.x * T8 - V.w / 2;
    game.camTargetY = game.entrance.y * T8 - V.h / 2;
  }
  game.camX = Math.max(0, Math.min(game.camTargetX, w.w * T8 - V.w));
  game.camY = Math.max(0, Math.min(game.camTargetY, w.h * T8 - V.h));
}

/* ---------- run ---------- */
const STEP = 1 / 60;
const shots = [
  [20, 'play-01-hatchery', 'queen'],
  [60, 'play-02-early', 'queen'],
  [120, 'play-03-raid', 'entrance'],
  [200, 'play-04-growing', 'queen'],
  [300, 'play-05-burrow', 'queen'],
  [SECS, 'play-06-late', 'entrance']
];
let shotI = 0;
const timeline = [];
let lastLog = -1;
let lastEventNote = '';

for (let t = 0; t < SECS; t += STEP) {
  if (game.layPromptOpen) {
    const b = chooseBrood();
    layN++;
    game.chooseLay(b);
    lastEventNote = 'laid ' + b;
  }
  const before = game.stats.raids;
  game.step(STEP);
  if (game.stats.raids > before) lastEventNote = 'RAID';
  if (game.events.rain.active) lastEventNote = 'rain';
  if (game.events.sand.active) lastEventNote = 'sandstorm';

  if (shotI < shots.length && t >= shots[shotI][0]) {
    const [, name, mode] = shots[shotI];
    look(mode);
    game.ui.update(0.016);
    game.render();
    shot(name + '.png');
    shotI++;
  }
  if (Math.floor(t) - lastLog >= 30) {
    lastLog = Math.floor(t);
    const c = counts();
    const foes = game.ants.filter(a => a.isEnemy && !a.dead).length;
    timeline.push(
      String(Math.floor(t)).padStart(4) + 's  day ' + game.events.day +
      '  ' + game.events.clock().split(' ')[2] +
      '  food ' + String(Math.floor(game.food)).padStart(3) +
      '  Q ' + Math.round(game.queen ? game.queen.hp : 0).toString().padStart(3) + 'hp' +
      '  ants ' + String(game.ants.length - foes).padStart(2) +
      ' [G' + c.gatherer + ' B' + c.builder + ' N' + c.nurse + ' A' + c.army + ']' +
      '  eggs ' + game.eggs.length +
      '  foes ' + foes +
      '  ' + (lastEventNote || ''));
  }
}

console.log('\n' + timeline.join('\n'));

const c = counts();
const w = game.world;
console.log('\n--- after ' + SECS + 's ---');
console.log('  survived      : ' + (game.phase === 'play' ? 'yes' : 'NO -- queen lost') +
  '   queen ' + (game.queen ? game.queen.hp.toFixed(0) + '/100' : 'dead'));
console.log('  colony        : ' + c.gatherer + ' gatherers, ' + c.builder + ' builders, ' +
  c.nurse + ' nurses, ' + c.army + ' army');
console.log('  food gathered : ' + game.stats.gathered + '   food left ' + Math.floor(game.food));
console.log('  eggs laid     : ' + game.stats.eggs + '   brood born ' + game.stats.born);
console.log('  tunnels mined : ' + w.countTile(sandbox.T.TUNNEL) +
  '   structures ' + (w.countTile(sandbox.T.WOOD) + w.countTile(sandbox.T.THATCH)));
console.log('  raids survived: ' + game.stats.raids + '   ants lost ' + game.stats.dead);
console.log('  days elapsed  : ' + game.events.day);
console.log('\n  frames -> ' + OUT);
