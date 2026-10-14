/* ============================================================
  util.js  tuning constants, math, RNG, noise
  ============================================================ */
(function (global) {
  'use strict';

  var CFG = {
    TILE: 8,
    W: 288, H: 144,               // world size in tiles (3x the original 96 x 48 each way)
    VIEW_W: 480, VIEW_H: 288,     // internal pixel resolution (60 x 36 tiles)
    ZOOMS: [0.5, 1, 2, 3],        // wheel steps; 0.5 shows a quarter of the map's width

    G: 900,                       // gravity px/s^2
    MAX_FALL: 320,
    CLIMB: 0.65,                  // climbing speed as a fraction of walking speed

    // ---- ant roles ----
    // w/h are the sprite's body size. Every ant but the queen collides as a
    // 6px-wide box (cw/ch) so it fits any one-tile shaft it can path through.
    // atk is damage per bite; everyone bites once per ATTACK_INTERVAL.
    // Workers are a shade quicker than raiders so a forager can break away.
    ROLE: {
      queen:    { name: 'QUEEN',    hp: 100, w: 16, h: 10, cw: 16, ch: 10, speed: 14, atk: 5, color: '#e8b24a' },
      gatherer: { name: 'GATHERER', hp: 5,   w: 10, h: 5,  speed: 34, atk: 1, color: '#e0903c' },
      builder:  { name: 'BUILDER',  hp: 5,   w: 10, h: 5,  speed: 26, atk: 1, color: '#5fb0d8' },
      nurse:    { name: 'NURSE',    hp: 5,   w: 10, h: 5,  speed: 26, atk: 1, color: '#8fd85f' },
      army:     { name: 'ARMY',     hp: 10,  w: 13, h: 6,  speed: 29, atk: 3, color: '#d8483a' },
      raider:   { name: 'RAIDER',   hp: 3,   w: 10, h: 5,  speed: 23, atk: 2, color: '#8a3328', enemy: true },
      thief:    { name: 'THIEF',    hp: 3,   w: 10, h: 5,  speed: 30, atk: 2, color: '#a8662e', enemy: true },
      brute:    { name: 'BRUTE',    hp: 7,   w: 14, h: 7,  speed: 18, atk: 2, color: '#5a2a24', enemy: true }
    },
    ATTACK_INTERVAL: 1.0,          // seconds between bites, for everyone
    CW: 6, CH: 6,                  // default collision box

    // ---- economy ----
    EGG_COST: 2,
    HEAL_COST: 3, HEAL_AMOUNT: 2,     // food spent / hp restored
    LAY_BASE: 6, LAY_MIN: 2, LAY_FOOD_SCALE: 22,
    HATCH_BASE: 30, HATCH_PER_NURSE: 0.16, HATCH_MAX_CUT: 0.72,
    NURSE_RADIUS: 2,                  // tiles

    // ---- combat ----
    MELEE_RANGE: 11, QUEEN_MELEE: 15,
    STRUCT_HP: 3,
    STRUCT_BITE: 1, BRUTE_SMASH: 2,    // damage enemies do to walls per bite
    DEFEND_MIN: 8,                     // a called defence lasts at least this long

    // ---- jobs ----
    DIG_TIME: 0.42, BUILD_TIME: 0.5, REPAIR_TIME: 0.38,
    CARRY: 5,                          // food per gatherer trip
    MAX_ANTS: 160,

    // ---- fluids ----
    FLUID_HZ: 20, WATER_MAX: 8, SAND_MAX: 8,
    DROWN_AMOUNT: 4,                   // water amount at which ants start drowning

    // ---- events ----
    EVE: {
      debris: [11, 24],
      raid:   [95, 165],
      rain:   [70, 130],
      sand:   [190, 320]
    }
  };

  /* ---------------- math ---------------- */
  var U = {
    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    sign: function (v) { return v < 0 ? -1 : v > 0 ? 1 : 0; },
    dist: function (ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); },
    dist2: function (ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },
    TAU: Math.PI * 2,

    // frame-rate independent smoothing factor
    damp: function (rate, dt) { return 1 - Math.exp(-rate * dt); },

    // value noise (1D, smooth)
    noise1: function (x, seed) {
      var i = Math.floor(x), f = x - i;
      var a = U.hash1(i, seed), b = U.hash1(i + 1, seed);
      var t = f * f * (3 - 2 * f);
      return a + (b - a) * t;
    },
    fbm1: function (x, seed, oct) {
      var v = 0, amp = 0.5, freq = 1, norm = 0;
      for (var k = 0; k < (oct || 4); k++) {
        v += U.noise1(x * freq, seed + k * 7919) * amp;
        norm += amp; amp *= 0.5; freq *= 2;
      }
      return v / norm;
    },
    hash1: function (i, seed) {
      var n = (i * 374761393 + (seed || 0) * 668265263) >>> 0;
      n = (n ^ (n >>> 13)) >>> 0;
      n = (Math.imul(n, 1274126177) >>> 0);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    }
  };

  /* ---------------- RNG (mulberry32) ---------------- */
  function RNG(seed) {
    this.s = (seed >>> 0) || 1;
  }
  RNG.prototype.next = function () {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    var t = this.s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.range = function (a, b) { return a + this.next() * (b - a); };
  RNG.prototype.int = function (a, b) { return Math.floor(a + this.next() * (b - a + 1)); };
  RNG.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };
  RNG.prototype.chance = function (p) { return this.next() < p; };
  RNG.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this.next() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  global.CFG = CFG;
  global.U = U;
  global.RNG = RNG;
})(window);
