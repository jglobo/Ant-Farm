/* ============================================================
  events.js  the sky, the weather and the things that hunt you
  ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG, U = global.U, T8 = CFG.TILE;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }

  var DEBRIS_TABLE = [
    ['leaf', 30], ['bigleaf', 10], ['twig', 16], ['crumb', 16],
    ['seed', 12], ['feather', 8], ['berry', 8]
  ];

  function EventSystem(game) {
    this.game = game;
    this.timers = {};
    this.rain = { active: false, t: 0, dur: 0, intensity: 0, spawnAcc: 0 };
    this.sand = { active: false, t: 0, dur: 0, spawnAcc: 0 };
    this.raidActive = 0;
    this.drops = [];          // visual precipitation
    this.day = 1;
    // Start mid-morning rather than at zero: phase 0 is midnight, so a fresh
    // colony would open in the dark with no explanation.
    this.DAY_LEN = 150;
    this.dayT = this.DAY_LEN * 0.3;
    this.wind = 0;
    this.windT = 0;
    this.calendar = [];
    this.resetTimers();
  }
  var P = EventSystem.prototype;

  P.resetTimers = function () {
    var g = this.game, E = CFG.EVE;
    this.timers.debris = rand(E.debris[0], E.debris[1]);
    this.timers.raid = rand(E.raid[0], E.raid[1]);
    this.timers.rain = rand(E.rain[0], E.rain[1]);
    this.timers.sand = rand(E.sand[0], E.sand[1]);
  };

  /** 0..1 through the day; 0.25 = noon, 0.75 = midnight */
  P.dayPhase = function () { return (this.dayT % this.DAY_LEN) / this.DAY_LEN; };
  P.isNight = function () { var p = this.dayPhase(); return p > 0.72 || p < 0.20; };
  P.clock = function () {
    var mins = Math.floor(this.dayPhase() * 1440);
    var hh = String(Math.floor(mins / 60)).padStart(2, '0');
    var mm = String(mins % 60).padStart(2, '0');
    return 'DAY ' + this.day + ' ' + hh + ':' + mm;
  };
  /** how long until the next scheduled thing, for the HUD */
  P.nextUp = function () {
    var best = null, bt = 1e9;
    for (var k in this.timers) {
      if (this.timers[k] < bt) { bt = this.timers[k]; best = k; }
    }
    var names = { debris: 'DEBRIS', raid: 'RAID', rain: 'RAIN', sand: 'SANDSTORM' };
    return { label: names[best] || '?', t: Math.max(0, bt) };
  };

  P.update = function (dt) {
    var g = this.game, w = g.world;

    // clock
    this.dayT += dt;
    while (this.dayT >= this.DAY_LEN) { this.dayT -= this.DAY_LEN; this.day++; g.onNewDay(this.day); }

    // wind wanders
    this.windT -= dt;
    if (this.windT <= 0) { this.windT = rand(3, 8); this.wind = rand(-1, 1); }

    // count active raiders
    var enemies = 0;
    for (var i = 0; i < g.ants.length; i++) if (g.ants[i].isEnemy && !g.ants[i].dead) enemies++;
    this.raidActive = enemies;

    // scheduled triggers
    for (var key in this.timers) {
      if (this.rain.active && key === 'rain') continue;
      if (this.sand.active && key === 'sand') continue;
      this.timers[key] -= dt;
      // give the colony a heads-up before the hornet nest opens
      if (key === 'raid' && !this.raidWarned && this.timers.raid < 14 && this.timers.raid > 0) {
        this.raidWarned = true;
        g.banner('SCOUTS SPOTTED', 'RAIDERS ARE CLOSING IN', 'warn');
      }
      if (this.timers[key] <= 0) {
        this.fire(key);
        this.timers[key] = this.nextDelay(key);
        if (key === 'raid') this.raidWarned = false;
      }
    }

    this.updateRain(dt);
    this.updateSand(dt);
    this.updateDrops(dt);
  };

  P.nextDelay = function (key) {
    var E = CFG.EVE[key];
    var base = rand(E[0], E[1]);
    if (key === 'raid') base *= U.clamp(1 - g_count(this.game) * 0.012, 0.6, 1);
    return base;
  };

  P.fire = function (key) {
    var g = this.game;
    if (key === 'debris') this.spawnDebris();
    else if (key === 'raid') this.spawnRaid();
    else if (key === 'rain') this.startRain();
    else if (key === 'sand') this.startSand();
  };

  function g_count(game) { return game.countAnts(); }

  /* ---------------- falling debris ---------------- */
  P.spawnDebris = function () {
    var g = this.game, w = g.world;
    var kind = weighted(DEBRIS_TABLE);
    var n = Math.random() < 0.22 ? randInt(2, 4) : 1;
    var fromSky = Math.random() < 0.75;
    // On the big map, most debris lands within foraging reach of the nest;
    // the rest anywhere, as a reason to range further.
    var ent = g.entranceSpot ? g.entranceSpot() : null;
    var centre = ent ? ent.x : (g.queen ? g.queen.tileX() : w.w >> 1);
    var near = Math.random() < 0.7;
    for (var i = 0; i < n; i++) {
      var tx = near ? U.clamp(centre + randInt(-36, 36), 2, w.w - 3) : randInt(2, w.w - 3);
      var y;
      if (fromSky) {
        y = -10 - Math.random() * 30;
      } else {
        y = w.surface[tx] * T8 - 4;
      }
      g.foods.push(new global.FoodItem(tx * T8 + rand(1, 7), y, kind));
    }
    g.toast(pickLine(['SOMETHING FELL FROM THE SKY', 'DEBRIS INBOUND', 'THE SKY IS GIVING', 'SOMETHING LANDED UP TOP']));
  };

  /* ---------------- raids ---------------- */
  P.spawnRaid = function () {
    var g = this.game, w = g.world;
    if (g.gameOver) return;
    if (!g.queen) return;

    var army = 0, pop = 0;
    for (var i = 0; i < g.ants.length; i++) {
      if (g.ants[i].dead || g.ants[i].isEnemy) continue;
      pop++;
      if (g.ants[i].role === 'army') army++;
    }
    // never pile on a colony that is already losing
    if (this.raidActive >= 4) return;

    // Pressure tracks the colony. A two-ant nest should be pestered, not
    // overrun -- the early game needs room to get its first workers foraging.
    var strength = 0.55 + Math.min(1.5, pop * 0.085) + Math.min(1.3, (this.day - 1) * 0.1)
      - Math.min(0.6, army * 0.18);
    strength = U.clamp(strength, 0.4, 3);
    var count = U.clamp(Math.round(1 + strength * 1.5), 1, 7);

    var thieves = (this.day >= 3 && strength > 1.2 && Math.random() < 0.4) ? 1 : 0;
    var brutes = (this.day >= 4 && strength > 1.6 && Math.random() < 0.25) ? 1 : 0;
    count = Math.max(1, count - thieves - brutes);

    var side = Math.random() < 0.5 ? -1 : 1;
    var qx = g.queen.tileX();
    var baseTx = qx + side * randInt(16, 30);
    baseTx = U.clamp(baseTx, 1, w.w - 2);

    for (i = 0; i < count; i++) {
      this.spawnEnemy('raider', U.clamp(baseTx + randInt(-3, 3), 1, w.w - 2));
    }
    for (i = 0; i < thieves; i++) this.spawnEnemy('thief', U.clamp(baseTx + randInt(-5, 5), 1, w.w - 2));
    for (i = 0; i < brutes; i++) this.spawnEnemy('brute', U.clamp(baseTx + randInt(-2, 2), 1, w.w - 2));

    g.stats.raids++;
    g.banner('RAIDERS INCOMING', brutes ? 'A BRUTE IS WITH THEM' : 'DEFEND THE QUEEN', 'warn');
    g.pulseRaid = 1;
  };

  P.spawnEnemy = function (role, tx) {
    var g = this.game, w = g.world;
    var sy = w.surface[U.clamp(tx, 0, w.w - 1)];
    // standing on the grass, not a tile up in the air
    var a = new global.Ant(tx * T8 + 4, sy * T8 - 0.01, role);
    a.id = g.nextId();
    a.isEnemy = true;
    a.notice = 1;
    g.ants.push(a);
    return a;
  };

  /* ---------------- rain ---------------- */
  P.startRain = function () {
    var g = this.game;
    this.rain.active = true;
    this.rain.t = 0;
    this.rain.dur = rand(22, 40);
    this.rain.intensity = rand(0.6, 1.5);
    g.banner('RAIN', 'BUILDERS: DAM THE SHAFTS', 'warn');
  };

  P.updateRain = function (dt) {
    var r = this.rain, g = this.game, w = g.world;
    if (!r.active) return;
    r.t += dt;
    r.intensity = U.lerp(r.intensity, 0.5 + 0.9 * Math.sin(U.clamp(r.t / r.dur, 0, 1) * Math.PI), dt * 0.6);
    if (r.t >= r.dur) {
      r.active = false;
      g.toast('THE RAIN PASSES');
      return;
    }
    // the same density of drops across a wider sky
    r.spawnAcc += dt * 6.5 * r.intensity * (w.w / 96);
    while (r.spawnAcc >= 1) {
      r.spawnAcc -= 1;
      this.drops.push({ x: rand(0, w.w * T8), y: -2, v: rand(260, 340), sand: false });
    }
  };

  /* ---------------- sandstorm ---------------- */
  P.startSand = function () {
    var g = this.game;
    this.sand.active = true;
    this.sand.t = 0;
    this.sand.dur = rand(16, 28);
    g.banner('SANDSTORM', 'THE TUNNELS ARE FILLING', 'warn');
  };

  P.updateSand = function (dt) {
    var s = this.sand, g = this.game, w = g.world;
    if (!s.active) return;
    s.t += dt;
    if (s.t >= s.dur) {
      s.active = false;
      g.toast('THE AIR CLEARS');
      return;
    }
    s.spawnAcc += dt * 5 * (w.w / 96);
    while (s.spawnAcc >= 1) {
      s.spawnAcc -= 1;
      this.drops.push({ x: rand(0, w.w * T8), y: -2, v: rand(90, 160), sand: true });
    }
  };

  /* ---------------- precipitation physics (visual + deposition) ---------------- */
  P.updateDrops = function (dt) {
    var w = this.game.world;
    var list = this.drops;
    for (var i = list.length - 1; i >= 0; i--) {
      var d = list[i];
      d.v += (d.sand ? 90 : 260) * dt;
      d.x += this.wind * (d.sand ? 26 : 10) * dt;
      d.y += d.v * dt;
      if (d.x < 0) d.x += w.w * T8;
      if (d.x > w.w * T8) d.x -= w.w * T8;

      var tx = Math.floor(d.x / T8), ty = Math.floor(d.y / T8);
      if (ty >= w.h) { list.splice(i, 1); continue; }

      if (!d.sand) {
        if (w.solidAt(tx, ty) || d.y > w.surface[U.clamp(tx, 0, w.w - 1)] * T8) {
          // Deposit in the open tile the drop landed on top of. Searching
          // DOWNWARD from a solid impact tunnelled rain straight through the
          // ground into sealed caves, so no dam could ever keep it out; on
          // the surface it pools and only reaches the nest down open shafts.
          var ax = U.clamp(tx, 0, w.w - 1);
          var ay = U.clamp(ty, 0, w.h - 1);
          while (ay > 0 && w.solidAt(ax, ay)) ay--;
          if (!w.solidAt(ax, ay)) w.addWater(ax, ay, 1);
          list.splice(i, 1);
        }
      } else {
        if (w.solidAt(tx, ty) || w.sandAtPx(d.x, d.y) > 0) {
          // same rule for sand: it settles on whatever it hit
          var bx = U.clamp(tx, 0, w.w - 1);
          var by = U.clamp(ty, 0, w.h - 1);
          while (by > 0 && w.solidAt(bx, by)) by--;
          if (!w.solidAt(bx, by)) w.addSand(bx, by, 2);
          list.splice(i, 1);
        }
      }
    }
    if (list.length > 2100) list.splice(0, list.length - 2100);
  };

  P.drawDrops = function (ctx, camX, camY) {
    var list = this.drops, g = this.game;
    var vw = g.viewW ? g.viewW() : CFG.VIEW_W, vh = g.viewH ? g.viewH() : CFG.VIEW_H;
    ctx.globalAlpha = 0.55;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      var x = Math.round(d.x - camX), y = Math.round(d.y - camY);
      if (x < -2 || y < -4 || x > vw + 2 || y > vh + 2) continue;
      if (d.sand) { ctx.fillStyle = '#d8c084'; ctx.fillRect(x, y, 1, 1); }
      else { ctx.fillStyle = '#9fd0f0'; ctx.fillRect(x, y, 1, 3); }
    }
    ctx.globalAlpha = 1;
  };

  /* ---------------- helpers ---------------- */
  function weighted(table) {
    var total = 0, i;
    for (i = 0; i < table.length; i++) total += table[i][1];
    var r = Math.random() * total;
    for (i = 0; i < table.length; i++) {
      r -= table[i][1];
      if (r <= 0) return table[i][0];
    }
    return table[0][0];
  }

  var LINES = [
    'SOMETHING FELL FROM THE SKY', 'DEBRIS INBOUND', 'THE SKY IS GIVING', 'SOMETHING LANDED UP TOP',
    'THE WIND CHANGES', 'SOMETHING DRIFTS PAST', 'A CLOUD PASSES OVER'
  ];
  function pickLine(a) { return a[Math.floor(Math.random() * a.length)]; }

  global.EventSystem = EventSystem;
})(window);
