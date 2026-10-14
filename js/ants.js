/* ============================================================
  ants.js  role behaviours. The colony runs itself from here.
  ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG, U = global.U, T8 = CFG.TILE;
  var DX8 = global.World.DX8, DY8 = global.World.DY8;

  /* ============================================================
    movement
    ============================================================ */

  /**
   * The next move toward a field's source, or -1. The field only stores moves
   * an ant can physically make (see world.js), so following it strictly
   * lowers the distance every step: no dithering, no hopping.
   */
  function pickStep(w, f, tx, ty) {
    if (!f) return -1;
    var d = w.distAt(f, tx, ty);
    if (d === 0xFFFF || d === 0) return -1;
    var e = w.stepToward(f, tx, ty);
    if (e < 0 || e > 7) return -1;
    if (!w.stepCost(tx, ty, e)) return -1;       // the map changed under it
    return e;
  }

  /**
   * Walk one tick along ant.field. Returns true when the ant is at the
   * field's source; in that case it has NOT moved this tick, so the caller
   * decides what to do there (stand, work, bite...).
   */
  function follow(ant, game, dt) {
    var w = game.world, f = ant.field;
    if (!f) { drive(ant, game, 0, dt, 0); return false; }
    var tx = ant.tileX(), ty = ant.tileY();
    var d = w.distAt(f, tx, ty);

    if (d === 0) { ant.move = null; return true; }
    if (d <= 2 && f.tx !== -999 && U.dist(ant.x, ant.y, f.tx * T8 + T8 / 2, f.ty * T8 + T8) < 5) { ant.move = null; return true; }

    // A ledge climb is one move in two motions: up the face, then across onto
    // the top. Half way, the ant hangs in a cell that counts as mid-air, so
    // re-planning there would say "drop" and it would slide back down for
    // ever. Finish the move first.
    var mv = ant.move;
    if (mv && (tx !== mv.x || ty !== mv.y) && ant.age - mv.t0 < 1.6 && Math.abs(tx - mv.x) <= 1 && ty >= mv.y) {
      ant.wantsMove = true;
      if (ty > mv.y) drive(ant, game, mv.side, dt, -1);
      else drive(ant, game, U.sign(mv.x * T8 + T8 / 2 - ant.x) || mv.side, dt, 0);
      return false;
    }
    ant.move = null;

    var e = pickStep(w, f, tx, ty);
    if (e < 0 && (f.stamp !== w.mapStamp || f.solidStamp !== w.solidStamp)) {
      // a fresh dig opened this cell after the field was built
      w.refreshField(f);
      e = pickStep(w, f, tx, ty);
    }
    ant.wantsMove = true;
    if (e < 0) {
      // mid-fall, or genuinely cut off: let gravity settle it
      drive(ant, game, 0, dt, 0);
      return false;
    }
    execStep(ant, game, e, dt);
    return false;
  }

  /** carry out one graph move from the ant's current cell */
  function execStep(ant, game, e, dt) {
    var tx = ant.tileX(), lane = tx * T8 + T8 / 2;
    var dir = 0, climb = 0;
    switch (e) {
      case 3: case 4: case 5: case 7: {
        var want = (tx + DX8[e]) * T8 + T8 / 2;
        dir = Math.abs(want - ant.x) < 0.5 ? 0 : U.sign(want - ant.x);
        break;
      }
      case 1:                                       // climb straight up
        if (Math.abs(ant.x - lane) > 1) dir = U.sign(lane - ant.x);
        climb = -1;
        break;
      case 6:                                       // climb down, or drop
        if (Math.abs(ant.x - lane) > 1) dir = U.sign(lane - ant.x);
        else climb = 1;
        break;
      default: {                                    // 0 / 2: up the face of a ledge
        dir = DX8[e];
        climb = -1;
        ant.move = { x: tx + DX8[e], y: ant.tileY() - 1, side: DX8[e], t0: ant.age || 0 };
      }
    }
    drive(ant, game, dir, dt, climb);
  }

  /**
   * Go to a tile by the flow field. Returns true on arrival (and stands still
   * that tick). Re-aims the field when the goal or the map changes.
   */
  function goTo(ant, game, tx, ty, dt) {
    var w = game.world, f = ant.field;
    if (!f || !w.fieldFresh(f) || Math.abs(f.reqX - tx) > 1 || Math.abs(f.reqY - ty) > 1) {
      ant.field = w.acquireField(tx, ty);
    }
    if (follow(ant, game, dt)) { drive(ant, game, 0, dt, 0); return true; }
    return false;
  }

  /** can this ant get to that tile at all? */
  function canReach(ant, game, tx, ty) {
    var w = game.world, f = w.acquireField(tx, ty);
    return w.distAt(f, ant.tileX(), ant.tileY()) !== 0xFFFF;
  }

  /** apply horizontal intent, then climbing or gravity, for one tick */
  function drive(ant, game, dir, dt, climb) {
    var w = game.world;
    var wet = w.waterAtPx(ant.x, ant.y - 2);
    var sandy = w.sandAtPx(ant.x, ant.y - 2);
    var mul = wet >= CFG.DROWN_AMOUNT ? 0.4 : wet > 0 ? 0.72 : 1;
    if (sandy > 2) mul *= 0.55;

    if (ant.unstickT > 0) { ant.unstickT -= dt; dir = ant.unstickDir; climb = 0; }

    var want = dir * ant.speed * mul;
    var grip = ant.onGround || ant.clinging;
    ant.vx = approach(ant.vx, want, (grip ? 420 : 160) * dt);
    ant.moveX(w, ant.vx * dt);
    if (ant.hitX) ant.vx = 0;

    ant.physics(w, dt, wet > 0, climb || 0, ant.speed * CFG.CLIMB * mul);

    // face where we are going; ignore the tiny corrections around a lane
    if (dir !== 0 && (Math.abs(ant.vx) > 2 || ant.hitX || ant.clinging)) ant.facing = dir;

    // walk cycle only while actually moving
    var moving = Math.abs(ant.vx) > 3 || (ant.clinging && Math.abs(ant.vy) > 2);
    if (moving) ant.animT += dt * (6 + ant.speed * 0.22);
    ant.anim = Math.floor(ant.animT) % PX_ANIM;
  }
  var PX_ANIM = 4;
  var approach = global.approach;

  /** amble back and forth around an anchor x, pausing now and then */
  function idleWander(ant, game, dt, anchorX, radius) {
    ant.wanderT = (ant.wanderT || 0) - dt;
    if (ant.wanderT <= 0) {
      ant.wanderT = 0.8 + Math.random() * 2.2;
      var r = Math.random();
      ant.wanderDir = r < 0.3 ? 0 : (r < 0.65 ? -1 : 1);
      if (anchorX != null) {
        // drift back toward the anchor rather than wandering off the map
        if (ant.x < anchorX - radius) ant.wanderDir = 1;
        else if (ant.x > anchorX + radius) ant.wanderDir = -1;
      }
    }
    drive(ant, game, ant.wanderDir || 0, dt, 0);
    if (ant.hitX) ant.wanderDir = -(ant.wanderDir || 1);
  }

  /* ============================================================
    combat
    ============================================================ */
  function centreDist(a, b) {
    return U.dist(a.x, a.y - a.h / 2, b.x, b.y - b.h / 2);
  }

  /** one bite, if the cooldown allows */
  function bite(ant, target, game) {
    ant.facing = U.sign(target.x - ant.x) || ant.facing;
    if (ant.atkCD > 0 || target.dead) return false;
    ant.atkCD = CFG.ATTACK_INTERVAL;
    ant.lungeT = 0.14;
    target.hurt(ant.atk, ant);
    game.hitFx(target, ant.atk, ant.isEnemy);
    return true;
  }

  /** chase a target by the flow field; true once it is within reach */
  function closeIn(ant, game, target, dt, range) {
    if (centreDist(ant, target) <= range) {
      drive(ant, game, 0, dt, 0);
      ant.facing = U.sign(target.x - ant.x) || ant.facing;
      return true;
    }
    if (goTo(ant, game, target.tileX(), target.tileY(), dt)) {
      // same cell but not quite touching: shuffle the last pixel or two
      ant.facing = U.sign(target.x - ant.x) || ant.facing;
    }
    return false;
  }

  /**
   * Every colony ant fights back when a raider is right on it. Returns true
   * if it spent this tick fighting.
   */
  function selfDefense(ant, game, dt) {
    var foe = game.nearestEnemy(ant.x, ant.y - ant.h / 2, CFG.MELEE_RANGE + 1);
    if (!foe) return false;
    drive(ant, game, 0, dt, 0);
    bite(ant, foe, game);
    if (ant.notice <= 0) ant.notice = 0.35;
    return true;
  }

  /* ============================================================
    common systems: timers, rescue, drowning, stuck handling
    ============================================================ */
  function commonTick(ant, game, dt) {
    if (ant.hurtT > 0) ant.hurtT -= dt;
    if (ant.notice > 0) ant.notice -= dt;
    if (ant.atkCD > 0) ant.atkCD -= dt;
    if (ant.lungeT > 0) ant.lungeT -= dt;
    ant.t -= dt;                              // every state's countdown
    ant.age = (ant.age || 0) + dt;

    var w = game.world;

    // Safety net: tunnels are dug and sealed while ants are standing in them.
    // An ant whose own cell turns solid is moved to the nearest open cell.
    if (w.solidAt(ant.tileX(), ant.tileY())) {
      var ax = ant.tileX(), ay = ant.tileY(), freed = false;
      for (var rr = 1; rr <= 5 && !freed; rr++) {
        for (var ddy = -rr; ddy <= rr && !freed; ddy++) {
          for (var ddx = -rr; ddx <= rr; ddx++) {
            if (Math.max(Math.abs(ddx), Math.abs(ddy)) !== rr) continue;
            if (!w.isOpen(ax + ddx, ay + ddy)) continue;
            ant.x = (ax + ddx) * T8 + T8 / 2;
            ant.y = (ay + ddy) * T8 + T8 - 0.01;
            ant.vy = 0; ant.vx = 0;
            ant.field = null;
            freed = true;
            break;
          }
        }
      }
    }

    var wet = w.waterAtPx(ant.x, ant.y - 3);
    if (wet >= CFG.DROWN_AMOUNT) {
      ant.hurt(1.1 * dt);
      if (ant.notice <= 0) ant.notice = 0.6;
    }

    // Stuck detection, sampled every 0.75s, only while the ant is trying to
    // travel. Recovery re-plans the route and, failing that, drops the errand.
    // (It used to launch the ant upward every frame, which is how ants ended
    // up bouncing around the sky.)
    ant.probeT = (ant.probeT || 0) + dt;
    if (ant.probeT >= 0.75) {
      var moved = ant.probeX == null ? 999 : U.dist2(ant.x, ant.y, ant.probeX, ant.probeY);
      if (ant.wantsMove && moved < 4) ant.stuckT = (ant.stuckT || 0) + ant.probeT;
      else ant.stuckT = 0;
      ant.probeX = ant.x; ant.probeY = ant.y; ant.probeT = 0;
      ant.wantsMove = false;

      if (ant.stuckT >= 1.5 && ant.stuckT < 2.3) {
        if (ant.field) w.refreshField(ant.field);
        ant.unstickT = 0.35;
        ant.unstickDir = Math.random() < 0.5 ? -1 : 1;
      } else if (ant.stuckT >= 4) {
        ant.stuckT = 0;
        ant.field = null;
        if (ant.job) { game.releaseJob(ant); }
        if (ant.targetFood) releaseClaim(ant);
        if (!ant.isEnemy && ant.role !== 'queen') { ant.state = 'idle'; ant.t = 0; }
      }
    }
  }

  /** wounded colony members go to the granary and eat */
  function checkHeal(ant, game) {
    if (ant.hp >= ant.maxHp) return false;
    if (game.food < CFG.HEAL_COST) return false;
    if (ant.state === 'toEat' || ant.state === 'toFood' || ant.state === 'toHome' ||
      ant.state === 'fight' || ant.state === 'work') return false;
    if (!game.queen) return false;
    if (ant.job) game.releaseJob(ant);
    ant.state = 'toEat';
    ant.field = game.world.refreshHome();
    return true;
  }

  function updateHealing(ant, game, dt) {
    if (!game.queen) { ant.state = 'idle'; return; }
    var w = game.world;
    if (!w.fieldFresh(ant.field) || ant.field !== w.homeField) ant.field = w.refreshHome();
    if (!follow(ant, game, dt) && U.dist(ant.x, ant.y, game.granary.x, game.granary.y) > 14) return;
    drive(ant, game, 0, dt, 0);
    ant.healT = (ant.healT || 0) + dt;
    if (ant.healT < 0.6) return;              // a mouthful takes a moment
    ant.healT = 0;
    if (game.food >= CFG.HEAL_COST && ant.hp < ant.maxHp) {
      game.food -= CFG.HEAL_COST;
      ant.heal(CFG.HEAL_AMOUNT);
      game.puff(ant.x, ant.y - 2, '#e8b24a', 3);
      game.floatText(ant.x, ant.y - ant.h - 6, '+' + CFG.HEAL_AMOUNT, '#9be86a');
    }
    if (ant.hp >= ant.maxHp || game.food < CFG.HEAL_COST) { ant.state = 'idle'; ant.t = 0; }
  }

  /** stand somewhere useful near the queen for a while */
  function restNearQueen(ant, game, dt) {
    if (!ant.restSpot) ant.restSpot = game.restSpot(ant);
    if (goTo(ant, game, ant.restSpot.x, ant.restSpot.y, dt)) {
      if (Math.random() < dt * 0.3) ant.facing = -ant.facing;
    }
  }

  /* ============================================================
    QUEEN
    ============================================================ */
  function queen(ant, game, dt) {
    var w = game.world;
    if (ant.hurtT > 0) ant.hurtT -= dt;
    if (ant.notice > 0) ant.notice -= dt;
    if (ant.atkCD > 0) ant.atkCD -= dt;
    if (ant.lungeT > 0) ant.lungeT -= dt;
    ant.age = (ant.age || 0) + dt;
    ant.state = 'idle';

    // she bites anything that reaches her
    var foe = game.nearestEnemy(ant.x, ant.y - ant.h / 2, CFG.QUEEN_MELEE + 2);
    if (foe) {
      drive(ant, game, 0, dt, 0);
      bite(ant, foe, game);
      ant.state = 'fight';
    } else {
      // a slow, stately amble along the chamber floor
      if (!ant.room) ant.room = { x: ant.x, r: 2.2 * T8 };
      ant.t2 = (ant.t2 || 0) - dt;
      if (ant.t2 <= 0) {
        ant.t2 = 2.5 + Math.random() * 3;
        ant.goalX = Math.random() < 0.4 ? null : ant.room.x + (Math.random() * 2 - 1) * ant.room.r;
      }
      var dir = 0;
      if (ant.goalX != null) {
        var dx = ant.goalX - ant.x;
        dir = Math.abs(dx) < 1 ? 0 : U.sign(dx);
        if (dir === 0) ant.goalX = null;
      }
      drive(ant, game, dir, dt, 0);
      if (ant.hitX) ant.goalX = null;
    }

    // drowning hurts her badly
    if (w.waterAtPx(ant.x, ant.y - 4) >= CFG.DROWN_AMOUNT + 1) ant.hurt(1.2 * dt);

    // laying
    if (!game.layPromptOpen) game.layTimer -= dt;
    if (game.layTimer <= 0 && !game.gameOver) {
      if (game.food >= CFG.EGG_COST && game.eggs.length < 6) {
        game.openLayPrompt(ant);
      } else {
        game.layTimer = 1.5;
        if (game.food < CFG.EGG_COST) ant.notice = 0.5;
      }
    }
  }

  /* ============================================================
    GATHERER
    ============================================================ */
  function gatherer(ant, game, dt) {
    if (checkHeal(ant, game)) return;
    var w = game.world;

    switch (ant.state) {
      case 'toEat': updateHealing(ant, game, dt); return;

      case 'idle': {
        if (ant.carry > 0) { ant.state = 'toHome'; ant.field = w.refreshHome(); break; }
        var f = claimFood(ant, game);
        if (f) { ant.state = 'toFood'; ant.targetFood = f; ant.jobT = 0; break; }
        var ent = game.entranceSpot();
        if (ent && canReach(ant, game, ent.x, ent.y)) {
          ant.state = 'out'; ant.t = 30;
          break;
        }
        ant.state = 'rest'; ant.t = 2 + Math.random() * 2; ant.restSpot = null;
        break;
      }

      case 'out': {
        // head up and out of the nest mouth
        var f2 = claimFood(ant, game);
        if (f2) { ant.state = 'toFood'; ant.targetFood = f2; ant.jobT = 0; break; }
        var e2 = game.entranceSpot();
        if (!e2 || ant.t <= 0) { ant.state = 'idle'; break; }
        if (goTo(ant, game, e2.x, e2.y, dt)) {
          ant.state = 'surface';
          ant.t = 4 + Math.random() * 5;
          ant.anchorX = ant.x;
          ant.field = null;
        }
        return;
      }

      case 'surface':
        if (ant.t <= 0) { ant.state = 'idle'; break; }
        if (claimFood(ant, game)) { releaseClaim(ant); ant.state = 'idle'; break; }
        idleWander(ant, game, dt, ant.anchorX, 5 * T8);
        return;

      case 'rest':
        if (ant.t <= 0) { ant.state = 'idle'; ant.restSpot = null; break; }
        restNearQueen(ant, game, dt);
        return;

      case 'toFood': {
        var tf = ant.targetFood;
        if (!tf || tf.dead) { releaseClaim(ant); ant.state = 'idle'; break; }
        ant.jobT += dt;
        var ftx = Math.floor(tf.x / T8), fty = Math.floor((tf.y - 2) / T8);
        // give up on food the colony cannot reach, rather than grinding at it
        if (!canReach(ant, game, ftx, fty) || ant.jobT > 40) {
          releaseClaim(ant);
          tf.unreachable = (tf.unreachable || 0) + 1;
          ant.state = 'idle'; ant.t = 0;
          break;
        }
        var there = goTo(ant, game, ftx, fty, dt);
        if (there || U.dist(ant.x, ant.y - 2, tf.x, tf.y - 2) < 8) {
          tf.dead = true;
          ant.carry = tf.art.food;
          ant.carryKind = tf.art.mat;
          ant.carryArt = tf.kind;
          releaseClaim(ant);
          ant.state = 'toHome';
          ant.field = w.refreshHome();
        }
        return;
      }

      case 'toHome': {
        if (!w.fieldFresh(ant.field) || ant.field !== w.homeField) ant.field = w.refreshHome();
        var arrived = follow(ant, game, dt);
        if (arrived || U.dist(ant.x, ant.y, game.granary.x, game.granary.y) < 12 ||
          (game.queen && U.dist(ant.x, ant.y, game.queen.x, game.queen.y) < 12)) {
          if (arrived) drive(ant, game, 0, dt, 0);
          game.deposit(ant);
          ant.state = 'idle';
          ant.t = 0;
        }
        return;
      }

      default:
        ant.state = 'idle';
    }
    drive(ant, game, 0, dt, 0);
  }

  function claimFood(ant, game) {
    var best = null, bd = 1e9;
    var range = 300;
    for (var i = 0; i < game.foods.length; i++) {
      var f = game.foods[i];
      if (f.dead || (f.claimed && f.claimed !== ant.id)) continue;
      if (f.unreachable) continue;
      var d = U.dist(ant.x, ant.y, f.x, f.y);
      if (d > range) continue;
      // settled food is cheaper to reach than food still tumbling down
      var score = f.onGround ? d * 0.65 : d * 1.35;
      if (score < bd) { bd = score; best = f; }
    }
    if (best) best.claimed = ant.id;
    return best;
  }
  function releaseClaim(ant) {
    if (ant.targetFood && ant.targetFood.claimed === ant.id) ant.targetFood.claimed = null;
    ant.targetFood = null;
  }

  /* ============================================================
    BUILDER
    ============================================================ */
  function builder(ant, game, dt) {
    if (checkHeal(ant, game)) return;
    var w = game.world;

    switch (ant.state) {
      case 'toEat': updateHealing(ant, game, dt); return;

      case 'idle': {
        var job = game.claimJob(ant);
        if (!job) {
          // nothing on the board: chew into the nearest reachable dirt so the
          // mine never stops growing just because the director had nothing queued
          var local = game.nearestDig(ant);
          if (local) job = { x: local.x, y: local.y, kind: 'dig', p: 3, by: ant.id, done: false, i: 0, age: 0, cells: null };
        }
        if (job) {
          ant.job = job;
          ant.state = 'toJob';
          ant.jobT = 0;
          break;
        }
        ant.state = 'rest'; ant.t = 1.5 + Math.random() * 2; ant.restSpot = null;
        break;
      }

      case 'rest':
        if (ant.t <= 0) { ant.state = 'idle'; ant.restSpot = null; break; }
        restNearQueen(ant, game, dt);
        return;

      case 'toJob': {
        var job2 = ant.job;
        if (!job2 || job2.done) { ant.job = null; ant.state = 'idle'; break; }
        ant.jobT = (ant.jobT || 0) + dt;
        var ap = game.approachTile(job2.x, job2.y, 1, job2.kind === 'build');
        var here = goTo(ant, game, ap.x, ap.y, dt);
        if (here || U.dist(ant.x, ant.y - ant.h / 2, job2.x * T8 + T8 / 2, job2.y * T8 + T8 / 2) < T8 * 1.6) {
          ant.state = 'work';
          ant.workT = 0;
          break;
        }
        if (ant.jobT > 35 || !canReach(ant, game, ap.x, ap.y)) { game.failJob(ant); ant.state = 'rest'; ant.t = 0.6; ant.restSpot = null; }
        return;
      }

      case 'work': {
        var j = ant.job;
        drive(ant, game, 0, dt, 0);
        if (!j || j.done) { ant.job = null; ant.state = 'idle'; return; }
        if (U.dist(ant.x, ant.y - ant.h / 2, j.x * T8 + T8 / 2, j.y * T8 + T8 / 2) > T8 * 3.1) {
          ant.state = 'toJob'; return;
        }
        ant.facing = U.sign(j.x * T8 + T8 / 2 - ant.x) || ant.facing;
        ant.workT += dt;
        // chipping animation: the jaws work
        ant.animT += dt * 4;
        ant.anim = Math.floor(ant.animT) % PX_ANIM;
        if (Math.random() < dt * 9) game.puff(j.x * T8 + Math.random() * T8, j.y * T8 + Math.random() * T8, '#6b4526', 1);

        if (j.kind === 'dig') {
          if (ant.workT >= CFG.DIG_TIME) {
            if (global.World.isDiggable(w.at(j.x, j.y))) {
              w.set(j.x, j.y, global.T.TUNNEL);
              game.stats.dug++;
              // two tiles tall, so there is head room to walk through
              if (global.World.isDiggable(w.at(j.x, j.y - 1)) && j.y - 1 > w.surface[j.x]) w.set(j.x, j.y - 1, global.T.TUNNEL);
              game.mat.dirt += 1;
              game.puff(j.x * T8 + 4, j.y * T8 + 4, '#7d5430', 5);
            }
            game.completeJob(ant);
          }
        } else if (j.kind === 'clear') {
          if (ant.workT >= CFG.DIG_TIME * 0.8) {
            var i = j.y * w.w + j.x;
            w.sandCount = Math.max(0, w.sandCount - w.sand[i]);
            w.sand[i] = 0;
            game.puff(j.x * T8 + 4, j.y * T8 + 4, '#d8c084', 4);
            game.completeJob(ant);
          }
        } else if (j.kind === 'build') {
          // one unit of material per tile, paid once
          if (!j.paid) j.paid = game.spendFor(j.mat);
          if (j.paid) {
            if (ant.workT >= CFG.BUILD_TIME) {
              // never wall ourselves (or anyone) inside the tile
              if (game.antInTile(j.x, j.y)) { if (ant.workT > 4) game.completeJob(ant); return; }
              if (w.build(j.x, j.y, j.structure)) game.stats.built++;
              game.puff(j.x * T8 + 4, j.y * T8 + 4, j.structure === global.T.THATCH ? '#a8912f' : '#8a6134', 4);
              game.completeJob(ant);
            }
          } else if (ant.workT > 1.2) { game.releaseJob(ant); ant.state = 'idle'; }
        } else if (j.kind === 'repair') {
          if (!j.paid) j.paid = game.spendFor('dirt');
          if (j.paid) {
            if (ant.workT >= CFG.REPAIR_TIME) {
              w.repairStruct(j.x, j.y);
              game.puff(j.x * T8 + 4, j.y * T8 + 4, '#e0d0a0', 3);
              game.completeJob(ant);
            }
          } else if (ant.workT > 1.2) { game.releaseJob(ant); ant.state = 'idle'; }
        } else if (j.kind === 'room') {
          // carve one tile per work cycle, then move to the next
          if (ant.workT >= CFG.DIG_TIME * 0.55) {
            ant.workT = 0;
            var t2 = w.at(j.x, j.y);
            if (global.World.isDiggable(t2)) {
              w.set(j.x, j.y, global.T.TUNNEL);
              game.stats.dug++;
              game.mat.dirt += 1;
            }
            j.i++;
            if (j.i >= j.cells.length) { game.completeJob(ant); return; }
            j.x = j.cells[j.i].x; j.y = j.cells[j.i].y;
          }
        }
        return;
      }

      default:
        ant.state = 'idle';
    }
    drive(ant, game, 0, dt, 0);
  }

  /* ============================================================
    NURSE
    ============================================================ */
  function nurse(ant, game, dt) {
    if (checkHeal(ant, game)) return;

    switch (ant.state) {
      case 'toEat': updateHealing(ant, game, dt); return;

      case 'idle': {
        var e = pickEgg(ant, game);
        if (e) { ant.targetEgg = e; ant.state = 'toEgg'; ant.jobT = 0; }
        else { ant.state = 'rest'; ant.t = 1.5 + Math.random(); ant.restSpot = null; }
        break;
      }

      case 'rest':
        if (ant.t <= 0 || (game.eggs.length && ant.t < 1)) { ant.state = 'idle'; ant.restSpot = null; break; }
        restNearQueen(ant, game, dt);
        return;

      case 'toEgg': {
        var egg = ant.targetEgg;
        if (!egg || egg.dead || game.eggs.indexOf(egg) < 0) { ant.targetEgg = null; ant.state = 'idle'; break; }
        ant.jobT += dt;
        var ex = Math.floor(egg.x / T8), ey = Math.floor((egg.y - 1) / T8);
        var near = U.dist(ant.x, ant.y, egg.x, egg.y) < T8 * (CFG.NURSE_RADIUS - 0.3);
        if (near) drive(ant, game, 0, dt, 0);
        if (near || goTo(ant, game, ex, ey, dt)) { ant.state = 'nurse'; ant.t = 3 + Math.random() * 3; }
        else if (ant.jobT > 25) { ant.state = 'idle'; }
        return;
      }

      case 'nurse': {
        var e2 = ant.targetEgg;
        drive(ant, game, 0, dt, 0);
        if (!e2 || e2.dead || game.eggs.indexOf(e2) < 0) { ant.state = 'idle'; return; }
        if (U.dist(ant.x, ant.y, e2.x, e2.y) > T8 * (CFG.NURSE_RADIUS + 1)) { ant.state = 'toEgg'; return; }
        ant.facing = U.sign(e2.x - ant.x) || ant.facing;
        // every so often, check whether another egg needs us more
        if (ant.t <= 0) { ant.state = 'idle'; }
        return;
      }

      default:
        ant.state = 'idle';
    }
    drive(ant, game, 0, dt, 0);
  }

  function pickEgg(ant, game) {
    var best = null, bs = -1e9;
    for (var i = 0; i < game.eggs.length; i++) {
      var e = game.eggs[i];
      if (e.dead) continue;
      // fewer nurses already on it, and less progress, means more need
      var crowd = 0;
      for (var j = 0; j < game.ants.length; j++) {
        var a = game.ants[j];
        if (a !== ant && a.role === 'nurse' && a.targetEgg === e) crowd++;
      }
      var score = (1 - e.progress) * 60 - crowd * 40 - U.dist(ant.x, ant.y, e.x, e.y) * 0.2;
      if (score > bs) { bs = score; best = e; }
    }
    return best;
  }

  /* ============================================================
    ARMY
    ============================================================ */
  function army(ant, game, dt) {
    var foe = (ant.target && !ant.target.dead && centreDist(ant, ant.target) < 150) ? ant.target
      : game.nearestEnemy(ant.x, ant.y, 100);
    if (foe) {
      if (ant.state !== 'fight') { ant.notice = 0.5; if (ant.job) game.releaseJob(ant); }
      ant.state = 'fight';
      ant.target = foe;
    } else if (ant.state === 'fight') {
      ant.state = 'idle'; ant.target = null; ant.field = null;
    }

    if (ant.state !== 'fight' && checkHeal(ant, game)) return;

    switch (ant.state) {
      case 'toEat': updateHealing(ant, game, dt); return;

      case 'fight':
        if (closeIn(ant, game, foe, dt, CFG.MELEE_RANGE)) bite(ant, foe, game);
        return;

      case 'idle':
        ant.patrol = game.patrolSpot(ant);
        ant.state = 'patrol';
        ant.t = 20;
        break;

      case 'patrol':
        if (!ant.patrol || ant.t <= 0) { ant.state = 'idle'; break; }
        if (goTo(ant, game, ant.patrol.x, ant.patrol.y, dt)) { ant.state = 'guard'; ant.t = 3 + Math.random() * 4; }
        return;

      case 'guard':
        // stand watch, looking one way and then the other
        drive(ant, game, 0, dt, 0);
        if (Math.random() < dt * 0.5) ant.facing = -ant.facing;
        if (ant.t <= 0) ant.state = 'idle';
        return;

      default:
        ant.state = 'idle';
    }
    drive(ant, game, 0, dt, 0);
  }

  /* ============================================================
    DEFEND: the player's call to arms
    ============================================================ */
  function defend(ant, game, dt) {
    var q = game.queen;
    if (!q) return false;
    if (ant.state !== 'defend') {
      if (ant.job) game.releaseJob(ant);
      if (ant.targetFood) releaseClaim(ant);
      ant.targetEgg = null;
      ant.state = 'defend';
      ant.field = null;
      ant.guard = game.guardSpot(ant);
    }
    // Soldiers sally out to meet raiders on the approach; workers hold the
    // ring and only take on what reaches the queen (or bites them).
    var soldier = ant.role === 'army';
    var reach = soldier ? 16 * T8 : 7 * T8;
    var foe = (ant.target && !ant.target.dead && U.dist(ant.target.x, ant.target.y, q.x, q.y) < reach + T8) ? ant.target
      : (soldier ? game.nearestEnemy(ant.x, ant.y, 120) : game.nearestEnemy(q.x, q.y - q.h / 2, reach));
    if (!foe) foe = game.nearestEnemy(ant.x, ant.y - ant.h / 2, CFG.MELEE_RANGE + 1);
    if (foe && (U.dist(foe.x, foe.y, q.x, q.y) < reach || centreDist(ant, foe) <= CFG.MELEE_RANGE + 1)) {
      ant.target = foe;
      if (closeIn(ant, game, foe, dt, CFG.MELEE_RANGE)) bite(ant, foe, game);
      return true;
    }
    ant.target = null;
    if (!ant.guard) ant.guard = game.guardSpot(ant);
    if (goTo(ant, game, ant.guard.x, ant.guard.y, dt)) {
      // face outward from the queen, ready
      ant.facing = U.sign(ant.x - q.x) || ant.facing;
    }
    return true;
  }

  /* ============================================================
    ENEMIES
    ============================================================ */
  function enemyCommon(ant, game, dt) {
    commonTick(ant, game, dt);
    if (ant.dead) return false;
    // raiders that never get in give up and leave, so a losing colony is not
    // slowly buried under an ever-growing pile of them
    ant.lifeT = (ant.lifeT || 0) + dt;
    if (ant.lifeT > 90) { ant.dead = true; ant.left = true; return false; }
    return true;
  }

  /** bite whatever colony ant (or the queen) is in reach; true if it did */
  function enemyMelee(ant, game, dt) {
    var q = game.queen;
    if (q && !q.dead && centreDist(ant, q) <= CFG.QUEEN_MELEE) {
      drive(ant, game, 0, dt, 0);
      bite(ant, q, game);
      ant.state = 'fight';
      return true;
    }
    var foe = game.nearestColonyAnt(ant, CFG.MELEE_RANGE + 1);
    if (foe) {
      drive(ant, game, 0, dt, 0);
      bite(ant, foe, game);
      ant.state = 'fight';
      return true;
    }
    return false;
  }

  /** walls in the way get chewed (brutes smash harder) */
  function chewWall(ant, game) {
    if (ant.atkCD > 0) return false;
    var w = game.world, tx = ant.tileX(), ty = ant.tileY();
    var cand = [[tx + ant.facing, ty], [tx - ant.facing, ty], [tx, ty + 1], [tx, ty - 1], [tx + ant.facing, ty - 1]];
    for (var i = 0; i < cand.length; i++) {
      var c = cand[i];
      if (!global.World.isStructure(w.at(c[0], c[1]))) continue;
      ant.atkCD = CFG.ATTACK_INTERVAL;
      ant.lungeT = 0.14;
      var dmg = ant.role === 'brute' ? CFG.BRUTE_SMASH : CFG.STRUCT_BITE;
      var gone = w.damageStruct(c[0], c[1], dmg);
      game.puff(c[0] * T8 + 4, c[1] * T8 + 4, '#8a6134', gone ? 8 : 3);
      return true;
    }
    return false;
  }

  /** march on the queen by the home field; when walled out, push and chew */
  function marchOnQueen(ant, game, dt) {
    var w = game.world, q = game.queen;
    ant.state = 'march';
    if (!q) { idleWander(ant, game, dt); return; }
    if (!w.fieldFresh(ant.field) || ant.field !== w.homeField) ant.field = w.refreshHome();
    var d = w.distAt(ant.field, ant.tileX(), ant.tileY());
    if (d === 0xFFFF || (ant.stuckT || 0) > 1) {
      // no open way in: walk at her and chew through whatever is in the way
      drive(ant, game, U.sign(q.x - ant.x), dt, 0);
      chewWall(ant, game);
      return;
    }
    if (follow(ant, game, dt)) drive(ant, game, U.sign(q.x - ant.x), dt, 0);
  }

  function raiderAI(ant, game, dt) {
    if (!enemyCommon(ant, game, dt)) return;
    if (enemyMelee(ant, game, dt)) return;
    if (ant.role === 'brute' && (ant.stuckT || 0) > 0.5) chewWall(ant, game);
    marchOnQueen(ant, game, dt);
  }

  function thiefAI(ant, game, dt) {
    if (!enemyCommon(ant, game, dt)) return;
    var w = game.world;

    if (ant.state === 'flee') {
      // out by the colony's own way, then gone
      ant.fleeT = (ant.fleeT || 0) + dt;
      if (ant.y < game.surfaceY(ant.tileX()) * T8 + 1) { ant.dead = true; ant.left = true; return; }
      var ent = game.entranceSpot();
      if (ent && goTo(ant, game, ent.x, ent.y, dt)) { ant.dead = true; ant.left = true; return; }
      if (!ent) idleWander(ant, game, dt);
      if (ant.fleeT > 25) { ant.dead = true; ant.left = true; }
      return;
    }

    // cornered thieves bite back
    if (enemyMelee(ant, game, dt)) return;

    var gx = game.granary.x, gy = game.granary.y;
    if (game.queen && U.dist(ant.x, ant.y, gx, gy) < 14) {
      drive(ant, game, 0, dt, 0);
      var got = game.stealFood(Math.min(14, game.food));
      ant.carry = got;
      ant.carryArt = 'seed';
      ant.state = 'flee';
      ant.notice = 1.2;
      ant.field = null;
      if (got > 0) game.floatText(gx, gy - 12, '-' + got + ' FOOD', '#ff8a6a');
      return;
    }
    if (!game.queen) { idleWander(ant, game, dt); return; }
    if (goTo(ant, game, Math.floor(gx / T8), Math.floor((gy - 1) / T8), dt)) {
      drive(ant, game, U.sign(gx - ant.x), dt, 0);
    }
    ant.state = 'sneak';
  }

  /* ============================================================
    dispatch
    ============================================================ */
  var BRAIN = {
    queen: queen,
    gatherer: gatherer,
    builder: builder,
    nurse: nurse,
    army: army,
    raider: raiderAI,
    thief: thiefAI,
    brute: raiderAI
  };

  function updateAnt(ant, game, dt) {
    if (ant.role === 'queen') { queen(ant, game, dt); return; }
    if (ant.isEnemy) { BRAIN[ant.role](ant, game, dt); return; }

    commonTick(ant, game, dt);
    if (ant.dead) return;
    // the player's call to arms overrides every errand
    if (game.defending) { defend(ant, game, dt); return; }
    if (ant.state === 'defend') { ant.state = 'idle'; ant.field = null; ant.target = null; }
    // anyone a raider is chewing on bites back
    if (ant.role !== 'army' && selfDefense(ant, game, dt)) return;
    var fn = BRAIN[ant.role];
    if (fn) fn(ant, game, dt);
  }

  global.AntAI = {
    update: updateAnt, follow: follow, drive: drive, goTo: goTo,
    claimFood: claimFood, pickStep: pickStep, bite: bite
  };
})(window);
