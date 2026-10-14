/* ============================================================
  game.js  state, economy, jobs, camera, rendering
  ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG, U = global.U, PX = global.PX, T8 = CFG.TILE;
  var DX = [-1, 1, 0, 0], DY = [0, 0, -1, 1];
  var World = global.World, T = global.T, Ant = global.Ant, Egg = global.Egg,
      FoodItem = global.FoodItem, Particle = global.Particle, AntAI = global.AntAI;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }

  /* ============================================================
    Game
    ============================================================ */
  function Game(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    this.ui = new global.UI(this);
    this.phase = 'title';        // title | place | play | over
    this.paused = false;
    this.speed = 1;
    this.zoom = 1;
    this.overlay = 0;

    this.ants = [];
    this.eggs = [];
    this.foods = [];
    this.parts = [];
    this.jobs = [];
    this.foodNodes = [];
    this.keys = {};

    this.food = 0;
    this.mat = { twig: 0, leaf: 0, dirt: 0 };
    this.layTimer = 0;
    this.layPromptOpen = false;
    this.layQueen = null;
    this.selected = null;
    this.selectedDeadAt = 0;
    this.queen = null;
    this.granary = { x: 0, y: 0 };
    this.idSeq = 1;
    this.overflow = 0;           // accumulated time above the fixed step
    this.time = 0;
    this.pulseRaid = 0;
    this.gameOver = false;
    this.stats = { born: 0, gathered: 0, raids: 0, eggs: 0, dead: 0, built: 0, dug: 0, kills: 0 };

    this.camX = 0; this.camY = 0;
    this.camTargetX = 0; this.camTargetY = 0;
    this.followQueen = true;
    this.drag = null;
    this.mouse = { x: 0, y: 0, over: false, moved: false };

    this.lightCv = PX.makeCanvas(CFG.VIEW_W, CFG.VIEW_H);
    this.lightCtx = this.lightCv.getContext('2d');

    this.newWorld(true);
    this.bindInput();
  }
  var P = Game.prototype;

  /* ============================================================
    world setup
    ============================================================ */
  P.newWorld = function (silent) {
    var seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    this.setupWorld(seed);
    // the boot world offers the saved colony; a world rolled on purpose does not
    this.resumable = !!silent && this.hasSave();
    this.paused = false;
    if (!silent) {
      this.phase = 'title';
      this.ui.showTitle(seed);
    }
  };

  /** the title screen's one action: resume the saved colony, or start placing */
  P.startFromTitle = function () {
    if (this.phase !== 'title') return;
    if (this.resumable && this.load()) return;
    this.resumable = false;
    this.beginPlacement();
  };

  P.setupWorld = function (seed) {
    this.seed = seed;
    this.world = new World(seed);
    this.events = new global.EventSystem(this);
    this.ants = []; this.eggs = []; this.foods = []; this.parts = []; this.jobs = []; this.foodNodes = [];
    this.food = 0;
    this.mat = { twig: 0, leaf: 0, dirt: 0 };
    this.queen = null; this.granary = { x: 0, y: 0 };
    this.layTimer = 0; this.layPromptOpen = false; this.layQueen = null;
    this.selected = null; this.gameOver = false; this.phase = 'title';
    this.idSeq = 1; this.time = 0;
    this.jobT = 0; this.nodeT = 0;
    this.defending = false; this.defendT = 0;
    this.entrance = null;
    this.stats = { born: 0, gathered: 0, raids: 0, eggs: 0, dead: 0, built: 0, dug: 0, kills: 0 };
    this.zoom = 1;
    this.centerCamera();
    this.world.rebuildBg();
    this.spawnFoodNodes(Math.round(9 * this.world.w / 96));
  };

  /** the middle of the map, with the grass line near the top of the view */
  P.centerCamera = function () {
    var w = this.world;
    this.camX = (w.w * T8 - this.viewW()) / 2;
    this.camY = U.clamp(w.surface[w.w >> 1] * T8 - this.viewH() * 0.3, 0, w.h * T8 - this.viewH());
    this.camTargetX = this.camX; this.camTargetY = this.camY;
  };

  P.snapToQueen = function () {
    this.followQueen = true;
    if (this.queen) this.snapCamToQueen();
  };

  P.snapCamToQueen = function () {
    var q = this.queen; if (!q) return;
    this.camX = U.clamp(q.x - this.viewW() / 2, 0, Math.max(0, this.world.w * T8 - this.viewW()));
    this.camY = U.clamp(q.y - this.viewH() / 2, 0, Math.max(0, this.world.h * T8 - this.viewH()));
    this.camTargetX = this.camX; this.camTargetY = this.camY;
  };

  P.viewW = function () { return CFG.VIEW_W / this.zoom; };
  P.viewH = function () { return CFG.VIEW_H / this.zoom; };

  /* ============================================================
    placement
    ============================================================ */
  /**
  * The entrance staircase climbs one row per column, so a chamber at depth d
  * needs roughly d columns of clear ground to one side of it. Work out which
  * way it can run and whether there is room before the player commits.
*/
  P.entrancePlan = function (tx, ty) {
    var w = this.world;
    var surf = w.surface[U.clamp(tx, 0, w.w - 1)];
    var drift = Math.max(2, (ty - surf) + 2);       // columns the ramp will need
    var right = (w.w - 2) - (tx + 4);
    var left = (tx - 4) - 1;
    var side = right >= left ? 1 : -1;
    return { side: side, drift: drift, room: (side > 0 ? right : left), ok: (side > 0 ? right : left) >= drift };
  };

  P.beginPlacement = function () {
    this.ui.hideTitle();
    this.phase = 'place';
    this.canvas.classList.add('place');
    this.followQueen = false;
    this.centerCamera();
    this.ui.banner('CHOOSE YOUR QUEEN', 'CLICK DEEP DIRT TO BEGIN', '');
  };

  P.canPlace = function (wx, wy) {
    var w = this.world;
    var tx = Math.floor(wx / T8), ty = Math.floor(wy / T8);
    if (!w.inBounds(tx, ty)) return false;
    var t = w.at(tx, ty);
    if (t !== T.DIRT) return false;
    var surf = w.surface[tx];
    if (ty < surf + 5) return false;         // deep enough to be safe
    // The entrance ramp climbs one row per column, so depth also means distance.
    // Cap it, or a deep nest turns every foraging trip into a marathon.
    if (ty > surf + 15) return false;
    if (ty > w.h - 5) return false;
    if (!this.entrancePlan(tx, ty).ok) return false;   // room for the entrance ramp
    // no bedrock pocket
    for (var y = ty - 3; y <= ty + 3; y++) {
      for (var x = tx - 3; x <= tx + 3; x++) {
        if (Math.abs(x - tx) + Math.abs(y - ty) > 4) continue;
        if (w.at(x, y) === T.STONE) return false;
      }
    }
    return true;
  };

  P.placeQueen = function (wx, wy) {
    var w = this.world;
    var tx = Math.floor(wx / T8), ty = Math.floor(wy / T8);

    // A natural crevice runs from the chamber up to daylight, so the colony can
    // forage from the very first egg no matter what brood the player picks.
    var plan = this.entrancePlan(tx, ty);
    var side = plan.side;

    // the royal chamber: seven wide and TWO rows tall (the queen is too tall
    // for one), with a solid floor. Everything the colony digs is two rows so
    // the queen and the workers have headroom to climb out of it again.
    w.carveBox(tx - 3, ty, 7, 2);
    // a sound floor under the whole chamber: a natural cave beneath it would
    // otherwise leave a hole the brood (and the queen's route home) falls into
    for (var fx = tx - 3; fx <= tx + 3; fx++) {
      if (!isSolidTile(w.at(fx, ty + 2))) w.set(fx, ty + 2, T.DIRT);
    }
    // The staircase starts one row lower so its first landing is level with the
    // chamber floor -- otherwise the exit is a one-tile step the ant cannot take
    // out of a two-row room, and the colony is sealed in.
    this.carveShaft(tx + 4 * side, ty + 2, side);
    w.setHome(tx, ty + 1);            // the floor row of the chamber, where she stands

    var q = new Ant(tx * T8 + T8 / 2, (ty + 2) * T8 - 0.01, 'queen');
    q.id = this.nextId();
    this.ants.push(q);
    this.queen = q;

    // make absolutely sure the surface is walkable from the chamber
    if (!this.surfaceReachable(tx, ty + 1)) {
      this.carveShaft(tx + 4 * side, ty + 2, side);
      w.markAllDirty();
    }
    // the granary is a spot on the chamber floor
    this.granary = { x: (tx - 2) * T8 + T8 / 2, y: (ty + 2) * T8 - 0.01 };

    this.food = CFG.EGG_COST + 1;
    this.mat = { twig: 1, leaf: 1, dirt: 0 };
    this.layTimer = 1.2;
    this.phase = 'play';
    this.followQueen = true;
    this.canvas.classList.remove('place');
    this.snapCamToQueen();

    this.ui.banner('THE QUEEN IS SAFE', 'SHE WILL ASK WHAT TO LAY', 'good');
    this.scatterFoodNodes();
    this.events.timers.raid = rand(170, 210);
    this.events.timers.rain = rand(55, 80);
    this.save();
  };

  /* ============================================================
    economy
    ============================================================ */
  P.nextId = function () { return this.idSeq++; };

  P.deposit = function (ant) {
    if (ant.carry > 0) {
      this.food += ant.carry;
      this.stats.gathered += ant.carry;
      this.puff(this.granary.x, this.granary.y - 4, '#e8b24a', 4);
      this.floatText(this.granary.x, this.granary.y - 16, '+' + ant.carry, '#e8b24a');
    }
    if (ant.carryKind) {
      this.mat[ant.carryKind] += 1;
      this.puff(this.granary.x, this.granary.y - 6, '#7d5430', 2);
    }
    ant.carry = 0; ant.carryKind = null; ant.carryArt = null;
  };

  P.stealFood = function (n) {
    var t = Math.min(this.food, n);
    this.food -= t;
    return t;
  };

  P.spendFor = function (kind) {
    var m = this.mat;
    var order = kind === 'twig' ? ['twig', 'leaf', 'dirt']
      : kind === 'leaf' ? ['leaf', 'twig', 'dirt']
        : ['dirt', 'twig', 'leaf'];
    for (var i = 0; i < order.length; i++) {
      if (m[order[i]] > 0) { m[order[i]]--; return true; }
    }
    return false;
  };

  P.layCooldownFor = function () {
    return CFG.LAY_MIN + (CFG.LAY_BASE - CFG.LAY_MIN) * Math.exp(-this.food / CFG.LAY_FOOD_SCALE);
  };

  P.openLayPrompt = function (queen) {
    if (this.layPromptOpen) return;
    this.layPromptOpen = true;
    this.layQueen = queen;
    this.ui.openLay();
  };

  P.chooseLay = function (role) {
    if (!this.layPromptOpen) return;
    this.layPromptOpen = false;
    this.ui.closeLay();
    var q = this.layQueen || this.queen;
    this.layQueen = null;
    if (!q) return;

    if (role && this.food >= CFG.EGG_COST) {
      this.food -= CFG.EGG_COST;
      var spot = this.findNurserySpot();
      var e = new Egg(spot.x, spot.y, role);
      this.eggs.push(e);
      this.stats.eggs++;
      this.layTimer = this.layCooldownFor();
      this.puff(spot.x, spot.y - 3, '#f3ead2', 6);
    } else if (role) {
      this.ui.toast('NOT ENOUGH FOOD FOR AN EGG');
      this.layTimer = 2;
    } else {
 // she holds it she will offer again shortly
      this.layTimer = 2.5;
    }
  };

  P.findNurserySpot = function () {
    var w = this.world, q = this.queen;
    var qx = q ? q.tileX() : Math.floor(this.world.w / 2);
    var qy = q ? q.tileY() : 24;
    var best = { x: qx * T8 + T8 / 2, y: (qy + 1) * T8 };
    var bestD = 1e9;
    for (var r = 1; r <= 6; r++) {
      for (var y = qy - r; y <= qy + r; y++) {
        for (var x = qx - r; x <= qx + r; x++) {
          if (!w.inBounds(x, y)) continue;
          var t = w.at(x, y);
          if (t !== T.TUNNEL && t !== T.AIR) continue;
          if (!w.standable(x, y)) continue;
          if (w.sand[y * w.w + x] > 2) continue;
          // lay beside the existing brood, not on top of it
          var px = x * T8 + T8 / 2, py = (y + 1) * T8, taken = false;
          for (var k = 0; k < this.eggs.length; k++) {
            if (Math.abs(this.eggs[k].x - px) < 3 && Math.abs(this.eggs[k].y - py) < 3) { taken = true; break; }
          }
          if (taken) continue;
          var d = Math.abs(x - qx) + Math.abs(y - qy);
          if (d < bestD) {
            bestD = d;
            best = { x: x * T8 + T8 / 2, y: (y + 1) * T8 };
          }
        }
      }
      if (bestD < 1e9 && r >= 3) break;
    }
    if (bestD >= 1e9) {
      // every floor tile nearby already holds an egg: nudge it alongside one
      best.x += (this.eggs.length % 2 ? -1 : 1) * (2 + (this.eggs.length % 3));
    }
    return best;
  };

  /* ============================================================
    food nodes (surface bushes)
    ============================================================ */
  P.spawnFoodNodes = function (n) {
    var w = this.world;
    for (var i = 0; i < n; i++) {
      var tx = randInt(3, w.w - 4);
      if (this.queen && Math.abs(tx - this.queen.tileX()) < 8) continue;
      this.foodNodes.push({
        tx: tx, ty: w.surface[tx], t: rand(2, 26),
        kind: ['bush', 'stones', 'log', 'crumbs'][randInt(0, 3)],
        seed: Math.random() * 100
      });
    }
  };

  /**
  * Re-seed the surface once the nest mouth is known. Most of the colony's
  * supper is placed close to the entrance: a forager that has to cross half
  * the map twice a day starves the brood.
*/
  P.scatterFoodNodes = function () {
    var w = this.world;
    this.foodNodes = [];
    var ent = this.entranceSpot();
    var base = ent ? ent.x : Math.floor(w.w / 2);
    var i, tx;
    // A few patches sit right on the nest mouth. A forager that has to cross
    // half the map twice a day starves the brood, and the long climb back is
    // exactly where a colony's food economy tends to break.
    for (i = 0; i < 3; i++) {
      tx = U.clamp(base + randInt(-2, 2), 2, w.w - 3);
      this.foodNodes.push({
        tx: tx, ty: w.surface[tx], t: rand(1, 8),
        kind: ['bush', 'stones', 'log', 'crumbs'][randInt(0, 3)],
        seed: Math.random() * 100
      });
    }
    for (i = 0; i < 5; i++) {
      tx = U.clamp(base + randInt(-10, 10), 2, w.w - 3);
      this.foodNodes.push({
        tx: tx, ty: w.surface[tx], t: rand(2, 16),
        kind: ['bush', 'stones', 'log', 'crumbs'][randInt(0, 3)],
        seed: Math.random() * 100
      });
    }
    // a wider ring worth an expedition, then a scatter across the big map
    for (i = 0; i < 6; i++) {
      tx = U.clamp(base + randInt(-32, 32), 2, w.w - 3);
      this.foodNodes.push({
        tx: tx, ty: w.surface[tx], t: rand(3, 20),
        kind: ['bush', 'stones', 'log', 'crumbs'][randInt(0, 3)],
        seed: Math.random() * 100
      });
    }
    for (i = 0; i < Math.round(4 * w.w / 96); i++) {
      tx = randInt(3, w.w - 4);
      this.foodNodes.push({
        tx: tx, ty: w.surface[tx], t: rand(4, 30),
        kind: ['bush', 'stones', 'log', 'crumbs'][randInt(0, 3)],
        seed: Math.random() * 100
      });
    }
  };

  P.updateFoodNodes = function (dt) {
    // night slows the surface growth (this was 1.6, i.e. FASTER at night)
    var nightMul = this.events.isNight() ? 0.6 : 1;
    for (var i = 0; i < this.foodNodes.length; i++) {
      var n = this.foodNodes[i];
      n.t -= dt * nightMul;
      if (n.t > 0) continue;
      var loose = 0;
      for (var j = 0; j < this.foods.length; j++) if (!this.foods[j].dead) loose++;
      if (loose < 30) {
        var kind = n.kind === 'bush' ? 'berry' : n.kind === 'crumbs' ? 'crumb' : n.kind === 'log' ? 'twig' : 'seed';
        this.foods.push(new FoodItem(n.tx * T8 + rand(1, 6), (n.ty - 1) * T8 - 0.01, kind));
        n.t = rand(11, 24);
      } else {
        n.t = 6;
      }
    }
  };

  /* ============================================================
    jobs
    ============================================================ */
  /** where to stand to work on (x, y); notSelf for jobs that fill the tile itself */
  P.approachTile = function (x, y, ring, notSelf) {
    var w = this.world;
    if (!notSelf && w.standable(x, y)) return { x: x, y: y };
    // A floor to stand on, nearest first. A ceiling dig's neighbour is the
    // top row of a two-row room -- open air nobody can stand in -- so look a
    // ring further out when the first ring has no floor.
    ring = Math.max(2, ring || 0);
    for (var r = 1; r <= ring; r++) {
      var best = null, bd = 1e9;
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!w.inBounds(x + dx, y + dy) || !w.standable(x + dx, y + dy)) continue;
          var d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = { x: x + dx, y: y + dy }; }
        }
      }
      if (best) return best;
    }
    return { x: x, y: y };
  };

  P.jobExists = function (x, y) {
    for (var i = 0; i < this.jobs.length; i++) if (this.jobs[i].x === x && this.jobs[i].y === y) return true;
    return false;
  };

  P.addJob = function (j) {
    if (this.jobs.length >= 18) return null;
    if (this.jobExists(j.x, j.y)) return null;
    j.by = null; j.done = false; j.i = 0; j.age = 0; j.cells = j.cells || null;
    this.jobs.push(j);
    return j;
  };

  P.claimJob = function (ant) {
    var best = null, bestScore = 1e9;
    for (var i = 0; i < this.jobs.length; i++) {
      var j = this.jobs[i];
      if (j.by != null) continue;
      // not the job this ant just failed to reach
      if (j.failBy === ant.id && this.time - j.failT < 12) continue;
      var d = U.dist(ant.x, ant.y, j.x * T8 + T8 / 2, j.y * T8 + T8 / 2);
      var score = j.p * 900 + d;
      if (score < bestScore) { bestScore = score; best = j; }
    }
    if (!best) return null;
    best.by = ant.id;
    return best;
  };

  P.completeJob = function (ant) {
    if (ant.job) {
      ant.job.done = true;
      var idx = this.jobs.indexOf(ant.job);
      if (idx >= 0) this.jobs.splice(idx, 1);
      ant.job = null;
    }
    ant.state = 'idle';
    ant.t = 0;
  };

  P.releaseJob = function (ant) {
    if (ant.job) { ant.job.by = null; ant.job = null; }
  };

  /** give up a job the ant cannot get to; after a few such failures, drop it */
  P.failJob = function (ant) {
    var j = ant.job;
    if (!j) return;
    j.fails = (j.fails || 0) + 1;
    j.failBy = ant.id; j.failT = this.time;
    this.releaseJob(ant);
    if (j.fails >= 3) {
      var idx = this.jobs.indexOf(j);
      if (idx >= 0) this.jobs.splice(idx, 1);
    }
  };

  /** the director: keeps the colony with things to do */
  P.updateJobs = function (dt) {
    var w = this.world;
    // drop stale claims, and any job nobody could reach soon enough to matter
    for (var i = this.jobs.length - 1; i >= 0; i--) {
      var j = this.jobs[i];
      if (j.by != null) {
        var owner = this.antById(j.by);
        if (!owner || owner.dead || !owner.job || owner.job !== j) j.by = null;
      }
      j.age = (j.age || 0) + dt;
      if (j.by == null && j.age > 40) this.jobs.splice(i, 1);
    }

    this.jobT -= dt;
    if (this.jobT > 0) return;
    this.jobT = 0.65;
    if (!this.queen || this.gameOver) return;

    var qx = this.queen.tileX(), qy = this.queen.tileY();
    var hf = w.refreshHome();
    // never post work the colony cannot physically walk to
    var reach = function (x, y) { return w.distAt(hf, x, y) < 0xFFFF; };

 // 1. flooding always the top priority
    var leak = w.findLeak();
    if (leak && reach(leak.x, leak.y)) {
      this.addJob({
        x: leak.x, y: leak.y, kind: 'build', structure: T.THATCH,
        mat: 'leaf', p: 0
      });
    }

    // 2. repair damaged structures near the colony
    if (this.jobs.length < 6) {
      var dmg = w.findDamage(qx, qy, 22);
      if (dmg && this.reachAny(hf, dmg.x, dmg.y)) this.addJob({ x: dmg.x, y: dmg.y, kind: 'repair', p: 1 });
    }

    // 3. clear sand out of the tunnels
    if (this.jobs.length < 8 && w.sandCount > 30) {
      for (var tries = 0; tries < 40; tries++) {
        var sx = randInt(0, w.w - 1), sy = randInt(qy - 4, Math.min(w.h - 2, qy + 20));
        var si = sy * w.w + sx;
        if (w.tiles[si] !== T.TUNNEL || w.sand[si] < 3) continue;
        if (!reach(sx, sy)) continue;
        this.addJob({ x: sx, y: sy, kind: 'clear', p: 1 });
        break;
      }
    }

    // 4. make sure there is a way to the surface
    if (!this.hasSurfaceAccess() && this.jobs.length < 12) {
      this.queueShaft(qx, qy, reach);
    }

 // 5. grow the colony a room every so often, then plain digging
    if (this.jobs.length < 10) {
      if (this.tunnelCountNear(qx, qy, 9) < 46) this.queueRoom(qx, qy, reach);
    }
    var digs = 0;
    for (i = 0; i < this.jobs.length; i++) if (this.jobs[i].kind === 'dig') digs++;
    if (digs < 5) this.queueDig(qx, qy, reach);

    // 6. fortify the approach to the queen when raiders are around
    if (this.events.raidActive > 0 && this.jobs.length < 8) this.queueWall(qx, qy, reach);
  };

  /**
  * Can the colony get to this tile? The flow field only covers open cells, so
  * a solid tile (dirt to dig, a wall to mend) counts as reachable when any
  * open cell beside it is.
*/
  P.reachAny = function (f, x, y) {
    var w = this.world;
    if (w.inBounds(x, y) && w.distAt(f, x, y) < 0xFFFF) return true;
    if (w.inBounds(x - 1, y) && w.distAt(f, x - 1, y) < 0xFFFF) return true;
    if (w.inBounds(x + 1, y) && w.distAt(f, x + 1, y) < 0xFFFF) return true;
    if (w.inBounds(x, y - 1) && w.distAt(f, x, y - 1) < 0xFFFF) return true;
    if (w.inBounds(x, y + 1) && w.distAt(f, x, y + 1) < 0xFFFF) return true;
    return false;
  };

  /** a diggable tile within reach of an ant, for a builder with an empty board */
  /**
   * The royal chamber's floor is never dug out: the queen, her eggs and the
   * granary all rest on it, and holing it drops them into whatever is below.
   */
  P.protectedTile = function (x, y) {
    var w = this.world;
    if (w.homeTx == null) return false;
    var floorY = w.homeTy + 1;
    return y >= floorY && y <= floorY + 1 && Math.abs(x - w.homeTx) <= 5;
  };

  P.nearestDig = function (ant) {
    var w = this.world;
    var f = w.refreshHome();
    var ax = ant.tileX(), ay = ant.tileY();
    for (var r = 1; r <= 7; r++) {
      for (var y = ay - r; y <= ay + r; y++) {
        for (var x = ax - r; x <= ax + r; x++) {
          if (Math.max(Math.abs(x - ax), Math.abs(y - ay)) !== r) continue;
          if (!w.inBounds(x, y)) continue;
          if (!World.isDiggable(w.at(x, y))) continue;
          if (this.protectedTile(x, y)) continue;
          if (y <= w.surface[x] || y >= w.h - 3) continue;
          if (!this.reachAny(f, x, y)) continue;             // must adjoin the nest
          if (!w.standable(x, y - 1) && !w.standable(x - 1, y) && !w.standable(x + 1, y)) continue;
          return { x: x, y: y };
        }
      }
    }
    return null;
  };

  P.antById = function (id) {
    for (var i = 0; i < this.ants.length; i++) if (this.ants[i].id === id) return this.ants[i];
    return null;
  };

  /**
  * Carve the climbable staircase from the royal chamber up toward daylight.
  *
  * An ant can only step up one tile and needs an open cell above its head to
  * do it, so every column gets exactly two open rows and the floor rises one
  * row per column. That is a 45 degree ramp the colony can walk in BOTH
  * directions. (A straight vertical shaft would be a one-way trap, and so
  * would any chamber taller than two rows.)
  *
  * sy is the solid floor row of the first landing.
*/
  P.carveShaft = function (sx, sy, dir) {
    var w = this.world;
    var F = sy, x = sx, guard = 0;

    while (guard++ < 400) {
      if (!w.inBounds(x, F) || !w.inBounds(x, F - 2)) return false;
      // Guarantee a solid floor for this landing. Without it a natural cave
      // pocket can drop a pit under the ramp and strand the colony below it.
      if (F > w.surface[x]) {
        if (!isSolidTile(w.at(x, F))) w.set(x, F, T.DIRT);
        if (!isSolidTile(w.at(x, F + 1))) w.set(x, F + 1, T.DIRT);
        if (!isSolidTile(w.at(x, F + 2))) w.set(x, F + 2, T.DIRT);
      }
      w.set(x, F - 1, T.TUNNEL);
      w.set(x, F - 2, T.TUNNEL);
      if (F - 1 <= w.surface[x]) {
        // The ramp has reached surface level. Open a gallery along the grass so
        // the ant has somewhere to stand and step out, and give it one cell of
        // head room if it is sitting on the grass row rather than the walk row.
        if (F - 1 === w.surface[x]) w.set(x, w.surface[x] - 1, T.TUNNEL);
        this.carveEntrance(x, dir, 9);
        this.entrance = { x: x, y: F - 1 };
        return true;
      }
      var nx = x + dir;
      if (nx < 1 || nx >= w.w - 1) return false;
      if (w.at(nx, F - 1) === T.STONE) return false;
      x = nx;
      F -= 1;
    }
    return false;
  };

  /** can an ant actually walk from the queen's tile to open sky? */
  P.surfaceReachable = function (qx, qy) {
    var w = this.world;
    var f = {
      tx: -999, ty: -999, stamp: -1, used: 0,
      dist: new Uint16Array(w.n), dir: new Int8Array(w.n)
    };
    if (!w.computeField(f, qx, qy)) return false;
    for (var x = 0; x < w.w; x++) {
      var top = w.surface[x];
      for (var y = 0; y <= top; y++) {
        var i = y * w.w + x;
        if (w.tiles[i] === T.TUNNEL && f.dist[i] < 0xFFFF) return true;
      }
    }
    return false;
  };

  /**
  * Open a two-row gallery along the surface, which is where the colony walks
  * above ground. The surface height only ever changes one row at a time, so
  * this gallery is always continuous in both directions.
*/
  P.carveEntrance = function (x, dir, len) {
    var w = this.world;
    for (var i = 0; i <= (len || 8); i++) {
      var c = x + dir * i;
      if (c < 1 || c >= w.w - 1) break;
      w.set(c, w.surface[c] - 1, T.TUNNEL);
      w.set(c, w.surface[c] - 2, T.TUNNEL);
    }
  };

  /**
  * Can the colony actually walk from the queen to open sky?
  * Asked of the live flow field rather than guessed from the tile map, so a
  * dammed or collapsed shaft is detected exactly when it becomes a real problem.
*/
  P.hasSurfaceAccess = function () {
    var w = this.world;
    if (!this.queen) return false;
    var f = w.refreshHome();
    for (var x = 0; x < w.w; x++) {
      var top = w.surface[x] - 1;
      for (var y = 0; y <= top; y++) {
        var i = y * w.w + x;
        if (w.tiles[i] === T.AIR && f.dist[i] < 0xFFFF) return true;
      }
    }
    return false;
  };

  /** queue digs that open (or reopen) a way to the surface */
  P.queueShaft = function (qx, qy, reach) {
    var w = this.world;
    // try the queen's own column first, then work outwards so a dammed
    // shaft does not trap the colony underground forever
    for (var c = 0; c < 9; c++) {
      var off = c === 0 ? 0 : (c % 2 ? Math.ceil(c / 2) : -Math.ceil(c / 2));
      var col = U.clamp(qx + off, 1, w.w - 2);
      var bestY = 1e9, found = false;
      for (var y = qy; y >= 0; y--) {
        if (w.at(col, y) === T.TUNNEL) { bestY = y; found = true; break; }
      }
      if (!found) continue;
      if (reach && !reach(col, bestY)) continue;
      for (var yy = bestY - 1; yy >= Math.max(0, w.surface[col] - 1); yy--) {
        if (World.isDiggable(w.at(col, yy))) {
          this.addJob({ x: col, y: yy, kind: 'dig', p: 1 });
          return;
        }
      }
    }
  };

  P.tunnelCountNear = function (cx, cy, r) {
    var w = this.world, c = 0;
    for (var y = cy - r; y <= cy + r; y++) {
      for (var x = cx - r; x <= cx + r; x++) {
        if (w.inBounds(x, y) && w.at(x, y) === T.TUNNEL) c++;
      }
    }
    return c;
  };

  /**
  * Queue a chamber excavation.
  *
  * The room must sit on exactly the same two rows as a tunnel that already
  * exists, with solid ground beneath it. A room carved at a different height
  * becomes a pit the colony can fall into but never climb back out of, which
  * is how colonies used to deadlock.
*/
  P.queueRoom = function (qx, qy, reach) {
    var w = this.world;
    for (var tries = 0; tries < 60; tries++) {
      var px = randInt(Math.max(2, qx - 13), Math.min(w.w - 3, qx + 13));
      var py = randInt(Math.max(2, qy - 9), Math.min(w.h - 5, qy + 9));
      if (w.at(px, py) !== T.TUNNEL) continue;
      if (w.at(px, py - 1) === T.TUNNEL) continue;        // already headroom here
      if (reach && !reach(px, py)) continue;               // in a pocket nobody can enter

      var rw = randInt(3, 5);
      var side = Math.random() < 0.5 ? -1 : 1;
      var x0 = side > 0 ? px : px - rw + 1;
      x0 = U.clamp(x0, 1, w.w - rw - 2);

      var cells = [];
      for (var x = x0; x < x0 + rw; x++) {
        for (var y = py - 1; y <= py; y++) {
          if (y < w.surface[x]) continue;                 // never carve into the sky
          var t = w.at(x, y);
          if (t === T.STONE || t === T.TUNNEL) continue;
          if (t !== T.DIRT && t !== T.ROOT && t !== T.GRASS) continue;
          cells.push({ x: x, y: y });
        }
        // the ant has to be able to stand on the lower row here
        if (!isSolidTile(w.at(x, py + 1))) { cells = []; break; }
      }
      if (cells.length < 3) continue;
      var job = this.addJob({ x: cells[0].x, y: cells[0].y, kind: 'room', p: 2, cells: cells, total: cells.length });
      if (job) { job.i = 0; return; }
    }
  };

  P.queueDig = function (qx, qy, reach) {
    var w = this.world;
    for (var tries = 0; tries < 70; tries++) {
      var tx = randInt(Math.max(1, qx - 16), Math.min(w.w - 2, qx + 16));
      var ty = randInt(Math.max(1, qy - 6), Math.min(w.h - 3, qy + 18));
      if (w.at(tx, ty) !== T.TUNNEL) continue;
      if (reach && !reach(tx, ty)) continue;
      if (tx === qx && Math.abs(ty - qy) < 3) continue;
      var d = w.dirtAdjacentToTunnel(tx, ty);
      if (!d) continue;
      if (this.protectedTile(d.x, d.y)) continue;
      if (d.y <= w.surface[d.x] - 1) continue;
      if (d.y >= w.h - 3) continue;
      this.addJob({ x: d.x, y: d.y, kind: 'dig', p: 3 });
      return;
    }
  };

  P.queueWall = function (qx, qy, reach) {
    var w = this.world;
    for (var tries = 0; tries < 50; tries++) {
      var tx = randInt(Math.max(1, qx - 7), Math.min(w.w - 2, qx + 7));
      var ty = randInt(qy - 4, qy + 4);
      var t = w.at(tx, ty);
      if (t !== T.TUNNEL) continue;
      // put a twig wall in a chokepoint
      var openN = 0;
      for (var d = 0; d < 4; d++) if (w.at(tx + DX[d], ty + DY[d]) === T.TUNNEL || w.at(tx + DX[d], ty + DY[d]) === T.AIR) openN++;
      if (openN < 3) continue;
      if (reach && !reach(tx, ty)) continue;
      this.addJob({
        x: tx, y: ty, kind: 'build', structure: T.WOOD, mat: 'twig', p: 2
      });
      return;
    }
  };

  /* ============================================================
    queries the AI needs
    ============================================================ */
  P.surfaceY = function (tx) { return this.world.surface[U.clamp(tx, 0, this.world.w - 1)]; };

  /**
  * The shallowest tunnel cell the colony can actually walk to: the way out.
  * Foragers aim at this rather than guessing at a random patch of sky.
*/
  P.findEntrance = function () {
    var w = this.world;
    if (!this.queen) return null;
    var f = w.refreshHome();
    var best = null, bestY = 1e9;
    for (var x = 0; x < w.w; x++) {
      var lim = w.surface[x] + 1;
      for (var y = 1; y < lim; y++) {
        var i = y * w.w + x;
        if (w.tiles[i] !== T.TUNNEL) continue;
        if (f.dist[i] >= 0xFFFF) continue;
        if (w.sand[i] > 4) continue;
        if (y < bestY) { bestY = y; best = { x: x, y: y }; }
      }
    }
    return best;
  };

  /** a verified walkable nest mouth, refreshed if it ever gets blocked */
  P.entranceSpot = function () {
    var w = this.world;
    if (!this.queen) return null;
    if (this.entrance) {
      var i = this.entrance.y * w.w + this.entrance.x;
      if (w.tiles[i] === T.TUNNEL && w.refreshHome().dist[i] < 0xFFFF) return this.entrance;
    }
    this.entrance = this.findEntrance();
    return this.entrance;
  };

  P.surfaceSpotNear = function (ant) {
    var w = this.world;
    if (!this.entrance) this.entrance = this.findEntrance();
    var base = this.entrance ? this.entrance.x : ant.tileX();
    var tx = U.clamp(base + randInt(-4, 4), 1, w.w - 2);
    // a pebble sitting on the grass is a bad place to aim at
    if (w.solidAt(tx, w.surface[tx] - 1)) tx = U.clamp(base, 1, w.w - 2);
    return { x: tx * T8 + T8 / 2, y: (w.surface[tx] - 1) * T8 };
  };

  /** standable tunnel cells near the queen that the colony can reach */
  P.spotsNearQueen = function (rx, ryUp, ryDown) {
    var w = this.world, q = this.queen;
    if (!q) return [];
    var hf = w.refreshHome();
    if (this._spotCache && this._spotCache.stamp === w.mapStamp && this._spotCache.key === rx + ',' + ryUp + ',' + ryDown) {
      return this._spotCache.list;
    }
    var qx = q.tileX(), qy = q.tileY(), list = [];
    for (var ty = qy - ryUp; ty <= qy + ryDown; ty++) {
      for (var tx = qx - rx; tx <= qx + rx; tx++) {
        if (!w.inBounds(tx, ty) || !w.standable(tx, ty)) continue;
        if (ty < w.surface[tx]) continue;
        if (w.sand[ty * w.w + tx] > 2 || w.water[ty * w.w + tx] > 2) continue;
        if (w.distAt(hf, tx, ty) === 0xFFFF) continue;
        list.push({ x: tx, y: ty, d: Math.abs(tx - qx) + Math.abs(ty - qy) });
      }
    }
    list.sort(function (a, b) { return a.d - b.d; });
    this._spotCache = { stamp: w.mapStamp, key: rx + ',' + ryUp + ',' + ryDown, list: list };
    return list;
  };

  P.patrolSpot = function (ant) {
    var list = this.spotsNearQueen(12, 4, 6);
    if (!list.length) return this.queen ? { x: this.queen.tileX(), y: this.queen.tileY() } : { x: ant.tileX(), y: ant.tileY() };
    return list[randInt(Math.min(list.length - 1, 3), list.length - 1)];
  };

  /** somewhere to idle: near the queen but not in her way */
  P.restSpot = function (ant) {
    var list = this.spotsNearQueen(7, 2, 3);
    if (!list.length) return { x: ant.tileX(), y: ant.tileY() };
    return list[randInt(Math.min(list.length - 1, 2), list.length - 1)];
  };

  /**
   * A defensive post for the call to arms: the ring of floor around the
   * queen, nearest first, spread so the colony forms a screen rather than a heap.
   */
  P.guardSpot = function (ant) {
    var list = this.spotsNearQueen(8, 3, 4);
    if (!list.length) return { x: ant.tileX(), y: ant.tileY() };
    var defenders = this.ants.filter(function (a) { return !a.isEnemy && a.role !== 'queen'; });
    var k = Math.max(0, defenders.indexOf(ant));
    // soldiers take the outer posts, workers the inner ones
    var idx = ant.role === 'army' ? list.length - 1 - (k % list.length) : (k % list.length);
    return list[U.clamp(idx, 0, list.length - 1)];
  };

  P.nearestEnemy = function (x, y, r) {
    var best = null, bd = r * r;
    for (var i = 0; i < this.ants.length; i++) {
      var a = this.ants[i];
      if (!a.isEnemy || a.dead) continue;
      var d = U.dist2(x, y, a.x, a.y - a.h / 2);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  };

  /** the closest colony ant (not the queen) to an enemy, within r */
  P.nearestColonyAnt = function (enemy, r) {
    var best = null, bd = r * r;
    var ex = enemy.x, ey = enemy.y - enemy.h / 2;
    for (var i = 0; i < this.ants.length; i++) {
      var a = this.ants[i];
      if (a.dead || a.isEnemy || a.role === 'queen') continue;
      var d = U.dist2(ex, ey, a.x, a.y - a.h / 2);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  };

  /** is anybody standing in this tile? (never build a wall on top of an ant) */
  P.antInTile = function (tx, ty) {
    for (var i = 0; i < this.ants.length; i++) {
      var a = this.ants[i];
      if (a.dead) continue;
      var l = Math.floor((a.x - a.w / 2) / T8), r = Math.floor((a.x + a.w / 2) / T8);
      var t = Math.floor((a.y - a.h) / T8), b = Math.floor((a.y - 0.01) / T8);
      if (tx >= l && tx <= r && ty >= t && ty <= b) return true;
    }
    return false;
  };

  /** the spark, the number and the flash of a landed bite */
  P.hitFx = function (target, dmg, byEnemy) {
    this.puff(target.x, target.y - target.h / 2, byEnemy ? '#ff5c4a' : '#ffd27a', 3);
    this.floatText(target.x + rand(-2, 2), target.y - target.h - 4, '-' + dmg, byEnemy ? '#ff7a62' : '#ffe08a');
    if (byEnemy && target === this.queen) this.pulseRaid = Math.max(this.pulseRaid, 0.35);
  };

  P.floatText = function (x, y, text, color) {
    this.parts.push(new global.FloatText(x, y, text, color));
  };

  /* ---------------- the call to arms ---------------- */
  P.setDefend = function (on) {
    if (!this.queen || this.phase !== 'play') return;
    if (on === this.defending) return;
    this.defending = on;
    this.defendT = 0;
    var i, a;
    if (on) {
      this.ui.banner('TO THE QUEEN!', 'THE COLONY DROPS EVERYTHING TO DEFEND HER', 'warn');
    } else {
      // everyone back to work
      for (i = 0; i < this.ants.length; i++) {
        a = this.ants[i];
        if (a.isEnemy || a.role === 'queen') continue;
        a.state = 'idle'; a.t = 0; a.field = null; a.target = null; a.guard = null; a.restSpot = null;
      }
      this.ui.banner('ALL CLEAR', 'THE COLONY GOES BACK TO WORK', 'good');
    }
  };
  P.toggleDefend = function () { this.setDefend(!this.defending); };

  /** a called defence stands down by itself once the raid is over */
  P.updateDefend = function (dt) {
    if (!this.defending) return;
    this.defendT += dt;
    // count live enemies now: the event system's tally is taken before a raid
    // spawns, so on the very tick raiders arrive it still reads zero
    var foes = 0;
    for (var i = 0; i < this.ants.length; i++) if (this.ants[i].isEnemy && !this.ants[i].dead) foes++;
    var warned = this.events.timers.raid < 14;
    this.quietT = (foes === 0 && !warned) ? (this.quietT || 0) + dt : 0;
    if (this.defendT > CFG.DEFEND_MIN && this.quietT > 3) this.setDefend(false);
  };

  P.puff = function (x, y, color, n) {
    for (var i = 0; i < (n || 3); i++) {
      this.parts.push(new Particle(
        x + rand(-2, 2), y + rand(-2, 2),
        rand(-16, 16), rand(-34, -6),
        rand(0.25, 0.6), color, 120, 1
      ));
    }
  };

  P.onTileChanged = function (x, y) { };

  P.onNewDay = function (day) {
    this.ui.banner('DAY ' + day, day % 5 === 0 ? 'THE COLONY GROWS' : 'THE COLONY ENDURES', 'good');
    this.food += 4;
  };

  /* ============================================================
    update
    ============================================================ */
  P.setSpeed = function (n) { this.speed = U.clamp(n, 1, 3); };

  P.togglePause = function () { this.setPaused(!this.paused); };

  /** pausing opens the pause menu (or one of its pages: 'index', 'help') */
  P.setPaused = function (on, page) {
    if (this.phase === 'title') on = false;
    this.paused = on;
    if (on) this.ui.openPause(page || 'menu');
    else this.ui.closePause();
  };

  P.cycleSpeed = function () { this.setSpeed(this.speed >= 3 ? 1 : this.speed + 1); };

  P.cycleOverlay = function () { this.overlay = (this.overlay + 1) % 4; };

  P.confirmReset = function () {
    if (this.phase === 'title') { this.newWorld(); return; }
    if (window.confirm('Abandon this colony and dig a new one?')) this.newWorld();
  };

  P.step = function (dt) {
    this.time += dt;
    var w = this.world;
    this.pulseRaid = Math.max(0, this.pulseRaid - dt * 1.2);

    if (this.phase === 'play' || this.phase === 'over') {
      w.update(dt);
      this.events.update(dt);
      this.updateJobs(dt);
      this.updateFoodNodes(dt);
      this.updateEggs(dt);
      this.updateDefend(dt);
    }

    var i, a;
    // ants
    for (i = this.ants.length - 1; i >= 0; i--) {
      a = this.ants[i];
      if (this.phase === 'play') AntAI.update(a, this, dt);
      else if (a.dead) { this.ants.splice(i, 1); continue; }
      if (a.dead) {
        if (a.left) {
          // walked off the map: no corpse, no kill
        } else if (a.isEnemy) {
          this.stats.kills = (this.stats.kills || 0) + 1;
          this.puff(a.x, a.y - a.h / 2, '#7a2f26', 8);
          // a thief cut down on the way out drops what it took
          if (a.carry > 0) {
            var loot = new FoodItem(a.x, a.y - 1, 'seed');
            loot.art = { w: 4, h: 4, food: a.carry, mat: null };
            this.foods.push(loot);
          }
        } else {
          this.stats.dead++;
          this.puff(a.x, a.y - a.h / 2, '#8a6134', 8);
          if (a.carry > 0) {
            var dropped = new FoodItem(a.x, a.y - 1, a.carryArt || 'crumb');
            this.foods.push(dropped);
          }
        }
        if (a === this.queen) this.onQueenDead();
        if (a === this.selected) this.selectedDeadAt = this.time;
        this.ants.splice(i, 1);
      }
    }

    // food
    for (i = this.foods.length - 1; i >= 0; i--) {
      var f = this.foods[i];
      f.update(w, dt, this.events.wind);
      if (f.dead) {
        this.foods.splice(i, 1);
      }
    }

    // particles
    for (i = this.parts.length - 1; i >= 0; i--) {
      this.parts[i].update(dt);
      if (this.parts[i].dead) this.parts.splice(i, 1);
    }
    if (this.parts.length > 320) this.parts.splice(0, this.parts.length - 320);

    w.flushDirty();
    this.updateCamera(dt);
  };

  /**
   * Things resting on the floor (eggs, the granary pile) fall when the colony
   * digs that floor away, instead of hanging in mid-air. `o.y` is the bottom.
   */
  P.settle = function (o, dt) {
    var w = this.world;
    var tx = Math.floor(o.x / T8);
    var below = Math.floor((o.y + 0.02) / T8);
    if (w.solidAt(tx, below) || below >= w.h - 1) { o.vy = 0; return; }
    o.vy = Math.min((o.vy || 0) + CFG.G * dt, CFG.MAX_FALL);
    var ny = o.y + o.vy * dt;
    // land on the first solid row we pass
    for (var r = below; r <= Math.floor(ny / T8); r++) {
      if (w.solidAt(tx, r)) { ny = r * T8 - 0.01; o.vy = 0; break; }
    }
    o.y = ny;
  };

  P.updateEggs = function (dt) {
    if (this.queen) this.settle(this.granary, dt);
    var w = this.world;
    for (var i = this.eggs.length - 1; i >= 0; i--) {
      var e = this.eggs[i];
      this.settle(e, dt);
      // eggs that fell onto the same spot shuffle apart along the floor
      for (var o = 0; o < i; o++) {
        var b = this.eggs[o];
        if (Math.abs(b.y - e.y) > 3 || Math.abs(b.x - e.x) >= 5) continue;
        var push = e.x >= b.x ? 1 : -1;
        var nx = e.x + push * 0.5;
        if (!w.solidAt(Math.floor((nx + push * 2.5) / T8), Math.floor((e.y - 1) / T8))) e.x = nx;
        else b.x -= push * 0.5;
      }
      var nurses = 0;
      for (var j = 0; j < this.ants.length; j++) {
        var a = this.ants[j];
        if (a.dead || a.role !== 'nurse') continue;
        if (U.dist2(a.x, a.y, e.x, e.y) <= (T8 * CFG.NURSE_RADIUS) * (T8 * CFG.NURSE_RADIUS)) nurses++;
      }
      e.nurses = nurses;
      if (this.countAnts() >= CFG.MAX_ANTS) continue;
      if (e.update(dt, nurses)) {
        this.hatch(e);
        this.eggs.splice(i, 1);
      }
    }
  };

  P.countAnts = function () {
    var c = 0;
    for (var i = 0; i < this.ants.length; i++) if (!this.ants[i].isEnemy && !this.ants[i].dead) c++;
    return c;
  };

  P.hatch = function (egg) {
    var a = new Ant(egg.x, egg.y - 0.01, egg.role);
    a.id = this.nextId();
    a.vy = -30;
    this.ants.push(a);
    this.stats.born++;
    this.puff(egg.x, egg.y - 3, '#f3ead2', 8);
    this.ui.toast((/^[AEIOU]/.test(a.def.name) ? 'AN ' : 'A ') + a.def.name + ' HAS HATCHED');
  };

  P.onQueenDead = function () {
    this.gameOver = true;
    this.phase = 'over';
    this.followQueen = false;
    this.overAt = this.time;
    this.defending = false;
    this.ui.banner('THE QUEEN IS DEAD', 'THE COLONY IS ORPHANED', 'warn');
    // the autosave predates her death; "continue" must not resurrect her
    this.clearSave();
    this.puff(this.queen.x, this.queen.y - 5, '#e8b24a', 22);
  };

  /* ============================================================
    camera
    ============================================================ */
  P.updateCamera = function (dt) {
    var vw = this.viewW(), vh = this.viewH();
    var maxX = Math.max(0, this.world.w * T8 - vw);
    var maxY = Math.max(0, this.world.h * T8 - vh);

    // keyboard panning
    var kx = 0, ky = 0;
    if (this.keys['a'] || this.keys['arrowleft']) kx -= 1;
    if (this.keys['d'] || this.keys['arrowright']) kx += 1;
    if (this.keys['w'] || this.keys['arrowup']) ky -= 1;
    if (this.keys['s'] || this.keys['arrowdown']) ky += 1;
    if (kx || ky) {
      this.followQueen = false;
      this.camX = U.clamp(this.camX + kx * 220 / this.zoom * dt, 0, maxX);
      this.camY = U.clamp(this.camY + ky * 220 / this.zoom * dt, 0, maxY);
      this.camTargetX = this.camX; this.camTargetY = this.camY;
    }

    if (this.followQueen && this.queen) {
      this.camTargetX = this.queen.x - vw / 2;
      this.camTargetY = this.queen.y - vh / 2;
    }
    var k = U.damp(this.followQueen ? 3.5 : 8, dt);
    this.camX = U.lerp(this.camX, this.camTargetX, k);
    this.camY = U.lerp(this.camY, this.camTargetY, k);
    this.camX = U.clamp(this.camX, 0, maxX);
    this.camY = U.clamp(this.camY, 0, maxY);
  };

  /* ============================================================
    input
    ============================================================ */
  P.bindInput = function () {
    var self = this, cv = this.canvas;

    // Register the drag BEFORE touching coordinates. An exception while
    // resolving the pointer would otherwise leave self.drag null, the mouseup
    // would bail out, and the click would vanish with no visible sign.
    cv.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      self.drag = { sx: 0, sy: 0, cx: self.camX, cy: self.camY, moved: false };
      try {
        var p = self.ui.toLocal(e.clientX, e.clientY);
        self.mouse.x = p.x; self.mouse.y = p.y;
        self.drag.sx = p.x; self.drag.sy = p.y;
      } catch (err) { /* keep the zero-length drag so mouseup still fires */ }
    });
    window.addEventListener('mousemove', function (e) {
      var p;
      try { p = self.ui.toLocal(e.clientX, e.clientY); } catch (err) { return; }
      self.mouse.x = p.x; self.mouse.y = p.y; self.mouse.over = true;
      if (self.drag) {
        var dx = p.x - self.drag.sx, dy = p.y - self.drag.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          self.drag.moved = true;
          self.followQueen = false;
          self.camX = self.drag.cx - dx / self.zoom;
          self.camY = self.drag.cy - dy / self.zoom;
          self.camTargetX = self.camX; self.camTargetY = self.camY;
          cv.classList.add('pan');
        }
      }
    });
    window.addEventListener('mouseup', function (e) {
      if (!self.drag) return;
      var moved = self.drag.moved;
      self.drag = null;
      cv.classList.remove('pan');
      if (moved) return;
      try {
        self.onClick(self.mouse.x, self.mouse.y);
      } catch (err) {
        // surface the failure instead of letting a click disappear
        if (global.console && global.console.error) global.console.error(err);
        self.ui.toast('CLICK ERROR: ' + (err && err.message ? err.message : err));
      }
    });
    cv.addEventListener('mouseleave', function () { self.mouse.over = false; });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = null;
      try { p = self.ui.toLocal(e.clientX, e.clientY); } catch (err) { p = null; }
      self.zoomStep(e.deltaY < 0 ? 1 : -1, p);
    }, { passive: false });

    // touch
    cv.addEventListener('touchstart', function (e) {
      self.drag = { sx: 0, sy: 0, cx: self.camX, cy: self.camY, moved: false };
      try {
        var p = self.ui.toLocal(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
        self.mouse.x = p.x; self.mouse.y = p.y;
        self.drag.sx = p.x; self.drag.sy = p.y;
      } catch (err) { /* as above: keep the drag alive */ }
      self.mouse.over = true;
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchmove', function (e) {
      var p;
      try { p = self.ui.toLocal(e.changedTouches[0].clientX, e.changedTouches[0].clientY); } catch (err) { return; }
      self.mouse.x = p.x; self.mouse.y = p.y;
      if (self.drag) {
        var dx = p.x - self.drag.sx, dy = p.y - self.drag.sy;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          self.drag.moved = true;
          self.followQueen = false;
          self.camX = self.drag.cx - dx / self.zoom;
          self.camY = self.drag.cy - dy / self.zoom;
          self.camTargetX = self.camX; self.camTargetY = self.camY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchend', function () {
      if (self.drag && !self.drag.moved) {
        try {
          self.onClick(self.mouse.x, self.mouse.y);
        } catch (err) {
          if (global.console && global.console.error) global.console.error(err);
          self.ui.toast('CLICK ERROR: ' + (err && err.message ? err.message : err));
        }
      }
      self.drag = null;
    });

    window.addEventListener('keydown', function (e) {
      var k = e.key.toLowerCase();
      self.keys[k] = true;
      if (k === 'w' || k === 'a' || k === 's' || k === 'd' ||
        k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { self.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', function () { self.keys = {}; });
  };

  /**
   * Set the zoom to one of CFG.ZOOMS. `anchor` is a screen point (internal
   * pixels) that stays put -- the cursor for the wheel, else the view centre.
   */
  P.setZoom = function (z, anchor) {
    var Z = CFG.ZOOMS, best = Z[0];
    for (var i = 0; i < Z.length; i++) if (Math.abs(Z[i] - z) < Math.abs(best - z)) best = Z[i];
    z = best;
    if (z === this.zoom) return;
    var ax = anchor ? anchor.x : CFG.VIEW_W / 2, ay = anchor ? anchor.y : CFG.VIEW_H / 2;
    var wx = this.camX + ax / this.zoom, wy = this.camY + ay / this.zoom;
    var twx = this.camTargetX + ax / this.zoom, twy = this.camTargetY + ay / this.zoom;
    this.zoom = z;
    this.camX = wx - ax / z; this.camY = wy - ay / z;
    this.camTargetX = twx - ax / z; this.camTargetY = twy - ay / z;
    this.updateCamera(0.001);
  };

  /** one notch in (dir 1) or out (dir -1) */
  P.zoomStep = function (dir, anchor) {
    var Z = CFG.ZOOMS, i = Z.indexOf(this.zoom);
    if (i < 0) i = 1;
    i = U.clamp(i + dir, 0, Z.length - 1);
    this.setZoom(Z[i], anchor);
  };

  P.onClick = function (mx, my) {
    if (this.phase === 'place') {
      var wx = this.camX + mx / this.zoom, wy = this.camY + my / this.zoom;
      if (this.canPlace(wx, wy)) this.placeQueen(wx, wy);
      else this.ui.toast('THE QUEEN NEEDS DEEP, OPEN DIRT');
      return;
    }
    // select an ant
    var wx = this.camX + mx / this.zoom, wy = this.camY + my / this.zoom;
    var best = this.antAt(wx, wy);
    this.selected = best || null;
    if (best) {
      this.followQueen = false;
      this.camTargetX = best.x - this.viewW() / 2;
      this.camTargetY = best.y - this.viewH() / 2;
      return;
    }
    this.orderAt(wx, wy);
  };

  /** the ant under a world point, with a pick radius that suits the zoom */
  P.antAt = function (wx, wy) {
    var r = 5 + 7 / this.zoom, best = null, bd = r * r;
    for (var i = 0; i < this.ants.length; i++) {
      var a = this.ants[i];
      if (a.dead) continue;
      var d = U.dist2(wx, wy, a.x, a.y - a.h / 2);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  };

  /**
   * What is under the cursor, for the tooltip: an ant, egg, food item, the
   * granary, a bush, or failing those the tile itself. mx/my are internal
   * screen pixels.
   */
  P.hoverAt = function (mx, my) {
    if (this.phase === 'title') return null;
    var w = this.world, i;
    var wx = this.camX + mx / this.zoom, wy = this.camY + my / this.zoom;
    var tx = Math.floor(wx / T8), ty = Math.floor(wy / T8);
    if (!w.inBounds(tx, ty)) return null;

    if (this.phase === 'place') {
      return { type: 'place', ok: this.canPlace(wx, wy), tile: w.at(tx, ty), tx: tx, ty: ty };
    }
    var ant = this.antAt(wx, wy);
    if (ant) return { type: 'ant', ant: ant };
    for (i = 0; i < this.eggs.length; i++) {
      var e = this.eggs[i];
      if (Math.abs(wx - e.x) <= 4 && wy <= e.y + 1 && wy >= e.y - 9) return { type: 'egg', egg: e };
    }
    for (i = 0; i < this.foods.length; i++) {
      var f = this.foods[i];
      if (f.dead) continue;
      if (Math.abs(wx - f.x) <= f.w / 2 + 2 && wy <= f.y + 2 && wy >= f.y - f.h - 2) return { type: 'food', food: f };
    }
    if (this.queen && Math.abs(wx - this.granary.x) <= 7 && wy <= this.granary.y + 2 && wy >= this.granary.y - 10) {
      return { type: 'granary' };
    }
    for (i = 0; i < this.foodNodes.length; i++) {
      var n = this.foodNodes[i];
      if (wx >= n.tx * T8 - 1 && wx <= n.tx * T8 + T8 + 1 && wy <= n.ty * T8 && wy >= n.ty * T8 - 9) return { type: 'node', node: n };
    }
    var k = ty * w.w + tx;
    return {
      type: 'tile', tile: w.at(tx, ty), tx: tx, ty: ty,
      sky: !w.solidAt(tx, ty) && ty < w.surface[tx],
      water: w.water[k], sand: w.sand[k], shp: w.shp[k]
    };
  };

  /** the player's one direct order: point at a problem and the colony fixes it */
  P.orderAt = function (wx, wy) {
    var w = this.world;
    var tx = Math.floor(wx / T8), ty = Math.floor(wy / T8);
    if (!w.inBounds(tx, ty)) return;

    // a cracked wall? send someone to shore it up
    if (World.isStructure(w.at(tx, ty)) && w.shp[ty * w.w + tx] < CFG.STRUCT_HP) {
      if (this.addJob({ x: tx, y: ty, kind: 'repair', p: 0 })) {
        this.ui.toast('REPAIR ORDERED');
        return;
      }
    }
    // a hole letting the rain in? dam it
    if (w.at(tx, ty) === T.TUNNEL) {
      var wet = 0;
      for (var d = 0; d < 4; d++) wet = Math.max(wet, w.water[(ty + DY[d]) * w.w + (tx + DX[d])] || 0);
      if (wet >= 2) {
        if (this.addJob({ x: tx, y: ty, kind: 'build', structure: T.THATCH, mat: 'leaf', p: 0 })) {
          this.ui.toast('DAM ORDERED');
          return;
        }
      }
    }
    // otherwise treat it as a request to dig here
    if (World.isDiggable(w.at(tx, ty))) {
      if (this.addJob({ x: tx, y: ty, kind: 'dig', p: 0 })) this.ui.toast('DIG SITE MARKED');
    }
  };

  /* ============================================================
    render
    ============================================================ */
  P.render = function () {
    var ctx = this.ctx, w = this.world, z = this.zoom;
    var W = this.canvas.width, H = this.canvas.height;
    var camX = Math.round(this.camX), camY = Math.round(this.camY);
    var t = this.time;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.scale(z, z);

    // --- terrain ---
    ctx.drawImage(w.bg, -camX, -camY);

    // --- overlays on the terrain ---
    if (this.overlay === 1) this.drawJobOverlay(ctx, camX, camY);
    ctx.restore();

    ctx.save();
    ctx.scale(z, z);

    this.drawFluids(ctx, camX, camY, t, false);

    // --- food nodes ---
    this.drawFoodNodes(ctx, camX, camY, t);

    // --- granary mound, under the ants that stand on it ---
    this.drawGranary(ctx, camX, camY, t);

    // --- food ---
    // Food, eggs and particles draw themselves in world pixels, so shift the
    // context by the camera for them.
    var i;
    ctx.save();
    ctx.translate(-camX, -camY);
    for (i = 0; i < this.foods.length; i++) this.foods[i].draw(ctx, t);
    ctx.restore();
    for (i = 0; i < this.foods.length; i++) {
      var f = this.foods[i];
      if (f.claimed) {
        var a = 0.25 + 0.25 * Math.sin(t * 6 + f.spin);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#ffe9a8';
        ctx.fillRect(Math.round(f.x - camX) - 1, Math.round(f.y - camY) - f.h - 2, 1, 1);
        ctx.fillRect(Math.round(f.x - camX) + f.w, Math.round(f.y - camY) - f.h - 2, 1, 1);
        ctx.globalAlpha = 1;
      }
    }

    // --- eggs ---
    ctx.save();
    ctx.translate(-camX, -camY);
    for (i = 0; i < this.eggs.length; i++) this.eggs[i].draw(ctx, t);
    ctx.restore();

    // --- ants in view, y-sorted so overlaps read correctly ---
    var vw = this.viewW(), vh = this.viewH();
    var list = this.ants.filter(function (a) {
      return a.x > camX - 24 && a.x < camX + vw + 24 && a.y > camY - 24 && a.y < camY + vh + 32;
    }).sort(function (a, b) {
      // the queen last, so the brood crowding round her never hides her
      if (a.role === 'queen' || b.role === 'queen') return a.role === 'queen' ? 1 : -1;
      return a.y - b.y;
    });
    for (i = 0; i < list.length; i++) list[i].draw(ctx, t, camX, camY);
    for (i = 0; i < list.length; i++) list[i].drawOverlay(ctx, t, camX, camY);
    if (this.selected && !this.selected.dead) this.drawSelection(ctx, this.selected, camX, camY, t);

    // --- granary count ---
    this.drawGranaryLabel(ctx, camX, camY);

    // --- queen marker ---
    if (this.queen && !this.queen.dead) this.drawQueenTag(ctx, camX, camY, t);

    // --- particles ---
    ctx.save();
    ctx.translate(-camX, -camY);
    for (i = 0; i < this.parts.length; i++) this.parts[i].draw(ctx);
    ctx.restore();

    // --- water again, faintly, so wading ants look submerged ---
    this.drawFluids(ctx, camX, camY, t, true);

    // --- weather ---
    this.events.drawDrops(ctx, camX, camY);

    ctx.restore();

    // --- lighting ---
    this.drawLighting(camX, camY, t);

    // --- screen-space UI ---
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawScreenUI(ctx, W, H, t);
  };

  /** corner brackets around the ant the inspector is showing */
  P.drawSelection = function (ctx, a, camX, camY, t) {
    var x0 = Math.round(a.x - camX) - 7, x1 = Math.round(a.x - camX) + 6;
    var y1 = Math.round(a.y - camY) + 1, y0 = y1 - Math.max(12, a.h + 7);
    ctx.globalAlpha = 0.65 + 0.35 * Math.sin(t * 6);
    ctx.fillStyle = a.isEnemy ? '#ff6a55' : '#ffe08a';
    ctx.fillRect(x0, y0, 3, 1); ctx.fillRect(x0, y0, 1, 3);
    ctx.fillRect(x1 - 2, y0, 3, 1); ctx.fillRect(x1, y0, 1, 3);
    ctx.fillRect(x0, y1, 3, 1); ctx.fillRect(x0, y1 - 2, 1, 3);
    ctx.fillRect(x1 - 2, y1, 3, 1); ctx.fillRect(x1, y1 - 2, 1, 3);
    ctx.globalAlpha = 1;
  };

  P.drawFluids = function (ctx, camX, camY, t, overlayPass) {
    var w = this.world, T8s = T8;
    if (w.waterCount <= 0 && w.sandCount <= 0) return;
    // only the tiles in view: the map is far too big to sweep every frame
    var x0 = Math.max(0, Math.floor(camX / T8s) - 1), x1 = Math.min(w.w - 1, Math.ceil((camX + this.viewW()) / T8s) + 1);
    var y0 = Math.max(0, Math.floor(camY / T8s) - 1), y1 = Math.min(w.h - 1, Math.ceil((camY + this.viewH()) / T8s) + 1);
    for (var y = y0; y <= y1; y++) {
      var py = y * T8s - camY;
      var row = y * w.w;
      for (var x = x0; x <= x1; x++) {
        var px = x * T8s - camX;
        var i = row + x;

        var s = w.sand[i];
        if (s > 0 && !overlayPass) {
          var sf = s / CFG.SAND_MAX;
          ctx.globalAlpha = 0.45 + 0.45 * sf;
          ctx.fillStyle = sf > 0.55 ? '#d8c084' : '#bda468';
          ctx.fillRect(px, py, T8s, T8s);
          if (s >= CFG.SAND_MAX) {
            ctx.fillStyle = '#ead9a4';
            ctx.fillRect(px, py, T8s, 1);
          }
          ctx.globalAlpha = 1;
        }

        var v = w.water[i];
        if (v > 0) {
          var f = v / CFG.WATER_MAX;
          if (overlayPass) {
            // a thin film over the ants; anything thicker is already opaque below
            if (f > 0.4) {
              ctx.globalAlpha = 0.14 * f;
              ctx.fillStyle = '#63b4e8';
              ctx.fillRect(px, py, T8s, T8s);
              ctx.globalAlpha = 1;
            }
          } else {
            // Keep it translucent: a one-tile shaft lined edge to edge with
            // opaque blue reads as a pipe, not as water finding its level.
            ctx.globalAlpha = 0.16 + 0.5 * f;
            ctx.fillStyle = f > 0.6 ? '#4fa3e0' : '#2f6fa8';
            ctx.fillRect(px, py, T8s, T8s);
            // darker at the low edge so a shallow film still reads as liquid
            ctx.globalAlpha = 0.1 + 0.25 * f;
            ctx.fillStyle = '#1d4f7d';
            ctx.fillRect(px, py + T8s - 2, T8s, 2);
            // shimmer
            var ph = ((x * 7 + y * 13) % 17) / 17;
            var a = 0.2 + 0.22 * Math.sin(t * 3 + ph * 6.28);
            ctx.globalAlpha = a;
            ctx.fillStyle = '#bfe4ff';
            ctx.fillRect(px, py + ((t * 4 + ph * 8) | 0) % T8s, 1, 1);
            ctx.globalAlpha = 1;
            // bright surface line
            if (y === 0 || w.water[i - w.w] < 1) {
              ctx.globalAlpha = 0.6;
              ctx.fillStyle = '#bfe4ff';
              ctx.fillRect(px, py, T8s, 1);
              ctx.globalAlpha = 1;
            }
          }
        }
      }
    }
  };

  P.drawFoodNodes = function (ctx, camX, camY, t) {
    var vw = this.viewW();
    for (var i = 0; i < this.foodNodes.length; i++) {
      var n = this.foodNodes[i];
      var x = Math.round(n.tx * T8 - camX);
      if (x < -16 || x > vw + 16) continue;
      var y = Math.round(n.ty * T8 - camY);
      var ready = n.t < 4 ? 0.4 + 0.3 * Math.sin(t * 5 + n.seed) : 0;
      Game.drawFoodNode(ctx, n.kind, x, y, ready);
    }
  };

  /** a surface food patch with its base at (x, y); also used by the index */
  Game.drawFoodNode = function (ctx, kind, x, y, ready) {
    switch (kind) {
      case 'bush':
        PX.rect(ctx, x + 1, y - 6, 6, 6, '#2f6b23');
        PX.rect(ctx, x + 2, y - 7, 4, 6, '#4f9a35');
        PX.rect(ctx, x + 2, y - 7, 2, 1, '#79cf4a');
        PX.rect(ctx, x + 3, y - 4, 1, 1, '#c8385a');
        PX.rect(ctx, x + 5, y - 5, 1, 1, '#c8385a');
        break;
      case 'stones':
        PX.rect(ctx, x + 1, y - 3, 3, 3, '#6d6459');
        PX.rect(ctx, x + 4, y - 4, 4, 4, '#7a7166');
        PX.rect(ctx, x + 2, y - 3, 1, 1, '#9a9084');
        PX.rect(ctx, x + 5, y - 4, 2, 1, '#9a9084');
        break;
      case 'log':
        PX.rect(ctx, x, y - 4, 8, 3, '#6b4a26');
        PX.rect(ctx, x, y - 4, 8, 1, '#8a6134');
        PX.rect(ctx, x + 1, y - 2, 1, 1, '#54381d');
        PX.rect(ctx, x + 7, y - 4, 1, 3, '#a8794a');
        break;
      default:
        PX.rect(ctx, x + 2, y - 2, 4, 2, '#b08a4c');
        PX.rect(ctx, x + 2, y - 2, 3, 1, '#d4b478');
        PX.rect(ctx, x + 1, y - 1, 1, 1, '#8a6a34');
    }
    if (ready > 0) {
      ctx.globalAlpha = ready;
      PX.rect(ctx, x + 3, y - 10, 1, 1, '#ffe9a8');
      ctx.globalAlpha = 1;
    }
  };

  P.drawGranary = function (ctx, camX, camY, t) {
    if (!this.queen) return;
    var x = Math.round(this.granary.x - camX);
    var y = Math.round(this.granary.y - camY);
    var n = U.clamp(this.food, 0, 40);
    if (n < 1) {
      PX.rect(ctx, x - 2, y - 1, 4, 1, '#3a2a1c');
      return;
    }
    var w = Math.round(2 + n * 0.22), h = Math.round(1 + n * 0.11);
    // whole pixels only: a half-pixel rect smears across two columns
    var l = x - Math.floor(w / 2);
    PX.rect(ctx, l - 1, y - h - 1, w + 2, h + 1, '#3a2a1c');
    PX.rect(ctx, l, y - h, w, h, '#a8813f');
    PX.rect(ctx, l, y - h, w, 1, '#d4ab63');
    PX.rect(ctx, l, y - 1, w, 1, '#6b5227');
    if (n > 20) {
      ctx.globalAlpha = 0.3 + 0.2 * Math.sin(t * 3);
      PX.rect(ctx, x - 1, y - h - 3, 2, 2, '#ffe9a8');
      ctx.globalAlpha = 1;
    }
  };

  /** the stock figure floats over the mound, above any ant standing on it */
  P.drawGranaryLabel = function (ctx, camX, camY) {
    if (!this.queen || this.food < 1) return;
    var x = Math.round(this.granary.x - camX);
    var y = Math.round(this.granary.y - camY);
    var h = Math.round(1 + U.clamp(this.food, 0, 40) * 0.11);
    PX.text(ctx, '' + Math.floor(this.food), x, y - h - 9, '#e8b24a', { align: 'center', scale: 1, shadow: '#1a1208' });
  };

  P.drawQueenTag = function (ctx, camX, camY, t) {
    var q = this.queen;
    var x = Math.round(q.x - camX);
    var y = Math.round(q.y - q.h - 8 - camY);
    var pulse = 0.5 + 0.5 * Math.sin(t * 2);
    ctx.globalAlpha = 0.35 + 0.25 * pulse;
    PX.rect(ctx, x - 5, y - 5, 10, 1, '#e8b24a');
    ctx.globalAlpha = 1;
    PX.text(ctx, 'Q', x, y - 4, '#e8b24a', { align: 'center', shadow: '#1a1208' });
    PX.hpBar(ctx, x - 7, y + 5, 14, q.hp / q.maxHp, q.hp > q.maxHp * 0.35 ? '#7cc04a' : '#e0604a');
  };

  P.drawJobOverlay = function (ctx, camX, camY) {
    var t = this.time;
    for (var i = 0; i < this.jobs.length; i++) {
      var j = this.jobs[i];
      var x = Math.round(j.x * T8 - camX + T8 / 2);
      var y = Math.round(j.y * T8 - camY + T8 / 2);
      var col = j.kind === 'build' ? '#a8912f' : j.kind === 'repair' ? '#5fb0d8'
        : j.kind === 'clear' ? '#d8c084' : '#ffffff';
      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 5 + i);
      ctx.fillStyle = col;
      ctx.fillRect(x - 3, y - 3, 6, 1); ctx.fillRect(x - 3, y + 2, 6, 1);
      ctx.fillRect(x - 3, y - 3, 1, 6); ctx.fillRect(x + 2, y - 3, 1, 6);
      ctx.globalAlpha = 1;
    }
  };

  P.drawLighting = function (camX, camY, t) {
    var g = this.lightCtx, z = this.zoom;
    var night = this.events.isNight();
    // How deep is the middle of the view? camY is world pixels, so the centre
    // row has to be divided down to a tile row -- doing that arithmetic in
    // pixels pinned the ambient to its darkest value the moment the camera
    // dropped below the grass.
    var rowCentre = (camY + this.viewH() * 0.5) / CFG.TILE;
    var depth = U.clamp((rowCentre - 7) / 24, 0, 1);

    // Ambient exposure. Too low and the burrow is a black smear; too high and
    // depth stops reading. These targets put open dirt around 60/255 luminance
    // with tunnels at roughly half that.
    var amb = night ? PX.mix('#aab3d2', '#7c84a0', depth)
                    : PX.mix('#efe9d8', '#a2988a', depth);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = amb;
    g.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);

    g.globalCompositeOperation = 'lighter';
    var i, a, x, y, r;

    // queen's lamp
    if (this.queen) {
      // the light map is in screen pixels: world offsets scale UP with zoom
      x = (this.queen.x - camX) * z; y = (this.queen.y - camY) * z;
      r = 62 * z;
      var gr = g.createRadialGradient(x, y, 2, x, y, r);
      gr.addColorStop(0, 'rgba(255,215,140,0.85)');
      gr.addColorStop(0.5, 'rgba(255,190,110,0.28)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
    }
    // lantern ants
    for (i = 0; i < this.ants.length; i++) {
      a = this.ants[i];
      if (a.dead) continue;
      if (a.role === 'builder' || a.role === 'army' || a.role === 'raider' || a.role === 'brute') {
        x = (a.x - camX) * z; y = (a.y - a.h - camY) * z;
        r = 26 * z;
        if (x < -r || y < -r || x > CFG.VIEW_W + r || y > CFG.VIEW_H + r) continue;
        var gg = g.createRadialGradient(x, y, 1, x, y, r);
        gg.addColorStop(0, a.role === 'builder' ? 'rgba(140,215,255,0.5)' : 'rgba(255,130,110,0.4)');
        gg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gg; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
      }
    }
    // eggs
    for (i = 0; i < this.eggs.length; i++) {
      x = (this.eggs[i].x - camX) * z; y = (this.eggs[i].y - camY) * z;
      r = 16 * z;
      if (x < -r || y < -r || x > CFG.VIEW_W + r || y > CFG.VIEW_H + r) continue;
      var ge = g.createRadialGradient(x, y, 1, x, y, r);
      ge.addColorStop(0, 'rgba(255,240,200,0.4)');
      ge.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = ge; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
    }
    // fireflies at night
    if (night) {
      for (i = 0; i < 14; i++) {
        var sx = (i * 137.5) % CFG.VIEW_W + Math.sin(t * 0.7 + i) * 20;
        var sy = 30 + ((i * 91) % (CFG.VIEW_H - 40)) + Math.cos(t * 0.9 + i * 2) * 14;
        var fa = 0.25 + 0.25 * Math.sin(t * 3 + i);
        g.fillStyle = 'rgba(200,255,150,' + fa + ')';
        g.fillRect(sx | 0, sy | 0, 1, 1);
      }
    }
    g.globalCompositeOperation = 'source-over';

    // composite
    var ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.lightCv, 0, 0, this.canvas.width, this.canvas.height);
    ctx.globalCompositeOperation = 'source-over';

    // raid flash
    if (this.pulseRaid > 0.01) {
      ctx.globalAlpha = this.pulseRaid * 0.18;
      ctx.fillStyle = '#ff3a2a';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.globalAlpha = 1;
    }
  };

  P.drawScreenUI = function (ctx, W, H, t) {
    var self = this;

    // Placement ghost.
    // This runs after the zoom transform has been reset, so everything here is
    // in plain screen pixels. `this.mouse` is already in screen pixels, so the
    // highlight must be centred on the cursor -- drawing it at the WORLD
    // position (wx/wy) would leave it stuck off in the corner.
    if (this.phase === 'place') {
      var wx = this.camX + this.mouse.x / this.zoom;
      var wy = this.camY + this.mouse.y / this.zoom;
      var ok = this.canPlace(wx, wy);
      var tw8 = this.zoom * T8;
      var px = Math.round(this.mouse.x - tw8 / 2);
      var py = Math.round(this.mouse.y - tw8 / 2);
      // soft pad marking the tile itself
      ctx.fillStyle = ok ? 'rgba(232,178,74,.20)' : 'rgba(216,72,58,.20)';
      ctx.fillRect(px, py, tw8, tw8);
      // the ghost queen
      if (ok) {
        var spr = PX.antSprite('queen', 0, 1);
        ctx.drawImage(spr,
          Math.round(this.mouse.x - spr.width * this.zoom / 2),
          Math.round(this.mouse.y - spr.height * this.zoom / 2),
          spr.width * this.zoom, spr.height * this.zoom);
      }
      // corner brackets around the ghost, drawn last so the sprite cannot hide
      // them -- this is the one thing the player has to be able to read
      var gw = (ok ? PX.antSprite('queen', 0, 1).width : 8) * this.zoom + 4;
      var gh = (ok ? PX.antSprite('queen', 0, 1).height : 8) * this.zoom + 4;
      var gx = Math.round(this.mouse.x - gw / 2);
      var gy = Math.round(this.mouse.y - gh / 2);
      var arm = Math.max(2, Math.round(Math.min(gw, gh) * 0.3));
      ctx.fillStyle = ok ? '#ffd873' : '#ff6a55';
      ctx.fillRect(gx, gy, gw, 1); ctx.fillRect(gx, gy + gh - 1, gw, 1);
      ctx.fillRect(gx, gy, 1, arm); ctx.fillRect(gx, gy + gh - arm, 1, arm);
      ctx.fillRect(gx + gw - 1, gy, 1, arm); ctx.fillRect(gx + gw - 1, gy + gh - arm, 1, arm);
    }

    // overlays 2 and 3
    this.drawInfoOverlays(ctx, W, H, t);

  };

  P.drawInfoOverlays = function (ctx, W, H, t) {
    // these draw in screen pixels, so world offsets are scaled by the zoom
    var z = this.zoom, cx0 = this.camX, cy0 = this.camY;
    var sx = function (wx) { return Math.round((wx - cx0) * z); };
    var sy = function (wy) { return Math.round((wy - cy0) * z); };
    if (this.overlay === 2) {
      // threats
      for (var i = 0; i < this.ants.length; i++) {
        var a = this.ants[i];
        if (a.dead || !a.isEnemy) continue;
        var x = sx(a.x), y = sy(a.y - a.h) - 5;
        ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 6);
        ctx.fillStyle = '#ff5c4a';
        ctx.fillRect(x - 2, y - 1, 5, 1); ctx.fillRect(x - 2, y + 1, 5, 1);
        ctx.fillRect(x, y - 2, 1, 5);
        ctx.globalAlpha = 1;
      }
    } else if (this.overlay === 3) {
      // economy: food, eggs, queen reach
      var q = this.queen;
      if (q) {
        var qx = sx(q.x), qy = sy(q.y);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#e8b24a';
        ctx.beginPath(); ctx.arc(qx, qy, T8 * 6 * z, 0, 6.2832); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (i = 0; i < this.foods.length; i++) {
        var f = this.foods[i];
        if (f.dead) continue;
        var fx = sx(f.x), fy = sy(f.y);
        PX.text(ctx, '+' + f.art.food, fx, fy - 9, '#e8b24a', { align: 'center', shadow: '#1a1208' });
      }
      // Eggs lie a tile apart, so their captions would print over each other.
      // Lift each one until it clears the captions already placed.
      var placed = [];
      for (i = 0; i < this.eggs.length; i++) {
        var e = this.eggs[i];
        var ex = sx(e.x), ey = sy(e.y);
        var label = e.role.toUpperCase().charAt(0) + Math.round(e.progress * 100) + '%';
        var lw = PX.textWidth(label, 1, 0) + 2;
        var lift = 0;
        for (var tries = 0; tries < 12; tries++) {
          var top = ey - 26 - lift, clash = false;
          for (var p = 0; p < placed.length; p++) {
            var b = placed[p];
            if (ex - lw / 2 < b.r && ex + lw / 2 > b.l && top < b.b && top + 13 > b.t) { clash = true; break; }
          }
          if (!clash) break;
          lift += 13;
        }
        placed.push({ l: ex - lw / 2, r: ex + lw / 2, t: ey - 26 - lift, b: ey - 13 - lift });
        ctx.fillStyle = '#100c08';
        ctx.fillRect(ex - 6, ey - 16 - lift, 12, 3);
        ctx.fillStyle = '#8fd85f';
        ctx.fillRect(ex - 6, ey - 16 - lift, Math.round(11 * e.progress), 3);
        PX.text(ctx, label, ex, ey - 25 - lift, '#dfe8c8', { align: 'center', shadow: '#0a0806' });
      }
    }
  };

  /* ============================================================
    messaging shortcuts (events.js talks to the game, not the UI)
    ============================================================ */
  P.toast = function (msg) { this.ui.toast(msg); };
  P.banner = function (title, sub, kind) { this.ui.banner(title, sub, kind); };

  /* ============================================================
    persistence
    ============================================================ */
  P.save = function () {
    try {
      var data = {
        v: 2,
        w: this.world.w, h: this.world.h,
        seed: this.seed,
        time: this.time,
        day: this.events.day,
        dayT: this.events.dayT,
        food: this.food,
        mat: this.mat,
        tiles: bytesToB64(this.world.tiles),
        shp: bytesToB64(this.world.shp),
        sand: bytesToB64(this.world.sand),
        queen: this.queen ? { x: this.queen.x, y: this.queen.y, hp: this.queen.hp } : null,
        granary: this.granary,
        ants: this.ants.filter(function (a) { return !a.isEnemy; })
          .map(function (a) { return { r: a.role, x: a.x, y: a.y, hp: a.hp, c: a.carry, ck: a.carryKind }; }),
        eggs: this.eggs.map(function (e) { return { x: e.x, y: e.y, r: e.role, p: e.progress }; }),
        nodes: this.foodNodes.map(function (n) { return { x: n.tx, y: n.ty, t: n.t, k: n.kind, s: n.seed }; }),
        stats: this.stats,
        idSeq: this.idSeq
      };
      localStorage.setItem('antfarm.save', JSON.stringify(data));
      this.ui.toast('COLONY SAVED');
    } catch (e) {
      this.ui.toast('COULD NOT SAVE');
    }
  };

  P.clearSave = function () {
    try { localStorage.removeItem('antfarm.save'); } catch (e) { /* storage unavailable */ }
  };

  P.hasSave = function () {
    // only a save this version can restore counts (older ones used a smaller map)
    try {
      var raw = localStorage.getItem('antfarm.save');
      if (!raw) return false;
      var d = JSON.parse(raw);
      return d.w === CFG.W && d.h === CFG.H;
    } catch (e) { return false; }
  };

  P.load = function () {
    var raw;
    try { raw = localStorage.getItem('antfarm.save'); } catch (e) { return false; }
    if (!raw) return false;
    try {
      var d = JSON.parse(raw);
      // a colony from a different map size cannot be restored onto this one
      if (d.w !== CFG.W || d.h !== CFG.H) { this.clearSave(); return false; }
      this.setupWorld(d.seed);
      var t = b64ToBytes(d.tiles);
      if (t.length !== this.world.tiles.length) { this.clearSave(); return false; }
      this.world.tiles.set(t);
      this.world.shp.set(b64ToBytes(d.shp));
      this.world.sand.set(b64ToBytes(d.sand));
      this.world.mapStamp++;
      this.world.solidStamp++;
      this.world.recountFluids();
      this.world.rebuildBg();
      this.world.markAllDirty();
      this.time = d.time || 0;
      this.events.day = d.day || 1;
      this.events.dayT = d.dayT || 0;
      this.food = d.food || 0;
      this.mat = d.mat || { twig: 0, leaf: 0, dirt: 0 };
      this.idSeq = d.idSeq || 1;
      this.stats = d.stats || this.stats;
      this.granary = d.granary || { x: 0, y: 0 };
      if (d.queen) {
        var q = new Ant(d.queen.x, d.queen.y, 'queen');
        q.id = this.nextId();
        q.hp = d.queen.hp;
        this.queen = q;
        this.ants.push(q);
        this.world.setHome(q.tileX(), q.tileY());
      }
      (d.ants || []).forEach(function (o) {
        if (!CFG.ROLE[o.r]) return;
        var a = new Ant(o.x, o.y, o.r);
        a.id = this.nextId();
        a.hp = o.hp;
        a.carry = o.c || 0;
        a.carryKind = o.ck || null;
        this.ants.push(a);
      }, this);
      (d.eggs || []).forEach(function (o) {
        var e = new Egg(o.x, o.y, o.r);
        e.progress = o.p || 0;
        this.eggs.push(e);
      }, this);
      this.foodNodes = (d.nodes || []).map(function (o) {
        return { tx: o.x, ty: o.y, t: o.t, kind: o.k, seed: o.s };
      });
      this.phase = this.queen ? 'play' : 'title';
      this.ui.hideTitle();
      this.canvas.classList.remove('place');
      this.followQueen = true;
      this.snapCamToQueen();
      this.ui.banner('COLONY RESTORED', 'DAY ' + this.events.day, 'good');
      return true;
    } catch (e) {
      return false;
    }
  };

  function bytesToB64(u8) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return btoa(s);
  }
  function b64ToBytes(str) {
    var s = atob(str), u8 = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  global.Game = Game;
})(window);
