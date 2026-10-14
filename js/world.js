/* ============================================================
  world.js  tile grid, terrain generation, pathing, fluid physics
  ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG, U = global.U, PX = global.PX;

  /* ---------------- tile ids ---------------- */
  var T = {
    AIR: 0,
    DIRT: 1,
    GRASS: 2,
    TUNNEL: 3,      // excavated air
    WOOD: 4,        // twig structure
    THATCH: 5,      // leaf structure / dam
    STONE: 6,       // bedrock
    ROOT: 7         // surface root mat (solid, decorative)
  };
  var SOLID = new Uint8Array(256);
  SOLID[T.DIRT] = SOLID[T.GRASS] = SOLID[T.WOOD] = SOLID[T.THATCH] = SOLID[T.STONE] = SOLID[T.ROOT] = 1;
  var isSolid = function (t) { return SOLID[t] === 1; };
  var isStructure = function (t) { return t === T.WOOD || t === T.THATCH; };
  var isDiggable = function (t) { return t === T.DIRT || t === T.ROOT; };

  // 0=left 1=right 2=up 3=down  (orthogonal scans: leaks, dig fronts, repairs)
  var DX = [-1, 1, 0, 0], DY = [0, 0, -1, 1];

  // eight-way table for the pathing field
  // 0 up-left  1 up  2 up-right  3 left  4 right  5 down-left  6 down  7 down-right
  var DX8 = [-1, 0, 1, -1, 1, -1, 0, 1];
  var DY8 = [-1, -1, -1, 0, 0, 1, 1, 1];

  // per-cell movement flags, rebuilt whenever the map changes
  var F_OPEN = 1, F_FLOOR = 2, F_CLING = 4, F_HEAD = 8;

  // Rows over which the dirt darkens. Fixed rather than "the whole map" so a
  // deep world does not wash out the shallow burrow where the colony lives.
  var DEPTH_SPAN = 38;

  var FIELD_POOL = 24;
  // An opening (a dug tile) cannot break a route, so a field survives it for
  // this long before it is rebuilt. Anything turning solid rebuilds at once.
  var FIELD_SOFT_LIFE = 1.5;

  function World(seed) {
    this.w = CFG.W; this.h = CFG.H;
    this.n = this.w * this.h;
    this.tiles = new Uint8Array(this.n);
    this.shp = new Uint8Array(this.n);       // structure hit points (0 = none)
    this.water = new Uint8Array(this.n);     // 0..WATER_MAX per tile
    this.sand = new Uint8Array(this.n);      // 0..SAND_MAX per tile
    this.flags = new Uint8Array(this.n);
    this.flagStamp = -1;
    this.surface = new Int16Array(this.w);   // topmost solid row per column
    this.seed = seed >>> 0;

    this.mapStamp = 1;      // bumps whenever tiles change
    this.solidStamp = 1;    // bumps only when something becomes solid
    this.time = 0;
    this.dirtyTiles = new Set();
    this.fullRedraw = true;

    this.bg = PX.makeCanvas(this.w * CFG.TILE, this.h * CFG.TILE);
    this.bgCtx = this.bg.getContext('2d');

    this.fluidAcc = 0;
    this.waterCount = 0;
    this.sandCount = 0;
    this.fluidTick = 0;

    // pathing field pool
    this.fields = [];
    for (var i = 0; i < FIELD_POOL; i++) this.fields.push(this.newField());
    this.fieldClock = 0;
    this.homeField = this.fields[0];

    this.generate();
  }

  World.T = T;
  World.isSolid = isSolid;
  World.isStructure = isStructure;
  World.isDiggable = isDiggable;
  World.DX8 = DX8;
  World.DY8 = DY8;

  var P = World.prototype;
  P.DX8 = DX8;
  P.DY8 = DY8;

  /* ================= indexing ================= */
  P.idx = function (tx, ty) { return ty * this.w + tx; };
  P.inBounds = function (tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; };
  P.at = function (tx, ty) { return this.inBounds(tx, ty) ? this.tiles[ty * this.w + tx] : T.STONE; };
  P.set = function (tx, ty, v) {
    if (!this.inBounds(tx, ty)) return;
    var i = ty * this.w + tx;
    var old = this.tiles[i];
    if (old === v) return;
    this.tiles[i] = v;
    if (!isStructure(v)) this.shp[i] = 0;
    if (isSolid(v) && !isSolid(old)) { this.solidStamp++; this.clearFluid(i); }
    this.mapStamp++;
    this.markDirty(tx, ty);
  };
  P.solidAt = function (tx, ty) { return SOLID[this.at(tx, ty)] === 1; };
  P.solidPx = function (px, py) {
    return SOLID[this.at(Math.floor(px / CFG.TILE), Math.floor(py / CFG.TILE))] === 1;
  };
  P.markDirty = function (tx, ty) {
    for (var y = ty - 1; y <= ty + 1; y++) {
      for (var x = tx - 1; x <= tx + 1; x++) {
        if (this.inBounds(x, y)) this.dirtyTiles.add(y * this.w + x);
      }
    }
  };
  P.markAllDirty = function () { this.fullRedraw = true; };

  /* ================= generation ================= */
  P.generate = function () {
    var rng = new global.RNG(this.seed);
    var w = this.w, h = this.h, i;
    // feature counts were tuned on a 96 x 48 map; keep the same density
    var areaK = (w * h) / (96 * 48), widthK = w / 96;
    this.tiles.fill(0);

    var minY = 9, maxY = 15;
    var prev = 12;
    for (var x = 0; x < w; x++) {
      var drift = U.fbm1(x * 0.045, this.seed, 4);
      var bump = U.noise1(x * 0.14, this.seed + 991) * 0.6;
      var y = minY + drift * (maxY - minY) + bump * 2;
      y = Math.round(U.clamp(y, minY, maxY));
      // smooth a little so the surface has no cliffs
      y = Math.round((y + prev * 2) / 3);
      prev = y;
      this.surface[x] = y;
    }

    // Neighbouring columns never differ by more than one row, so the surface
    // is walkable end to end without any climbing.
    for (x = 1; x < w; x++) {
      if (this.surface[x] > this.surface[x - 1] + 1) this.surface[x] = this.surface[x - 1] + 1;
      if (this.surface[x] < this.surface[x - 1] - 1) this.surface[x] = this.surface[x - 1] - 1;
    }
    for (x = w - 2; x >= 0; x--) {
      if (this.surface[x] > this.surface[x + 1] + 1) this.surface[x] = this.surface[x + 1] + 1;
      if (this.surface[x] < this.surface[x + 1] - 1) this.surface[x] = this.surface[x + 1] - 1;
    }
    for (x = 0; x < w; x++) this.surface[x] = U.clamp(this.surface[x], minY, maxY);

    for (x = 0; x < w; x++) {
      var top = this.surface[x];
      for (var yy = top; yy < h; yy++) {
        i = yy * w + x;
        if (yy === top) this.tiles[i] = T.GRASS;
        else if (yy === top + 1 + (U.hash1(x * 31 + yy, this.seed + 5) < 0.35 ? 1 : 0)) this.tiles[i] = T.ROOT;
        else if (yy >= h - 2) this.tiles[i] = T.STONE;
        else this.tiles[i] = T.DIRT;
      }
    }

    // scattered clay pockets (still diggable, just visual variety)
    var nClay = Math.round(26 * areaK);
    for (var c = 0; c < nClay; c++) {
      var cx = rng.int(3, w - 4), cy = rng.int(this.surface[cx] + 4, h - 5);
      this.paintBlob(cx, cy, rng.int(1, 3), T.DIRT);
    }

    // natural cave pockets
    var nCave = Math.round(7 * areaK * 0.65);
    for (c = 0; c < nCave; c++) {
      var kx = rng.int(6, w - 7), ky = rng.int(18, h - 8);
      var r = rng.int(2, 4 + (ky > 40 ? 2 : 0));
      this.carveBlob(kx, ky, r, 1.6);
    }

    // surface pebbles: single tiles sitting on the grass
    var nPeb = Math.round(14 * widthK);
    for (c = 0; c < nPeb; c++) {
      var bx = rng.int(4, w - 5);
      var by = this.surface[bx] - 1;
      if (this.at(bx, by) === T.AIR && this.at(bx, by - 1) !== T.STONE) {
        this.tiles[by * w + bx] = T.STONE;
      }
    }

    this.mapStamp++;
    this.solidStamp++;
    this._skyGrad = null;
    this.markAllDirty();
    this.rebuildBg();
  };

  P.paintBlob = function (cx, cy, r, tile) {
    for (var y = cy - r; y <= cy + r; y++) {
      for (var x = cx - r; x <= cx + r; x++) {
        if (!this.inBounds(x, y)) continue;
        if (U.dist2(x, y, cx, cy) <= r * r + r * 0.4) this.tiles[y * this.w + x] = tile;
      }
    }
  };

  P.carveBlob = function (cx, cy, r, ry) {
    ry = ry == null ? r : ry;
    for (var y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (var x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (!this.inBounds(x, y)) continue;
        var nx = (x - cx) / r, ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1.0) {
          var i = y * this.w + x;
          if (this.tiles[i] !== T.STONE) { this.tiles[i] = T.TUNNEL; this.shp[i] = 0; }
        }
      }
    }
    this.mapStamp++;
    for (y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) {
      for (x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x++) this.markDirty(x, y);
    }
  };

  /** carve a plain rectangular room, corners included */
  P.carveBox = function (x0, y0, w, h) {
    for (var y = y0; y < y0 + h; y++) {
      for (var x = x0; x < x0 + w; x++) {
        if (!this.inBounds(x, y)) continue;
        var i = y * this.w + x;
        if (this.tiles[i] === T.STONE) continue;
        this.tiles[i] = T.TUNNEL;
        this.shp[i] = 0;
        this.markDirty(x, y);
      }
    }
    this.mapStamp++;
  };

  /* ================= pathing ================= */
  /* An ant is a little smaller than one cell and moves the way a real one
    does: it walks along floors, steps off and onto ledges, climbs any wall
    it is touching, and climbs or drops straight down. The field is a graph
    of exactly those moves, so following it never asks for something the
    body cannot do -- which is what used to produce the hopping and dithering.

    From cell A to neighbour B (B open), direction e:
      down (6) ............. always: climb down a wall or drop.   cost 1
      A unsupported ........ nothing else (no floor, no wall: it is falling)
      sideways (3/4) ....... A or B has a floor                   cost 1, 2 into air
      up (1) ............... A touches a wall to climb            cost 3
      up-diag (0/2) ........ head room above A, a ledge beside A  cost 4
      down-diag (5/7) ...... A has a floor, the side cell is open cost 2

    The field grows outward from the destination, so each edge is checked as
    the move the ant will make TOWARD it. */
  P.isOpen = function (tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    return SOLID[this.tiles[ty * this.w + tx]] === 0;
  };

  /** an open tile the ant can come to rest in (something solid beneath it) */
  P.standable = function (tx, ty) {
    if (!this.isOpen(tx, ty)) return false;
    return this.solidAt(tx, ty + 1);
  };

  /** movement flags for every cell, cached per map change */
  P.cellFlags = function () {
    if (this.flagStamp === this.mapStamp) return this.flags;
    var w = this.w, h = this.h, t = this.tiles, fl = this.flags;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        if (SOLID[t[i]]) { fl[i] = 0; continue; }
        var f = F_OPEN;
        if (y + 1 >= h || SOLID[t[i + w]]) f |= F_FLOOR;
        // something to grip: a wall beside, or one diagonally above (an ant
        // reaches up with its front legs, which is what gets it round the
        // overhanging lip of a cave)
        if (x === 0 || x === w - 1 || SOLID[t[i - 1]] || SOLID[t[i + 1]] ||
          (y > 0 && (SOLID[t[i - w - 1]] || SOLID[t[i - w + 1]]))) f |= F_CLING;
        if (y > 0 && !SOLID[t[i - w]]) f |= F_HEAD;
        fl[i] = f;
      }
    }
    this.flagStamp = this.mapStamp;
    return fl;
  };

  /** cost of the move from (ax,ay) in direction e, or 0 if the ant cannot make it */
  P.stepCost = function (ax, ay, e) {
    var w = this.w, bx = ax + DX8[e], by = ay + DY8[e];
    if (!this.inBounds(ax, ay) || !this.inBounds(bx, by)) return 0;
    var fl = this.cellFlags();
    var fa = fl[ay * w + ax], fb = fl[by * w + bx];
    if (!(fa & F_OPEN) || !(fb & F_OPEN)) return 0;
    return edgeCost(fl, w, fa, fb, ax, ay, bx, e);
  };

  function edgeCost(fl, w, fa, fb, ax, ay, bx, e) {
    if (e === 6) return 1;
    if (!(fa & (F_FLOOR | F_CLING))) return 0;
    switch (e) {
      case 3: case 4:
        if (fb & F_FLOOR) return 1;
        return (fa & F_FLOOR) ? 2 : 0;
      case 1:
        return (fa & F_CLING) ? 3 : 0;
      case 0: case 2:
        // climb the face of the block beside us, then step onto it
        if (!(fa & F_HEAD)) return 0;
        return (fl[ay * w + bx] & F_OPEN) ? 0 : 4;
      default: // 5, 7
        if (!(fa & F_FLOOR)) return 0;
        return (fl[ay * w + bx] & F_OPEN) ? 2 : 0;
    }
  }

  P.newField = function () {
    return {
      tx: -999, ty: -999, stamp: -1, solidStamp: -1, time: -99, used: 0,
      dist: new Uint16Array(this.n), dir: new Int8Array(this.n)
    };
  };

  P.computeField = function (f, sx, sy) {
    var dist = f.dist, dir = f.dir, w = this.w, h = this.h;
    dist.fill(0xFFFF);
    dir.fill(-1);
    f.stamp = this.mapStamp; f.solidStamp = this.solidStamp; f.time = this.time;
    f.reqX = sx; f.reqY = sy;

    // the destination only has to be an open cell
    if (!this.isOpen(sx, sy)) {
      var best = null, bd = 1e9;
      for (var rad = 1; rad <= 7; rad++) {
        for (var y = sy - rad; y <= sy + rad; y++) {
          for (var x = sx - rad; x <= sx + rad; x++) {
            if (!this.isOpen(x, y)) continue;
            var d = U.dist2(x, y, sx, sy);
            if (d < bd) { bd = d; best = { x: x, y: y }; }
          }
        }
        if (best) break;
      }
      if (!best) { f.tx = -999; f.ty = -999; return false; }
      sx = best.x; sy = best.y;
    }

    var fl = this.cellFlags();
    // A destination in mid-air (the top row of a tall room, food still
    // falling) is a cell no ant can stand in, so nothing would ever reach it.
    // Aim at the first cell below it that has a floor or a wall to hold.
    for (var drop = 0; drop < 12; drop++) {
      var fs = fl[sy * w + sx];
      if (fs & (F_FLOOR | F_CLING)) break;
      if (sy + 1 >= h || !(fl[(sy + 1) * w + sx] & F_OPEN)) break;
      sy++;
    }
    var NB = 8;                                    // > largest step cost (4)
    var buckets = this._buckets;
    if (!buckets) {
      buckets = this._buckets = [];
      for (var q = 0; q < NB; q++) buckets.push([]);
    }
    for (q = 0; q < NB; q++) buckets[q].length = 0;

    var si = sy * w + sx;
    dist[si] = 0;
    buckets[0].push(si);
    var cur = 0, queued = 1;

    while (queued > 0) {
      var bk = buckets[cur % NB];
      if (bk.length === 0) { cur++; continue; }
      var i = bk.pop();
      queued--;
      if (dist[i] !== cur) continue;               // stale entry

      var bx = i % w, by = (i / w) | 0, fb = fl[i];
      // every cell A from which one move e lands here
      for (var e = 0; e < 8; e++) {
        var ax = bx - DX8[e], ay = by - DY8[e];
        if (ax < 0 || ay < 0 || ax >= w || ay >= h) continue;
        var j = ay * w + ax, fa = fl[j];
        if (!(fa & F_OPEN)) continue;
        var step = edgeCost(fl, w, fa, fb, ax, ay, bx, e);
        if (!step) continue;
        var nd = cur + step;
        if (nd < dist[j]) {
          dist[j] = nd;
          dir[j] = e;
          buckets[nd % NB].push(j);
          queued++;
        }
      }
    }

    f.tx = sx; f.ty = sy;
    return true;
  };

  /** a field is usable until something turns solid, or a little while after a dig */
  P.fieldFresh = function (f) {
    if (!f || f.solidStamp !== this.solidStamp) return false;
    return f.stamp === this.mapStamp || this.time - f.time < FIELD_SOFT_LIFE;
  };

  /** rebuild a field in place, for everyone sharing it */
  P.refreshField = function (f) {
    if (f === this.homeField) return this.refreshHome(true);
    if (f.stamp === this.mapStamp && f.solidStamp === this.solidStamp) return f;
    this.computeField(f, f.reqX, f.reqY);
    return f;
  };

  /** get a cached pathing field aimed at (tx,ty) */
  P.acquireField = function (tx, ty) {
    this.fieldClock++;
    var pool = this.fields, i, f;
    for (i = 0; i < pool.length; i++) {
      f = pool[i];
      if (f.tx === -999) continue;
      if (Math.abs(f.reqX - tx) <= 1 && Math.abs(f.reqY - ty) <= 1 && this.fieldFresh(f)) {
        f.used = this.fieldClock;
        return f;
      }
    }
    // reuse the coldest slot (never the home field)
    var victim = null;
    for (i = 1; i < pool.length; i++) {
      if (!victim || pool[i].used < victim.used) victim = pool[i];
    }
    this.computeField(victim, tx, ty);
    victim.used = this.fieldClock;
    return victim;
  };

  P.refreshHome = function (force) {
    var f = this.homeField;
    if (!this.fieldFresh(f) || (force && f.stamp !== this.mapStamp)) {
      this.computeField(f, this.homeTx == null ? 0 : this.homeTx, this.homeTy == null ? 0 : this.homeTy);
    }
    return f;
  };

  P.setHome = function (tx, ty) {
    this.homeTx = tx; this.homeTy = ty;
    this.homeField.solidStamp = -1;
  };

  /** the field's stored move (0..7) from a tile; -1 if none */
  P.stepToward = function (f, tx, ty) {
    if (!f || tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return -1;
    return f.dir[ty * this.w + tx];
  };
  P.distAt = function (f, tx, ty) {
    if (!f || tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return 0xFFFF;
    return f.dist[ty * this.w + tx];
  };

  /* ================= fluids ================= */
  P.clearFluid = function (i) {
    if (this.water[i]) { this.waterCount = Math.max(0, this.waterCount - this.water[i]); this.water[i] = 0; }
    if (this.sand[i]) { this.sandCount = Math.max(0, this.sandCount - this.sand[i]); this.sand[i] = 0; }
  };
  P.addWater = function (tx, ty, amt) {
    if (!this.inBounds(tx, ty)) return;
    var i = ty * this.w + tx;
    if (SOLID[this.tiles[i]]) return;
    var before = this.water[i];
    this.water[i] = Math.min(CFG.WATER_MAX, this.water[i] + amt);
    this.waterCount += this.water[i] - before;
  };
  P.addSand = function (tx, ty, amt) {
    if (!this.inBounds(tx, ty)) return;
    var i = ty * this.w + tx;
    if (SOLID[this.tiles[i]]) return;
    var before = this.sand[i];
    this.sand[i] = Math.min(CFG.SAND_MAX, this.sand[i] + amt);
    this.sandCount += this.sand[i] - before;
  };
  P.waterAtPx = function (px, py) {
    var tx = Math.floor(px / CFG.TILE), ty = Math.floor(py / CFG.TILE);
    if (!this.inBounds(tx, ty)) return 0;
    return this.water[ty * this.w + tx];
  };
  P.sandAtPx = function (px, py) {
    var tx = Math.floor(px / CFG.TILE), ty = Math.floor(py / CFG.TILE);
    if (!this.inBounds(tx, ty)) return 0;
    return this.sand[ty * this.w + tx];
  };

  P.stepFluids = function () {
    this.fluidTick++;
    // the map is large; skip the passes entirely when there is nothing to move
    if (this.waterCount > 0) {
      this._fallWater();
      this._spreadWater();
      if (this.fluidTick % 11 === 0) this._evaporate();
    }
    if (this.sandCount > 0) {
      this._fallSand();
      this._creepSand();
    }
    // keep the running totals honest
    if (this.fluidTick % 97 === 0) this.recountFluids();
  };

  P.recountFluids = function () {
    var wsum = 0, ssum = 0, t = this.tiles;
    for (var i = 0; i < this.n; i++) {
      if (SOLID[t[i]]) continue;
      wsum += this.water[i]; ssum += this.sand[i];
    }
    this.waterCount = wsum; this.sandCount = ssum;
  };

  /** exposed water slowly dries out, so floods recede instead of lasting forever */
  P._evaporate = function () {
    var w = this.w, h = this.h, water = this.water, t = this.tiles;
    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var i = row + x;
        var v = water[i];
        if (v <= 0) continue;
        if (y > 0 && water[i - w] > 0) continue;      // covered, not exposed
        if (SOLID[t[i]]) continue;
        if (U.hash1(x * 7 + y * 13, this.fluidTick) < 0.45) {
          water[i] = v - 1;
          this.waterCount = Math.max(0, this.waterCount - 1);
        }
      }
    }
  };

  /** phase 1: water falls (top-down so it can travel many tiles per tick) */
  P._fallWater = function () {
    var w = this.w, h = this.h, water = this.water, t = this.tiles;
    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var i = row + x;
        var v = water[i];
        if (v <= 0) continue;
        if (SOLID[t[i]]) continue;
        var j = i + w;
        if (y + 1 >= h) { water[i] = 0; this.waterCount -= v; continue; }
        if (SOLID[t[j]]) continue;
        if (water[j] >= CFG.WATER_MAX) continue;
        var room = CFG.WATER_MAX - water[j];
        var move = v < room ? v : room;
        water[i] -= move; water[j] += move;
      }
    }
  };

  /** phase 2: water finds level (bottom-up) */
  P._spreadWater = function () {
    var w = this.w, h = this.h, water = this.water, t = this.tiles;
    for (var y = h - 2; y >= 0; y--) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var i = row + x;
        var v = water[i];
        if (v <= 1) continue;
        var dir0 = (x & 1) ? 1 : -1;
        for (var s = 0; s < 2; s++) {
          var nx = x + dir0 * (s ? -1 : 1);
          if (nx < 0 || nx >= w) continue;
          var j = row + nx;
          if (SOLID[t[j]]) continue;
          // a difference of one is already level: handing it across would
          // just swap the two cells every tick
          var diff = water[i] - water[j];
          if (diff >= 2) {
            var give = diff > 3 ? 2 : 1;
            water[i] -= give; water[j] += give;
          }
        }
      }
    }
  };

  P._fallSand = function () {
    var w = this.w, h = this.h, sand = this.sand, t = this.tiles, MAX = CFG.SAND_MAX;
    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var i = row + x;
        var v = sand[i];
        if (v <= 0 || SOLID[t[i]]) continue;
        if (y + 1 >= h) continue;
        var j = i + w;
        if (SOLID[t[j]] || sand[j] >= MAX) continue;
        var room = MAX - sand[j];
        var move = v < room ? v : room;
        sand[i] -= move; sand[j] += move;
      }
    }
  };

  /** sand piles up and slowly slumps sideways */
  P._creepSand = function () {
    var w = this.w, h = this.h, sand = this.sand, t = this.tiles, MAX = CFG.SAND_MAX;
    for (var y = h - 2; y >= 0; y--) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var i = row + x;
        var v = sand[i];
        if (v < 3 || SOLID[t[i]]) continue;
        var d0 = (x & 1) ? 1 : -1;
        for (var s = 0; s < 2; s++) {
          var nx = x + d0 * (s ? -1 : 1);
          if (nx < 0 || nx >= w) continue;
          var j = row + nx;
          if (SOLID[t[j]]) continue;
          if (sand[j] > v - 1) continue;
          if (y + 1 < h && !SOLID[t[j + w]] && sand[j + w] < MAX) continue; // prefer falling first
          sand[i] -= 1; sand[j] += 1;
          break;
        }
      }
    }
  };

  P.update = function (dt) {
    this.time += dt;
    this.fluidAcc += dt;
    var step = 1 / CFG.FLUID_HZ;
    var guard = 0;
    while (this.fluidAcc >= step && guard++ < 5) {
      this.fluidAcc -= step;
      this.stepFluids();
    }
  };

  /* ================= structures ================= */
  P.build = function (tx, ty, kind) {
    if (!this.inBounds(tx, ty)) return false;
    var i = ty * this.w + tx;
    if (SOLID[this.tiles[i]] || this.tiles[i] === T.AIR) return false;
    this.tiles[i] = kind;
    this.shp[i] = CFG.STRUCT_HP;
    this.clearFluid(i);
    this.mapStamp++;
    this.solidStamp++;
    this.markDirty(tx, ty);
    return true;
  };
  /** returns true when the structure gave way */
  P.damageStruct = function (tx, ty, amt) {
    if (!this.inBounds(tx, ty)) return false;
    var i = ty * this.w + tx;
    if (!isStructure(this.tiles[i])) return false;
    var hp = this.shp[i] - Math.max(1, Math.round(amt));
    this.markDirty(tx, ty);
    if (hp <= 0) {
      this.tiles[i] = T.TUNNEL;   // collapsed -> becomes empty tunnel again
      this.shp[i] = 0;
      this.mapStamp++;
      return true;
    }
    this.shp[i] = hp;
    return false;
  };
  P.repairStruct = function (tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    var i = ty * this.w + tx;
    if (!isStructure(this.tiles[i])) return false;
    if (this.shp[i] >= CFG.STRUCT_HP) return false;
    this.shp[i]++;
    this.markDirty(tx, ty);
    return true;
  };

  /* ================= terrain rendering ================= */
  /** the depth-graded colour of excavated space at a given row */
  P.voidColour = function (ty) {
    return voidColourAt(U.clamp((ty - 10) / DEPTH_SPAN, 0, 1));
  };
  function voidColourAt(d) {
    // Kept around half the brightness of the surrounding rock: darker reads as
    // a hole, but much darker and the burrow just looks like missing texture.
    var base = [68, 47, 34], deep = [37, 26, 20];
    return 'rgb(' +
      Math.round(base[0] + (deep[0] - base[0]) * d) + ',' +
      Math.round(base[1] + (deep[1] - base[1]) * d) + ',' +
      Math.round(base[2] + (deep[2] - base[2]) * d) + ')';
  }

  P.rebuildBg = function () {
    var g = this.bgCtx, T8 = CFG.TILE, w = this.w, h = this.h;
    g.fillStyle = '#442f22';
    g.fillRect(0, 0, w * T8, h * T8);

    // sky
    g.fillStyle = this.skyGradient();
    for (var x = 0; x < w; x++) g.fillRect(x * T8, 0, T8, this.surface[x] * T8 + 1);

    // A little depth shading here; the lighting pass supplies most of the range.
    for (var y = 0; y < h; y++) {
      var d = U.clamp((y - 10) / DEPTH_SPAN, 0, 1);
      if (d <= 0) continue;
      g.globalAlpha = d * 0.18;
      g.fillStyle = '#0d0906';
      g.fillRect(0, y * T8, w * T8, T8);
    }
    g.globalAlpha = 1;

    this.fullRedraw = true;
    this.dirtyTiles.clear();
  };

  P.skyGradient = function () {
    // One gradient for the whole sky. Stretching it to each column's own
    // ground height striped the sky into vertical bands.
    if (this._skyGrad) return this._skyGrad;
    var low = 0;
    for (var x = 0; x < this.w; x++) if (this.surface[x] > low) low = this.surface[x];
    this._skyGrad = skyGradientFor(this.bgCtx, low * CFG.TILE);
    return this._skyGrad;
  };
  function skyGradientFor(g, height) {
    var grd = g.createLinearGradient(0, 0, 0, height);
    grd.addColorStop(0, '#3f63a0');
    grd.addColorStop(0.55, '#6f97c8');
    grd.addColorStop(1, '#a9c9e6');
    return grd;
  }

  P.flushDirty = function () {
    if (this.fullRedraw) {
      this.dirtyTiles.clear();
      this.fullRedraw = false;
      for (var y = 0; y < this.h; y++) for (var x = 0; x < this.w; x++) this.paintTile(x, y);
      return;
    }
    if (!this.dirtyTiles.size) return;
    var list = Array.from(this.dirtyTiles);
    this.dirtyTiles.clear();
    // edges redraw too, since lips and rims depend on the neighbours
    var all = new Set();
    for (var i = 0; i < list.length; i++) {
      var cx = list[i] % this.w, cy = (list[i] / this.w) | 0;
      for (var y2 = cy - 1; y2 <= cy + 1; y2++) {
        for (var x2 = cx - 1; x2 <= cx + 1; x2++) if (this.inBounds(x2, y2)) all.add(y2 * this.w + x2);
      }
    }
    var self = this;
    all.forEach(function (k) { self.paintTile(k % self.w, (k / self.w) | 0); });
  };

  P.paintTile = function (tx, ty) {
    var g = this.bgCtx, T8 = CFG.TILE;
    var px = tx * T8, py = ty * T8;
    var t = this.at(tx, ty);

    if (!SOLID[t] && ty < this.surface[tx]) {
      // Open sky. The nest mouth carves "tunnel" cells above the grass; they
      // are still sky and must look like it.
      g.fillStyle = this.skyGradient();
      g.fillRect(px, py, T8, T8);
      return;
    }
    if (!SOLID[t]) {
      g.fillStyle = this.voidColour(ty);
      g.fillRect(px, py, T8, T8);
      this.paintTunnelEdges(g, tx, ty);
      return;
    }

    var n = (tx * 73856093 ^ ty * 19349663) >>> 0;
    var r1 = U.hash1(n, 11), r2 = U.hash1(n, 23), r3 = U.hash1(n, 37);
    var depth = U.clamp((ty - 8) / DEPTH_SPAN, 0, 1);
    var hp = isStructure(t) ? this.shp[ty * this.w + tx] : CFG.STRUCT_HP;
    drawTileArt(g, t, px, py, r1, r2, r3, depth, !this.solidAt(tx, ty - 1), hp);
  };

  /** the art for one solid tile; shared by the map and the colony index */
  function drawTileArt(g, t, px, py, r1, r2, r3, depth, openAbove, hp) {
    var T8 = CFG.TILE;
    switch (t) {
      case T.GRASS: {
        g.fillStyle = PX.mix('#3d7a2a', '#2c5a1c', r1); g.fillRect(px, py, T8, T8);
        // grass fringe, a little ragged
        g.fillStyle = '#5aa636';
        for (var i = 0; i < T8; i++) {
          var hgt = 1 + Math.floor(U.hash1(i * 7 + Math.floor(r2 * 97), 41) * 3);
          g.fillRect(px + i, py, 1, hgt);
        }
        g.fillStyle = '#79cf4a';
        g.fillRect(px, py, T8, 1);
        g.fillStyle = '#2a5417';
        g.fillRect(px + Math.floor(r1 * 7), py + 1 + Math.floor(r3 * 3), 1, 1);
        break;
      }
      case T.ROOT: {
        g.fillStyle = PX.mix('#4a2f18', '#3a2413', r1); g.fillRect(px, py, T8, T8);
        g.fillStyle = '#63401f';
        g.fillRect(px, py + Math.floor(r2 * 5), T8, 1);
        g.fillRect(px + Math.floor(r3 * 6), py, 1, T8);
        break;
      }
      case T.DIRT: {
        var base = PX.mix('#7d5430', '#5c3c22', r1 * 0.7 + depth * 0.4);
        g.fillStyle = base; g.fillRect(px, py, T8, T8);
        g.fillStyle = PX.shade(base, r2 < 0.5 ? -0.16 : 0.14);
        g.fillRect(px + Math.floor(r1 * 6), py + Math.floor(r2 * 6), 2, 1);
        g.fillRect(px + Math.floor(r3 * 6), py + Math.floor((r1 * 6) | 0), 1, 2);
        if (r3 > 0.88) {
          g.fillStyle = '#6d5c4a';
          g.fillRect(px + 2 + Math.floor(r1 * 4), py + 2 + Math.floor(r2 * 4), 2, 2);
          g.fillStyle = '#8a7a64';
          g.fillRect(px + 2 + Math.floor(r1 * 4), py + 2 + Math.floor(r2 * 4), 1, 1);
        }
        if (openAbove) { g.fillStyle = '#8f6440'; g.fillRect(px, py, T8, 1); }
        break;
      }
      case T.STONE: {
        var sb = PX.mix('#585349', '#3a362f', r1 * 0.8);
        g.fillStyle = sb; g.fillRect(px, py, T8, T8);
        g.fillStyle = PX.shade(sb, -0.2);
        g.fillRect(px, py + 3 + Math.floor(r2 * 3), T8, 1);
        g.fillRect(px + 3 + Math.floor(r1 * 3), py, 1, T8);
        g.fillStyle = PX.shade(sb, 0.16);
        g.fillRect(px, py, T8, 1);
        break;
      }
      case T.WOOD: {
        g.fillStyle = '#6b4a26'; g.fillRect(px, py, T8, T8);
        g.fillStyle = '#8a6134';
        g.fillRect(px, py + 1, T8, 2);
        g.fillRect(px, py + 5, T8, 2);
        g.fillStyle = '#54381d';
        g.fillRect(px, py + 3, T8, 1);
        g.fillRect(px + 4, py + 1, 1, 2);
        g.fillStyle = '#a8794a'; g.fillRect(px, py + 1, 1, 1);
        break;
      }
      case T.THATCH: {
        g.fillStyle = '#7d6a1f'; g.fillRect(px, py, T8, T8);
        g.fillStyle = '#a8912f';
        for (var k = 0; k < 4; k++) g.fillRect(px, py + k * 2, T8, 1);
        g.fillStyle = '#c2a83e';
        g.fillRect(px, py, T8, 1);
        g.fillRect(px + ((r1 * 6) | 0), py + 2, 2, 1);
        g.fillStyle = '#5f5016';
        g.fillRect(px + ((r3 * 5) | 0), py + 5, 2, 1);
        break;
      }
    }

    // damage cracks on structures
    if (isStructure(t) && hp < CFG.STRUCT_HP) {
      g.fillStyle = 'rgba(20,12,8,.75)';
      g.fillRect(px + 2 + ((r1 * 3) | 0), py + 1, 1, 4);
      g.fillRect(px + 3 + ((r1 * 3) | 0), py + 3, 2, 1);
      if (hp <= 1) g.fillRect(px + 4, py + 5, 2, 2);
    }
  }

  /** dark lip where a tunnel meets solid ground sells the carved look */
  P.paintTunnelEdges = function (g, tx, ty) {
    var T8 = CFG.TILE, px = tx * T8, py = ty * T8;
    g.fillStyle = 'rgba(18,10,6,.55)';
    if (this.solidAt(tx, ty - 1)) g.fillRect(px, py, T8, 1);
    if (this.solidAt(tx, ty + 1)) g.fillRect(px, py + T8 - 1, T8, 1);
    if (this.solidAt(tx - 1, ty)) g.fillRect(px, py, 1, T8);
    if (this.solidAt(tx + 1, ty)) g.fillRect(px + T8 - 1, py, 1, T8);
    if (this.solidAt(tx, ty + 1)) {
      g.fillStyle = 'rgba(180,120,70,.14)';
      g.fillRect(px, py + T8 - 2, T8, 1);
    }
  };

  /**
   * Paint one 8x8 icon of a tile kind (or 'water' / 'sand' / 'tunnel' /
   * 'sky') at (x, y). Used by the colony index and the tooltips.
   */
  World.drawTileIcon = function (g, kind, x, y) {
    var T8 = CFG.TILE;
    if (kind === 'sky') {
      g.fillStyle = skyGradientFor(g, T8); g.fillRect(x, y, T8, T8);
      return;
    }
    if (kind === 'tunnel' || kind === 'water' || kind === 'sand') {
      g.fillStyle = voidColourAt(0.3); g.fillRect(x, y, T8, T8);
      g.fillStyle = 'rgba(18,10,6,.55)';
      g.fillRect(x, y + T8 - 1, T8, 1);
      if (kind === 'water') {
        g.globalAlpha = 0.66; g.fillStyle = '#4fa3e0'; g.fillRect(x, y + 2, T8, T8 - 2);
        g.globalAlpha = 0.6; g.fillStyle = '#bfe4ff'; g.fillRect(x, y + 2, T8, 1);
        g.globalAlpha = 0.35; g.fillStyle = '#1d4f7d'; g.fillRect(x, y + T8 - 2, T8, 2);
        g.globalAlpha = 1;
      } else if (kind === 'sand') {
        g.fillStyle = '#d8c084'; g.fillRect(x, y + 3, T8, T8 - 3);
        g.fillStyle = '#ead9a4'; g.fillRect(x, y + 3, T8, 1);
        g.fillStyle = '#bda468'; g.fillRect(x + 2, y + 5, 1, 1); g.fillRect(x + 5, y + 6, 1, 1);
      }
      return;
    }
    var hp = kind === 'cracked' ? 1 : CFG.STRUCT_HP;
    var t = kind === 'cracked' ? T.WOOD : kind;
    drawTileArt(g, t, x, y, 0.4, 0.3, 0.7, 0.2, true, hp);
  };

  /* ================= queries used by AI ================= */
  P.dirtAdjacentToTunnel = function (tx, ty) {
    for (var d = 0; d < 4; d++) {
      var x = tx + DX[d], y = ty + DY[d];
      if (this.inBounds(x, y) && isDiggable(this.at(x, y))) return { x: x, y: y, d: d };
    }
    return null;
  };

  /** find a dry tunnel tile that water is trying to enter: the spot to dam */
  P.findLeak = function () {
    if (this.waterCount <= 0) return null;
    var w = this.w, h = this.h;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        if (this.tiles[i] !== T.TUNNEL || this.water[i] > 0) continue;
        if (this.water[i - 1] >= 3 || this.water[i + 1] >= 3 || this.water[i - w] >= 3 || this.water[i + w] >= 3) {
          return { x: x, y: y, urgency: 1 };
        }
      }
    }
    return null;
  };

  P.findDamage = function (tx, ty, radius) {
    var best = null, bd = radius * radius;
    for (var y = ty - radius; y <= ty + radius; y++) {
      for (var x = tx - radius; x <= tx + radius; x++) {
        if (!this.inBounds(x, y)) continue;
        var i = y * this.w + x;
        if (!isStructure(this.tiles[i])) continue;
        if (this.shp[i] >= CFG.STRUCT_HP) continue;
        var d = U.dist2(x, y, tx, ty);
        if (d < bd) { bd = d; best = { x: x, y: y, d: d }; }
      }
    }
    return best;
  };

  P.countTile = function (t) {
    var c = 0;
    for (var i = 0; i < this.n; i++) if (this.tiles[i] === t) c++;
    return c;
  };

  global.World = World;
  global.T = T;
  global.isSolidTile = isSolid;
})(window);
