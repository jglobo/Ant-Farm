/* ============================================================
  entities.js  actors, ants, eggs, food items, particles
  ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG, U = global.U, PX = global.PX, T8 = CFG.TILE;

  function approach(cur, target, step) {
    if (cur < target) return Math.min(cur + step, target);
    if (cur > target) return Math.max(cur - step, target);
    return target;
  }

  /* ============================================================
    Actor  AABB vs tile world
    x = centre, y = feet
    ============================================================ */
  function Actor(x, y, w, h) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.w = w; this.h = h;
    this.facing = 1;
    this.onGround = false;
    this.hitX = false; this.hitY = false;
    this.anim = 0;
    this.dead = false;
    this.hurtT = 0;
  }
  var Ap = Actor.prototype;

  Ap.box = function () {
    return { l: this.x - this.w / 2, r: this.x + this.w / 2, t: this.y - this.h, b: this.y };
  };

  Ap.moveX = function (world, dx) {
    this.hitX = false;
    this.x += dx;
    if (dx === 0) return;
    var l = this.x - this.w / 2, r = this.x + this.w / 2;
    var ty0 = Math.floor((this.y - this.h + 0.01) / T8), ty1 = Math.floor((this.y - 0.01) / T8);
    var tx0 = Math.floor(l / T8), tx1 = Math.floor((r - 0.01) / T8);
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        if (!world.solidAt(tx, ty)) continue;
        if (dx > 0) { this.x = tx * T8 - this.w / 2 - 0.01; this.hitX = true; this.hitDir = 1; }
        // outside the wall, not 0.01px inside it: inside, the next small step
        // right "collides" with this same tile and snaps clean through it
        else { this.x = (tx + 1) * T8 + this.w / 2 + 0.01; this.hitX = true; this.hitDir = -1; }
        l = this.x - this.w / 2; r = this.x + this.w / 2;
      }
    }
    // tiles outside the world read as solid, so clamp explicitly or an actor
    // can be shoved clean off the map and never path anywhere again
    var half = this.w / 2 + 0.5;
    this.x = U.clamp(this.x, half, world.w * T8 - half);
  };

  Ap.moveY = function (world, dy) {
    this.hitY = false;
    this.y += dy;
    this.onGround = false;
    // Inset well past moveX's 0.01 wall clearance. Ants are exactly one tile
    // wide, so an ant pushed flush against a wall must read as inside its own
    // column; otherwise it perches on a hair of the next ledge and can never
    // drop into a one-tile shaft.
    var l = this.x - this.w / 2 + 0.05, r = this.x + this.w / 2 - 0.05;
    var ty0 = Math.floor((this.y - this.h) / T8), ty1 = Math.floor((this.y - 0.01) / T8);
    var tx0 = Math.floor(l / T8), tx1 = Math.floor(r / T8);
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        if (!world.solidAt(tx, ty)) continue;
        if (dy > 0) { this.y = ty * T8 - 0.01; this.onGround = true; this.hitY = true; this.hitDir = 1; }
        else if (dy < 0) { this.y = (ty + 1) * T8 + this.h + 0.01; this.hitY = true; this.hitDir = -1; }
      }
    }
    this.y = U.clamp(this.y, 0, world.h * T8 + 64);
  };

  /** which side (-1 / 1) has a wall within reach to climb; 0 if neither */
  Ap.wallSide = function (world) {
    var reach = this.w / 2 + 1.2;
    // The feet sample sits on the same line tileY() uses, so the ant keeps its
    // grip right up to the moment it counts as having reached the next cell.
    // (Sampling a pixel higher let go a pixel early, and it slid back forever.)
    // The top sample reaches above the head, matching the move graph's grip on
    // a wall diagonally above the cell.
    var ys = [this.y - 0.01, this.y - this.h / 2, this.y - this.h + 1, this.y - this.h - 2.5];
    var r = false, l = false;
    for (var i = 0; i < ys.length; i++) {
      if (world.solidPx(this.x + reach, ys[i])) r = true;
      if (world.solidPx(this.x - reach, ys[i])) l = true;
    }
    if (r && l) return this.facing >= 0 ? 1 : -1;
    return r ? 1 : l ? -1 : 0;
  };

  /**
   * Vertical motion. `climb` is -1 (up), 1 (down) or 0: an ant asked to climb
   * that has a wall beside it goes at a steady pace with no gravity; anything
   * else falls.
   */
  Ap.physics = function (world, dt, inWater, climb, climbSpeed) {
    var side = climb ? this.wallSide(world) : 0;
    if (side) {
      this.clinging = side;
      this.climbDir = climb;
      this.vy = climb * climbSpeed;
      this.moveY(world, this.vy * dt);
      return;
    }
    this.clinging = 0;
    this.vy += CFG.G * dt;
    if (this.vy > CFG.MAX_FALL) this.vy = CFG.MAX_FALL;
    if (inWater) this.vy = Math.min(this.vy, 45);
    this.moveY(world, this.vy * dt);
  };

  /* ============================================================
    Ant
    ============================================================ */
  function Ant(x, y, roleKey) {
    var def = CFG.ROLE[roleKey];
    // collide as a box a little narrower than a tile, whatever the sprite size
    Actor.call(this, x, y, def.cw || CFG.CW, def.ch || CFG.CH);
    this.role = roleKey;
    this.def = def;
    this.hp = def.hp; this.maxHp = def.hp;
    this.speed = def.speed;
    this.atk = def.atk;
    this.atkCD = Math.random() * 0.5;   // bite cooldown
    this.lungeT = 0;
    this.clinging = 0;
    this.isEnemy = !!def.enemy;
    this.state = 'idle';
    this.t = 0;
    this.carry = 0;          // food carried
    this.carryKind = null;   // 'leaf' | 'twig' | 'crumb'
    this.target = null;      // {x,y} tile
    this.goal = null;        // {x,y} world px
    this.field = null;
    this.job = null;
    this.animT = 0;
    this.attackT = 0;
    this.homeFood = 0;
    this.claim = null;
    this.think = Math.random() * 0.4;
    this.stuckT = 0;
    this.lastX = x; this.lastY = y;
    this.idleSeed = Math.random() * 1000;
    this.notice = 0;          // alert bubble timer
    this.healT = 0;
  }
  Ant.prototype = Object.create(Actor.prototype);
  Ant.prototype.constructor = Ant;

  /* An ant's body occupies exactly one open cell, resting on the solid tile
    below it. Feet sit at (cellRow + 1) * TILE - 0.01, so the cell it is in is
    floor((y - 0.01) / TILE) -- not floor(y / TILE), which reports the floor
    tile the moment an ant is standing exactly on a tile boundary. */
  Ant.prototype.tileX = function () { return Math.floor(this.x / T8); };
  Ant.prototype.tileY = function () { return Math.floor((this.y - 0.01) / T8); };

  Ant.prototype.hurt = function (dmg, src) {
    if (this.dead) return;
    this.hp -= dmg;
    this.hurtT = 0.22;
    if (src) this.facing = src.x < this.x ? 1 : -1;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
  };

  Ant.prototype.heal = function (amt) {
    this.hp = Math.min(this.maxHp, this.hp + amt);
  };

  Ant.prototype.centerX = function () { return this.x; };
  Ant.prototype.centerY = function () { return this.y - this.h / 2; };

  /* ============================================================
    Egg
    ============================================================ */
  function Egg(x, y, role) {
    this.x = x; this.y = y;
    this.role = role;
    this.t = 0;
    this.progress = 0;
    this.nurses = 0;
    this.dead = false;
    this.wobble = Math.random() * 6.28;
  }
  Egg.prototype.update = function (dt, nurses) {
    this.wobble += dt * 2;
    this.nurses = nurses;
    var cut = U.clamp(nurses * CFG.HATCH_PER_NURSE, 0, CFG.HATCH_MAX_CUT);
    this.progress += dt / CFG.HATCH_BASE * (1 - cut);
    return this.progress >= 1;
  };
  Egg.prototype.draw = function (ctx, t) {
    var w = 5, h = 5 + Math.round(this.progress * 3);
    var x = Math.round(this.x - w / 2), y = Math.round(this.y - h);
    var shake = this.nurses > 0 ? Math.round(Math.sin(this.wobble * 3) * 0.5) : 0;
    x += shake;
    PX.rect(ctx, x, y, w, h, '#cfc4a8');
    PX.rect(ctx, x + 1, y + 1, w - 2, h - 2, '#f3ead2');
    PX.rect(ctx, x + 1, y + 1, w - 2, 1, '#ffffff');
    if (this.progress > 0.35) {
      PX.rect(ctx, x + 1, y + 2, 1, 1, '#a89878');
      PX.rect(ctx, x + 3, y + 3, 1, 1, '#a89878');
    }
    if (this.progress > 0.7) {
      PX.rect(ctx, x + 2, y + 2, 1, 1, '#6b5c44');
      PX.rect(ctx, x + 2, y + 4, 1, 1, '#6b5c44');
    }
    if (this.nurses > 0) {
      ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t * 6);
      PX.rect(ctx, x - 1, y - 1, w + 2, h + 2, '#8fd85f');
      ctx.globalAlpha = 1;
    }
  };

  /* ============================================================
    FoodItem  surface debris, falling leaves, twigs, crumbs
    ============================================================ */
  var FOOD_ART = {
    leaf:    { w: 6, h: 5, food: 4, mat: 'leaf' },
    bigleaf: { w: 8, h: 6, food: 8, mat: 'leaf' },
    twig:    { w: 7, h: 3, food: 2, mat: 'twig' },
    crumb:   { w: 4, h: 4, food: 4, mat: null },
    seed:    { w: 4, h: 4, food: 6, mat: null },
    feather: { w: 6, h: 4, food: 2, mat: 'twig' },
    berry:   { w: 4, h: 4, food: 6, mat: null }
  };

  function FoodItem(x, y, kind) {
    this.kind = kind;
    this.art = FOOD_ART[kind] || FOOD_ART.crumb;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.w = this.art.w; this.h = this.art.h;
    this.onGround = false;
    this.dead = false;
    this.claimed = null;
    this.age = 0;
    this.spin = Math.random() * 6.28;
    this.settled = false;
    this.bob = 0;
  }
  FoodItem.prototype = Object.create(Actor.prototype);
  FoodItem.prototype.constructor = FoodItem;

  FoodItem.prototype.update = function (world, dt, wind) {
    this.age += dt;
    this.spin += dt * 2;

    // leaves flutter down slowly and drift with the wind
    if (this.kind === 'leaf' || this.kind === 'bigleaf' || this.kind === 'feather') {
      this.vy = Math.min(this.vy + 180 * dt, 34);
      this.vx += (wind * 14 + Math.sin(this.spin) * 16) * dt;
      this.vx = U.clamp(this.vx, -22, 22);
      this.vy += Math.sin(this.spin * 1.7) * 10 * dt;
    } else {
      this.vy += CFG.G * dt;
      if (this.vy > CFG.MAX_FALL) this.vy = CFG.MAX_FALL;
      this.vx *= 0.985;
    }

    this.moveX(world, this.vx * dt);
    this.moveY(world, this.vy * dt);

    if (this.onGround) {
      this.vx *= 0.82;
      this.bob = Math.sin(this.age * 2.2) * 0.5;
    }
    // washed away / submerged for long
    if (world.waterAtPx(this.x, this.y - 2) >= 5) this.dead = true;
  };

  FoodItem.prototype.draw = function (ctx, t) {
    var x = Math.round(this.x - this.w / 2), y = Math.round(this.y - this.h + (this.onGround ? this.bob : 0));
    var g = ctx;
    switch (this.kind) {
      case 'leaf': case 'bigleaf':
        g.fillStyle = '#2f6b23'; g.fillRect(x, y + 1, this.w, this.h - 2);
        g.fillStyle = '#4f9a35'; g.fillRect(x + 1, y, this.w - 2, this.h - 1);
        g.fillStyle = '#79cf4a'; g.fillRect(x + 1, y + 1, this.w - 3, 1);
        g.fillStyle = '#2c5a1c'; g.fillRect(x + 2, y + 2, 1, this.h - 3);
        g.fillRect(x + 4, y + 2, 1, this.h - 3);
        break;
      case 'twig':
        g.fillStyle = '#6b4a26'; g.fillRect(x, y + 1, this.w, 1);
        g.fillStyle = '#8a6134'; g.fillRect(x + 1, y, this.w - 2, 1);
        g.fillStyle = '#54381d'; g.fillRect(x + 3, y + 2, 1, 1);
        break;
      case 'feather':
        g.fillStyle = '#b8b2a6'; g.fillRect(x, y, this.w, this.h);
        g.fillStyle = '#e2ddd2'; g.fillRect(x + 1, y, this.w - 2, 2);
        g.fillStyle = '#8a8478'; g.fillRect(x, y + 3, this.w, 1);
        break;
      case 'seed':
        g.fillStyle = '#a8813f'; g.fillRect(x, y + 1, this.w, this.h - 1);
        g.fillStyle = '#d4ab63'; g.fillRect(x + 1, y + 1, this.w - 2, 1);
        break;
      case 'berry':
        g.fillStyle = '#8a2438'; g.fillRect(x, y, this.w, this.h);
        g.fillStyle = '#c8385a'; g.fillRect(x + 1, y + 1, 2, 2);
        g.fillStyle = '#5e1626'; g.fillRect(x + 1, y + 3, 2, 1);
        break;
      default: // crumb
        g.fillStyle = '#b08a4c'; g.fillRect(x, y, this.w, this.h);
        g.fillStyle = '#d4b478'; g.fillRect(x, y, this.w - 1, 1);
        g.fillStyle = '#8a6a34'; g.fillRect(x + 1, y + 2, 2, 1);
    }
    // sparkle when unclaimed and fresh
    if (!this.claimed && this.age < 2) {
      var a = 0.35 + 0.35 * Math.sin(t * 5 + this.spin);
      ctx.globalAlpha = a;
      PX.rect(ctx, x - 1, y - 2, 1, 1, '#ffe9a8');
      ctx.globalAlpha = 1;
    }
  };

  /* ============================================================
    Particle
    ============================================================ */
  function Particle(x, y, vx, vy, life, color, grav, size) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.color = color;
    this.grav = grav == null ? 300 : grav;
    this.size = size || 1;
    this.dead = false;
  }
  Particle.prototype.update = function (dt) {
    this.vy += this.grav * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  };
  Particle.prototype.draw = function (ctx) {
    var a = U.clamp(this.life / this.maxLife, 0, 1);
    ctx.globalAlpha = a;
    PX.rect(ctx, Math.round(this.x), Math.round(this.y), this.size, this.size, this.color);
    ctx.globalAlpha = 1;
  };

  /* ============================================================
    Ant rendering
    ============================================================ */
  Ant.prototype.draw = function (ctx, t, camX, camY) {
    var spr, dx, dy;
    var lunge = this.lungeT > 0 ? this.facing : 0;
    if (this.clinging) {
      // on a wall: turned a quarter so the feet grip it
      spr = PX.antClimbSprite(this.role, this.anim, this.clinging, this.climbDir || -1);
      dx = this.clinging > 0 ? Math.round(this.x + this.w / 2 + 1 - spr.width - camX)
                             : Math.round(this.x - this.w / 2 - 1 - camX);
      dy = Math.round(this.y - this.h / 2 - spr.height / 2 - camY);
    } else {
      spr = PX.antSprite(this.role, this.anim, this.facing);
      dx = Math.round(this.x - spr.width / 2 - camX) + lunge;
      dy = Math.round(this.y - camY) - spr.height;
      // contact shadow
      if (this.onGround) {
        ctx.globalAlpha = 0.28;
        PX.rect(ctx, Math.round(this.x - spr.width / 2 + 2 - camX), Math.round(this.y - camY) - 1, spr.width - 4, 1, '#000000');
        ctx.globalAlpha = 1;
      }
    }

    ctx.drawImage(spr, dx, dy);
    if (this.hurtT > 0) {
      // hit flash: a white silhouette over the sprite, fading out
      ctx.globalAlpha = Math.min(1, this.hurtT * 4.5);
      ctx.drawImage(PX.flashOf(spr), dx, dy);
      ctx.globalAlpha = 1;
    }

    // carried item, held in the jaws
    if (this.carry > 0 && !this.clinging && spr.meta) {
      var cx2 = dx + spr.meta.mouthX - (this.facing > 0 ? 0 : 3);
      var cy2 = dy + spr.meta.mouthY - 2;
      if (this.carryKind === 'twig') {
        PX.rect(ctx, cx2, cy2 + 1, 4, 1, '#8a6134');
        PX.rect(ctx, cx2 + 1, cy2, 1, 1, '#6b4a26');
      } else if (this.carryArt === 'berry') {
        PX.rect(ctx, cx2, cy2, 3, 3, '#a82c48');
        PX.rect(ctx, cx2, cy2, 1, 1, '#e86080');
      } else if (this.carryArt === 'seed' || this.carryArt === 'crumb') {
        PX.rect(ctx, cx2, cy2, 3, 2, '#c8a25a');
        PX.rect(ctx, cx2, cy2, 2, 1, '#ead090');
      } else {
        PX.rect(ctx, cx2, cy2, 3, 2, '#4f9a35');
        PX.rect(ctx, cx2, cy2, 2, 1, '#79cf4a');
      }
    }
    // eating
    if (this.state === 'toEat' && this.hp < this.maxHp) {
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t * 8);
      PX.rect(ctx, dx + Math.floor(spr.width / 2), dy - 2, 1, 1, '#e8b24a');
      ctx.globalAlpha = 1;
    }
    // alert bubble: a tiny "!" over the head
    if (this.notice > 0) {
      var bx = Math.round(this.x - camX), by = dy - 6;
      ctx.globalAlpha = U.clamp(this.notice * 2, 0, 1);
      PX.rect(ctx, bx - 1, by - 1, 3, 6, 'rgba(10,6,4,.6)');
      PX.rect(ctx, bx, by, 1, 3, this.isEnemy ? '#ff7a5a' : '#ffe9a8');
      PX.rect(ctx, bx, by + 4, 1, 1, this.isEnemy ? '#ff7a5a' : '#ffe9a8');
      ctx.globalAlpha = 1;
    }
    this._drawTop = dy;
  };

  Ant.prototype.drawOverlay = function (ctx, t, camX, camY) {
    if (this.hp >= this.maxHp || this.role === 'queen') return;
    var x = Math.round(this.x - 5 - camX);
    var y = (this._drawTop != null ? this._drawTop : Math.round(this.y - this.h - camY)) - 3;
    PX.hpBar(ctx, x, y, 10, this.hp / this.maxHp, this.isEnemy ? '#ff5c4a' : '#7cc04a');
  };

  /* ============================================================
    FloatText  damage numbers and little callouts that drift up
    ============================================================ */
  function FloatText(x, y, text, color) {
    this.x = x; this.y = y; this.text = String(text); this.color = color || '#ffffff';
    this.vy = -16; this.life = 0.9; this.maxLife = 0.9; this.dead = false;
  }
  FloatText.prototype.update = function (dt) {
    this.y += this.vy * dt;
    this.vy *= 0.94;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  };
  FloatText.prototype.draw = function (ctx) {
    ctx.globalAlpha = U.clamp(this.life / this.maxLife * 1.6, 0, 1);
    PX.text(ctx, this.text, Math.round(this.x), Math.round(this.y), this.color, { align: 'center', shadow: '#0a0604' });
    ctx.globalAlpha = 1;
  };


  global.Actor = Actor;
  global.Ant = Ant;
  global.Egg = Egg;
  global.FoodItem = FoodItem;
  global.Particle = Particle;
  global.FloatText = FloatText;
  global.FOOD_ART = FOOD_ART;
  global.approach = approach;
})(window);
