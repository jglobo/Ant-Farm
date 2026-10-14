/* input wiring test: can the player actually place the Queen?
   node tools/input-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- DOM stub that records listeners and dispatches events ---------- */
function stubEl(id) {
  const listeners = {};
  const el = {
    id: id || '',
    textContent: '', innerHTML: '', value: '',
    style: { cssText: '', width: '', height: '' },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    listeners,
    addEventListener(t, fn) { (listeners[t] || (listeners[t] = [])).push(fn); },
    removeEventListener(t, fn) {
      if (!listeners[t]) return;
      listeners[t] = listeners[t].filter(f => f !== fn);
    },
    dispatch(type, evt) { (listeners[type] || []).forEach(fn => fn(evt)); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 480, height: 288, right: 480, bottom: 288 }; },
    appendChild() {}, remove() {}, closest() { return null; },
    getAttribute() { return null; }, setAttribute() {},
    parentNode: { appendChild() {} },
    width: 480, height: 288, offsetWidth: 480, offsetHeight: 288
  };
  return el;
}

const els = {};
const winListeners = {};
function mkCanvas(w, h) {
  const c = stubEl('canvas');
  c.width = w || 1; c.height = h || 1;
  c.getContext = () => noopCtx;
  return c;
}
const canvas = mkCanvas(480, 288);
els['game'] = canvas;

const document = {
  readyState: 'complete',
  createElement: (t) => (t === 'canvas' ? mkCanvas() : stubEl(t)),
  getElementById: (id) => (els[id] || (els[id] = stubEl(id))),
  addEventListener() {}
};

const noopCtx = new Proxy({}, {
  get(t, k) {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'getImageData' || k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w || 1) * (h || 1) * 4)), width: w, height: h });
    if (k in t) return t[k];
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; }
});

const sandbox = {
  console, Math, JSON, Date, Object, Array, String, Number, Boolean, Error, isNaN, parseInt, parseFloat,
  Uint8Array, Uint8ClampedArray, Int8Array, Int16Array, Int32Array, Set, Map, Promise, Symbol, RegExp,
  Function, Infinity, NaN, undefined,
  document,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  innerWidth: 1280, innerHeight: 900,
  addEventListener: (t, fn) => { (winListeners[t] || (winListeners[t] = [])).push(fn); },
  removeEventListener: () => {},
  confirm: () => false,
  localStorage: {
    _d: {},
    getItem(k) { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); }
  },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary')
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.fire = (type, evt) => (winListeners[type] || []).forEach(fn => fn(evt));
vm.createContext(sandbox);

for (const f of ['util.js', 'pixel.js', 'world.js', 'entities.js', 'catalog.js', 'ants.js', 'events.js', 'ui.js', 'game.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), sandbox, { filename: f });
}

const CFG = sandbox.CFG, T = sandbox.T, T8 = CFG.TILE;
const game = new sandbox.Game(canvas);
game.ui.resize = () => {};

const fail = [];
function check(label, cond, extra) {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? '   ' + extra : ''));
  if (!cond) fail.push(label);
}

/* ---- 1. the title screen has a working DIG IN button ---- */
check('title screen visible at boot', els['title'].classList.contains('hidden') === false);
check('#begin has a click handler', !!(els['begin'].listeners.click && els['begin'].listeners.click.length),
  JSON.stringify(Object.keys(els['begin'].listeners)));

els['begin'].dispatch('click', {});
check('phase becomes "place" after DIG IN', game.phase === 'place', 'phase=' + game.phase);
check('title overlay hidden', els['title'].classList.contains('hidden'));
check('HUD shown', !els['hud'].classList.contains('hidden'));

/* ---- 2. the canvas has mousedown, window has mouseup ---- */
check('canvas has mousedown', !!(canvas.listeners.mousedown && canvas.listeners.mousedown.length));
check('window has mouseup', !!(winListeners.mouseup && winListeners.mouseup.length));
check('window has mousemove', !!(winListeners.mousemove && winListeners.mousemove.length));

/* ---- 3. click a valid deep spot and see if she is placed ---- */
const w = game.world;
let spot = null;
for (let ty = 24; ty < 40 && !spot; ty++) {
  for (let tx = 34; tx < 62; tx++) {
    if (game.canPlace(tx * 8 + 4, ty * 8 + 4)) { spot = { tx, ty }; break; }
  }
}
check('a valid queen spot exists', !!spot, spot ? spot.tx + ',' + spot.ty : 'none found');

if (spot) {
  const sx = (spot.tx * 8 + 4 - game.camX) * game.zoom;
  const sy = (spot.ty * 8 + 4 - game.camY) * game.zoom;

  // the ghost queen must follow the pointer before the click
  sandbox.fire('mousemove', { clientX: sx, clientY: sy });
  check('pointer tracked for the ghost', Math.abs(game.mouse.x - (spot.tx * 8 + 4 - game.camX)) < 1.5,
    'mouse=' + game.mouse.x.toFixed(1) + ',' + game.mouse.y.toFixed(1));

  canvas.dispatch('mousedown', { button: 0, clientX: sx, clientY: sy, preventDefault() {} });
  sandbox.fire('mouseup', { button: 0, clientX: sx, clientY: sy });
  check('queen placed on canvas click', game.phase === 'play', 'phase=' + game.phase);
  check('queen exists', !!game.queen, game.queen ? 'hp=' + game.queen.hp : 'none');
  check('entrance found', !!game.entrance, JSON.stringify(game.entrance));
  check('food nodes placed', game.foodNodes.length > 0, 'nodes=' + game.foodNodes.length);

  /* ---- in-game clicks: select an ant, then order work ---- */
  const qx = game.queen.x, qy = game.queen.y;
  const csx = (qx - game.camX) * game.zoom, csy = (qy - 4 - game.camY) * game.zoom;
  sandbox.fire('mousemove', { clientX: csx, clientY: csy });
  canvas.dispatch('mousedown', { button: 0, clientX: csx, clientY: csy, preventDefault() {} });
  sandbox.fire('mouseup', { button: 0, clientX: csx, clientY: csy });
  check('clicking the queen selects her', game.selected === game.queen,
    'selected=' + (game.selected ? game.selected.role : 'none'));

  game.selected = null;
  const before = game.jobs.length;
  const dx = (qx + 40 - game.camX) * game.zoom, dy = (qy - 4 - game.camY) * game.zoom;
  sandbox.fire('mousemove', { clientX: dx, clientY: dy });
  canvas.dispatch('mousedown', { button: 0, clientX: dx, clientY: dy, preventDefault() {} });
  sandbox.fire('mouseup', { button: 0, clientX: dx, clientY: dy });
  check('clicking empty ground issues an order or warns',
    game.jobs.length > before || !!game.ui.toastMsg,
    'jobs ' + before + '->' + game.jobs.length + ' toast="' + game.ui.toastMsg + '"');

  /* ---- dragging pans instead of clicking ---- */
  const camBefore = game.camX;
  canvas.dispatch('mousedown', { button: 0, clientX: dx, clientY: dy, preventDefault() {} });
  sandbox.fire('mousemove', { clientX: dx + 60, clientY: dy });
  sandbox.fire('mouseup', { button: 0, clientX: dx + 60, clientY: dy });
  check('drag pans the camera', game.camX !== camBefore, 'camX ' + camBefore.toFixed(0) + '->' + game.camX.toFixed(0));
  check('drag did not queue a job', game.selected === null || game.selected !== game.queen);
}

/* ---- 4. clicking an invalid spot must at least warn, not crash ---- */
try {
  canvas.dispatch('mousedown', { button: 0, clientX: 20, clientY: 8, preventDefault() {} });
  sandbox.fire('mouseup', { button: 0, clientX: 20, clientY: 8 });
  check('invalid click does not throw', true);
} catch (e) {
  check('invalid click does not throw', false, e.message);
}

/* ---- 5. why might every click be rejected? report canPlace coverage ---- */
let ok = 0, tot = 0, reasons = { notDirt: 0, tooShallow: 0, tooDeep: 0, bedrockBand: 0, noRoom: 0, stone: 0 };
for (let ty = 14; ty < 44; ty++) {
  for (let tx = 4; tx < w.w - 4; tx++) {
    tot++;
    if (game.canPlace(tx * 8 + 4, ty * 8 + 4)) { ok++; continue; }
    const tile = w.at(tx, ty);
    const s = w.surface[tx];
    if (tile !== T.DIRT) reasons.notDirt++;
    else if (ty < s + 5) reasons.tooShallow++;
    else if (ty > s + 15) reasons.tooDeep++;
    else if (ty > w.h - 5) reasons.bedrockBand++;
    else if (!game.entrancePlan(tx, ty).ok) reasons.noRoom++;
    else reasons.stone++;
  }
}
console.log('\n  clickable tiles: ' + ok + ' / ' + tot);
console.log('  rejected: ' + JSON.stringify(reasons));
if (ok < tot * 0.05) fail.push('almost nowhere is placeable (' + ok + '/' + tot + ')');

console.log('\n' + (fail.length ? '*** ' + fail.length + ' FAILURE(S) ***' : '*** PASS ***'));
process.exit(fail.length ? 1 : 0);
