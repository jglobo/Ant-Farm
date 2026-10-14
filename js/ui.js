/* ============================================================
  ui.js  DOM chrome: HUD, banner, toasts, tooltips, panels, menus
  ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG, PX = global.PX;
  var $ = function (id) { return document.getElementById(id); };

  function UI(game) {
    this.game = game;
    this.el = {
      canvas: $('game'),
      hud: $('hud'), dock: $('dock'), title: $('title'),
      food: $('s-food'), eggs: $('s-eggs'), qhp: $('s-qhp'),
      g: $('s-gatherer'), b: $('s-builder'), n: $('s-nurse'), a: $('s-army'), e: $('s-enemy'),
      clock: $('s-clock'), next: $('s-next'),
      banner: $('banner'), bTitle: $('banner-title'), bSub: $('banner-sub'),
      toast: $('toast'), hint: $('hint'), tip: $('tip'),
      lay: $('lay'), pause: $('pause'), over: $('over'), inspect: $('inspect'),
      iName: $('i-name'), iBody: $('i-body'),
      bPause: $('b-pause'), bSpeed: $('b-speed'), bFollow: $('b-follow'), bLayers: $('b-layers'), bDefend: $('b-defend'),
      zoom: $('zoom-label'),
      seed: $('t-seed'), stage: $('stage')
    };
    this.canvas = this.el.canvas;
    this.bannerT = 0;
    this.toastT = 0;
    this.toastMsg = '';
    this.scale = 1;
    this.page = null;
    this.indexTab = 'ants';
    this.tipHtml = '';
    this.domTip = null;            // a HUD/dock element under the pointer
    this.overShown = false;
    this.iconCache = {};
    this.bind();
    this.resize();
    this.paintLayIcons();
  }
  var P = UI.prototype;

  /* ---------------- scaling ---------------- */
  P.resize = function () {
    var pad = 44;
    var maxW = Math.max(320, (global.innerWidth || 1280) - pad);
    var maxH = Math.max(200, (global.innerHeight || 800) - pad);
    var s = Math.min(maxW / CFG.VIEW_W, maxH / CFG.VIEW_H);
    s = s >= 1 ? Math.floor(s) : 1;
    if (s * CFG.VIEW_W > maxW || s * CFG.VIEW_H > maxH) s = Math.max(1, s - 1);
    this.scale = s;
    this.el.stage.style.width = (CFG.VIEW_W * s) + 'px';
    this.el.stage.style.height = (CFG.VIEW_H * s) + 'px';
    this.canvas.style.width = (CFG.VIEW_W * s) + 'px';
    this.canvas.style.height = (CFG.VIEW_H * s) + 'px';
    // all the chrome is sized in em from this one figure
    var fs = Math.max(11, Math.min(20, Math.round(7 + 3.5 * s)));
    this.el.stage.style.fontSize = fs + 'px';
  };

  /** client-space point -> the canvas's internal pixel space */
  P.toLocal = function (clientX, clientY) {
    var r = this.el.canvas.getBoundingClientRect();
    if (!r || !r.width || !r.height) return { x: 0, y: 0 };
    return {
      x: (clientX - r.left) / r.width * CFG.VIEW_W,
      y: (clientY - r.top) / r.height * CFG.VIEW_H
    };
  };

  /* ---------------- bindings ---------------- */
  P.bind = function () {
    var self = this, g = this.game;

    global.addEventListener('resize', function () { self.resize(); });

    $('begin').addEventListener('click', function () { g.startFromTitle(); });

    this.el.dock.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'pause') g.setPaused(true, 'menu');
      else if (act === 'speed') g.cycleSpeed();
      else if (act === 'zoom-in') g.zoomStep(1);
      else if (act === 'zoom-out') g.zoomStep(-1);
      else if (act === 'follow') g.snapToQueen();
      else if (act === 'defend') g.toggleDefend();
      else if (act === 'layers') g.cycleOverlay();
      else if (act === 'index') g.setPaused(true, 'index');
    });

    this.el.lay.addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('[data-lay]') : null;
      if (c) { g.chooseLay(c.getAttribute('data-lay')); return; }
      if (e.target.getAttribute('data-act') === 'wait') g.chooseLay(null);
    });

    this.el.pause.addEventListener('click', function (e) {
      var tab = e.target.closest ? e.target.closest('[data-tab]') : null;
      if (tab) { self.indexTab = tab.getAttribute('data-tab'); self.renderIndex(); return; }
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'resume') g.setPaused(false);
      else if (act === 'index') self.showPage('index');
      else if (act === 'help') self.showPage('help');
      else if (act === 'back') self.showPage('menu');
      else if (act === 'save') { g.save(); }
      else if (act === 'reset') { g.setPaused(false); g.confirmReset(); }
    });

    this.el.over.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (b && b.getAttribute('data-act') === 'restart') g.newWorld();
    });

    this.el.inspect.addEventListener('click', function (e) {
      if (e.target.getAttribute('data-act') === 'close-inspect') g.selected = null;
    });

    // tooltips for the HUD and dock: anything carrying data-tip="TITLE|text"
    this.el.stage.addEventListener('mouseover', function (e) {
      var t = e.target.closest ? e.target.closest('[data-tip]') : null;
      self.domTip = t || null;
    });
    this.el.stage.addEventListener('mouseleave', function () { self.domTip = null; });

    global.addEventListener('keydown', function (e) { self.onKey(e); });
  };

  P.onKey = function (e) {
    var g = this.game, k = (e.key || '').toLowerCase();
    if (g.phase === 'title') {
      if (k === 'enter' || k === ' ') { g.startFromTitle(); e.preventDefault(); }
      return;
    }
    if (!this.el.lay.classList.contains('hidden')) {
      var map = { '1': 'gatherer', '2': 'builder', '3': 'nurse', '4': 'army' };
      if (map[k]) { g.chooseLay(map[k]); e.preventDefault(); return; }
      if (k === 'escape' || k === '5' || k === 'enter') { g.chooseLay(null); e.preventDefault(); return; }
      return;
    }
    if (g.phase === 'over') {
      if (k === 'r' || k === 'enter') { g.newWorld(); e.preventDefault(); }
      return;
    }
    if (g.paused) {
      if (k === ' ') { g.setPaused(false); e.preventDefault(); }
      else if (k === 'escape') {
        if (this.page && this.page !== 'menu') this.showPage('menu');
        else g.setPaused(false);
        e.preventDefault();
      } else if (k === 'i') this.showPage(this.page === 'index' ? 'menu' : 'index');
      else if (k === 'h' || k === '?') this.showPage(this.page === 'help' ? 'menu' : 'help');
      return;
    }
    if (k === ' ') { g.setPaused(true, 'menu'); e.preventDefault(); }
    else if (k === 'escape') { if (g.selected) g.selected = null; else g.setPaused(true, 'menu'); }
    else if (k === '1') g.setSpeed(1);
    else if (k === '2') g.setSpeed(2);
    else if (k === '3') g.setSpeed(3);
    else if (k === '+' || k === '=') g.zoomStep(1);
    else if (k === '-' || k === '_') g.zoomStep(-1);
    else if (k === 'g') g.toggleDefend();
    else if (k === 'f') g.snapToQueen();
    else if (k === 'v') g.cycleOverlay();
    else if (k === 'i') g.setPaused(true, 'index');
    else if (k === 'h' || k === '?') g.setPaused(true, 'help');
  };

  /* ---------------- screens ---------------- */
  P.hideTitle = function () {
    this.el.title.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.el.dock.classList.remove('hidden');
  };
  P.showTitle = function (seed) {
    this.el.title.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.dock.classList.add('hidden');
    this.el.over.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.overShown = false;
    this.el.seed.innerHTML = 'SEED ' + seed + ' &middot; <a id="t-new">NEW WORLD</a>';
    var a = $('t-new');
    if (a) a.addEventListener('click', function () { this.game.newWorld(); }.bind(this));
    this.refreshTitle();
  };

  /** the start button reads CONTINUE only while there is a colony to resume */
  P.refreshTitle = function () {
    var btn = $('begin');
    if (btn) btn.textContent = this.game.resumable ? 'CONTINUE COLONY' : 'DIG IN';
  };

  /* ---------------- pause menu ---------------- */
  P.openPause = function (page) {
    this.el.pause.classList.remove('hidden');
    this.showPage(page || 'menu');
    var g = this.game;
    var sub = $('pause-sub');
    if (sub) sub.textContent = g.events ? g.events.clock() : '';
  };
  P.closePause = function () {
    this.el.pause.classList.add('hidden');
    this.page = null;
  };
  P.showPage = function (page) {
    this.page = page;
    $('page-menu').classList.toggle('hidden', page !== 'menu');
    $('page-index').classList.toggle('hidden', page !== 'index');
    $('page-help').classList.toggle('hidden', page !== 'help');
    if (page === 'index') this.renderIndex();
  };

  /* ---------------- colony index ---------------- */
  P.renderIndex = function () {
    var C = global.CATALOG, self = this, tab = this.indexTab;
    var tabs = $('index-tabs').getElementsByTagName('button');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === tab);
    var list = tab === 'ants' ? C.ANTS : tab === 'blocks' ? C.BLOCKS : tab === 'items' ? C.ITEMS : C.EVENTS;
    var box = $('index-entries');
    box.innerHTML = '';
    list.forEach(function (en) {
      var card = document.createElement('div');
      card.className = 'entry';
      var icon = self.iconFor(tab, en);
      if (icon) card.appendChild(icon);
      var txt = document.createElement('div');
      txt.innerHTML = '<h4' + (en.enemy ? ' class="enemy"' : '') + '>' + en.name.toUpperCase() + (en.enemy ? ' &middot; ENEMY' : '') + '</h4>' +
        '<p>' + en.desc + '</p>' + self.statsFor(tab, en);
      card.appendChild(txt);
      box.appendChild(card);
    });
  };

  P.statsFor = function (tab, en) {
    var s = [];
    if (tab === 'ants') {
      var d = CFG.ROLE[en.role];
      s.push('HP <b>' + d.hp + '</b>', 'BITE <b>' + d.atk + '</b>/s', 'SPEED <b>' + d.speed + '</b>');
      if (en.tip) s.push(en.tip);
    } else if (tab === 'items' && en.food) {
      var a = global.FOOD_ART[en.food];
      s.push('FOOD <b>+' + a.food + '</b>');
      if (a.mat) s.push('MATERIAL <b>' + a.mat.toUpperCase() + '</b>');
    } else if (tab === 'blocks') {
      if (en.id === 'wood' || en.id === 'thatch') s.push('STRENGTH <b>' + CFG.STRUCT_HP + '</b>');
      if (en.tile === global.T.DIRT || en.tile === global.T.ROOT) s.push('<b>DIGGABLE</b>');
      if (en.tile === global.T.STONE) s.push('<b>UNBREAKABLE</b>');
    }
    return s.length ? '<div class="stats">' + s.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>' : '';
  };

  /** a small canvas showing the thing, drawn with the game's own art */
  P.iconFor = function (tab, en) {
    var c = document.createElement('canvas');
    var g;
    if (tab === 'ants' || (tab === 'events' && en.icon === 'raider')) {
      var spr = PX.antSprite(en.role || 'raider', 1, 1);
      var S = Math.max(spr.width, spr.height) + 2;
      c.width = S; c.height = S;
      g = c.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(spr, Math.floor((S - spr.width) / 2), Math.floor((S - spr.height) / 2) + 1);
      return c;
    }
    var World = global.World;
    if (tab === 'blocks' || (tab === 'events' && (en.icon === 'water' || en.icon === 'sand' || en.icon === 'sky'))) {
      c.width = 16; c.height = 16;
      g = c.getContext('2d'); g.imageSmoothingEnabled = false;
      var kind = en.icon || en.tile;
      for (var yy = 0; yy < 2; yy++) for (var xx = 0; xx < 2; xx++) World.drawTileIcon(g, kind, xx * 8, yy * 8);
      return c;
    }
    c.width = 14; c.height = 14;
    g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    var id = en.food || (tab === 'events' ? en.icon : null);
    if (id && global.FOOD_ART[id]) {
      var f = new global.FoodItem(7, 10, id);
      f.onGround = false; f.age = 9;
      f.draw(g, 0);
    } else if (en.special === 'egg') {
      var e = new global.Egg(7, 12, 'gatherer');
      e.progress = 0.5;
      e.draw(g, 0);
    } else if (en.special === 'granary' || id === 'granary') {
      PX.rect(g, 2, 7, 10, 6, '#3a2a1c');
      PX.rect(g, 3, 8, 8, 4, '#a8813f');
      PX.rect(g, 3, 8, 8, 1, '#d4ab63');
      PX.rect(g, 5, 6, 4, 2, '#a8813f');
      PX.rect(g, 5, 6, 3, 1, '#e8c47a');
    } else if (en.node) {
      global.Game.drawFoodNode(g, en.node, 3, 12, 0);
    }
    return c;
  };

  /** a data-URL image of an ant, for tooltips and the inspector */
  P.antImg = function (role) {
    if (this.iconCache[role] != null) return this.iconCache[role];
    var url = '';
    try {
      var spr = PX.antSprite(role, 1, 1);
      var c = PX.makeCanvas(spr.width + 2, spr.width + 2);
      c.getContext('2d').drawImage(spr, 1, Math.floor((spr.width - spr.height) / 2) + 1);
      url = c.toDataURL ? c.toDataURL() : '';
    } catch (err) { url = ''; }
    this.iconCache[role] = url;
    return url;
  };

  /** the lay prompt's brood icons are the real sprites */
  P.paintLayIcons = function () {
    var list = this.el.lay.getElementsByTagName ? this.el.lay.getElementsByTagName('canvas') : [];
    for (var i = 0; i < list.length; i++) {
      var cv = list[i], role = cv.getAttribute('data-sprite');
      if (!role || !cv.getContext) continue;
      var spr = PX.antSprite(role, 1, 1);
      cv.width = spr.width + 2; cv.height = spr.width + 2;
      var g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(spr, 1, Math.floor((spr.width - spr.height) / 2) + 1);
    }
  };

  P.openLay = function () {
    var cost = $('lay-cost');
    if (cost) cost.textContent = CFG.EGG_COST + ' food';
    this.el.lay.classList.remove('hidden');
  };
  P.closeLay = function () { this.el.lay.classList.add('hidden'); };

  P.banner = function (title, sub, kind) {
    this.el.bTitle.textContent = title;
    this.el.bSub.textContent = sub || '';
    this.el.banner.className = kind ? kind : '';
    this.el.banner.classList.remove('hidden');
    this.el.banner.style.animation = 'none';
    void this.el.banner.offsetWidth;
    this.el.banner.style.animation = '';
    this.bannerT = 2.8;
  };

  P.toast = function (msg) {
    this.toastMsg = msg;
    this.toastT = 2.6;
    this.el.toast.textContent = msg;
    this.el.toast.classList.remove('hidden', 'fade');
  };

  /* ---------------- per-frame refresh ---------------- */
  P.update = function (dt) {
    var g = this.game;
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0.3) this.el.toast.classList.add('fade');
      if (this.toastT <= 0) { this.toastMsg = ''; this.el.toast.classList.add('hidden'); }
    }
    this.updateTip();
    if (g.phase === 'title') return;

    this.el.food.textContent = Math.floor(g.food);
    this.el.eggs.textContent = g.eggs.length;
    this.el.qhp.textContent = Math.max(0, Math.round(g.queen ? g.queen.hp : 0));
    this.el.qhp.parentElement.classList.toggle('hurt', !!g.queen && g.queen.hp < g.queen.maxHp * 0.4);

    var counts = { gatherer: 0, builder: 0, nurse: 0, army: 0, enemy: 0 };
    for (var i = 0; i < g.ants.length; i++) {
      var a = g.ants[i];
      if (a.dead) continue;
      if (a.isEnemy) { counts.enemy++; continue; }
      if (counts[a.role] != null) counts[a.role]++;
    }
    this.el.g.textContent = counts.gatherer;
    this.el.b.textContent = counts.builder;
    this.el.n.textContent = counts.nurse;
    this.el.a.textContent = counts.army;
    this.el.e.textContent = counts.enemy;
    if (this.el.e.parentElement) this.el.e.parentElement.classList.toggle('hot', counts.enemy > 0);

    this.el.clock.textContent = g.events.clock();
    var nx = g.events.nextUp();
    this.el.next.textContent = 'NEXT: ' + nx.label + ' ' + Math.ceil(nx.t) + 'S';
    this.el.next.classList.toggle('hot', nx.t < 8 || (nx.label === 'RAID' && nx.t < 15));

    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.el.banner.classList.add('hidden');
    }

    this.el.hint.classList.toggle('hidden', g.phase !== 'place');

    this.el.bPause.classList.toggle('on', g.paused);
    this.el.bSpeed.textContent = g.speed + 'X';
    this.el.bFollow.classList.toggle('on', g.followQueen);
    this.el.bLayers.classList.toggle('on', g.overlay !== 0);
    this.el.bDefend.classList.toggle('on', !!g.defending);
    this.el.bDefend.textContent = g.defending ? 'DEFENDING' : 'DEFEND';
    this.el.zoom.textContent = (g.zoom < 1 ? '1/2' : g.zoom) + 'X';

    this.updateInspect();

    if (g.phase === 'over' && !this.overShown && g.time - (g.overAt || 0) > 1.6) this.showOver();
  };

  /* ---------------- game over ---------------- */
  P.showOver = function () {
    var g = this.game, s = g.stats;
    this.overShown = true;
    $('over-sub').textContent = 'DAY ' + g.events.day + ' — THE TUNNELS GO QUIET';
    var rows = [
      ['BROOD RAISED', s.born], ['EGGS LAID', s.eggs], ['FOOD GATHERED', s.gathered],
      ['RAIDS', s.raids], ['ENEMIES SLAIN', s.kills || 0], ['ANTS LOST', s.dead],
      ['TUNNELS DUG', s.dug], ['STRUCTURES RAISED', s.built]
    ];
    $('over-stats').innerHTML = rows.map(function (r) { return '<span>' + r[0] + '</span><b>' + r[1] + '</b>'; }).join('');
    this.el.over.classList.remove('hidden');
  };

  /* ---------------- tooltips ---------------- */
  P.updateTip = function () {
    var g = this.game, html = '', px = 0, py = 0;
    var modal = !this.el.pause.classList.contains('hidden') || !this.el.lay.classList.contains('hidden') ||
      !this.el.over.classList.contains('hidden') || !this.el.title.classList.contains('hidden');

    if (this.domTip && this.el.stage.contains && this.el.stage.contains(this.domTip) &&
      !(modal && !this.el.title.classList.contains('hidden'))) {
      var raw = this.domTip.getAttribute('data-tip') || '';
      var parts = raw.split('|');
      html = '<h4>' + esc(parts[0]) + '</h4>' + (parts[1] ? '<p>' + esc(parts[1]) + '</p>' : '');
      var r = this.domTip.getBoundingClientRect(), sr = this.el.stage.getBoundingClientRect();
      px = r.left - sr.left; py = r.bottom - sr.top + 6;
      if (r.top - sr.top > sr.height / 2) py = r.top - sr.top - 6 - (this.el.tip.offsetHeight || 60);
    } else if (!modal && g.mouse.over && !g.drag) {
      var h = g.hoverAt(g.mouse.x, g.mouse.y);
      if (h) html = this.describe(h);
      px = g.mouse.x * this.scale + 16; py = g.mouse.y * this.scale + 16;
    }

    var tip = this.el.tip;
    if (!html) { if (this.tipHtml) { tip.classList.add('hidden'); this.tipHtml = ''; } return; }
    if (html !== this.tipHtml) { tip.innerHTML = html; this.tipHtml = html; }
    tip.classList.remove('hidden');
    // keep it on the stage
    var W = CFG.VIEW_W * this.scale, H = CFG.VIEW_H * this.scale;
    var tw = tip.offsetWidth || 200, th = tip.offsetHeight || 80;
    if (px + tw > W - 4) px = Math.max(4, (this.domTip ? W - tw - 4 : g.mouse.x * this.scale - tw - 12));
    if (py + th > H - 4) py = Math.max(4, (this.domTip ? H - th - 4 : g.mouse.y * this.scale - th - 12));
    tip.style.left = Math.round(px) + 'px';
    tip.style.top = Math.round(py) + 'px';
  };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function kv(k, v) { return '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>'; }

  /** tooltip HTML for whatever game.hoverAt found */
  P.describe = function (h) {
    var C = global.CATALOG, T = global.T, en, out = '';
    switch (h.type) {
      case 'ant': {
        var a = h.ant, info = C.ant(a.role), def = a.def;
        var img = this.antImg(a.role);
        out += '<h4' + (a.isEnemy ? ' class="enemy"' : '') + '>' + (img ? '<img src="' + img + '" style="width:2em;height:2em;image-rendering:pixelated">' : '') +
          info.name.toUpperCase() + (a.isEnemy ? ' &middot; ENEMY' : '') + '</h4>';
        var pct = Math.max(0, Math.round(a.hp / a.maxHp * 100));
        out += '<div class="bar"><span class="hp' + (a.isEnemy ? '' : ' ok') + '" style="width:' + pct + '%"></span></div>';
        out += kv('HP', (Math.ceil(a.hp * 10) / 10) + ' / ' + a.maxHp);
        out += kv('BITE', def.atk + ' per second');
        out += kv('DOING', C.STATES[a.state] || a.state);
        if (a.carry > 0) out += kv('CARRYING', a.carry + ' food' + (a.carryKind ? ' + ' + a.carryKind : ''));
        if (a.job && a.state !== 'defend') out += kv('JOB', C.JOBS[a.job.kind] || a.job.kind);
        out += '<p>' + info.tip + '</p>';
        return out;
      }
      case 'egg': {
        var e = h.egg, cut = Math.min(e.nurses * CFG.HATCH_PER_NURSE, CFG.HATCH_MAX_CUT);
        var left = Math.max(0, (1 - e.progress) * CFG.HATCH_BASE * (1 - cut));
        out += '<h4>EGG</h4>';
        out += kv('WILL HATCH', C.ant(e.role).name.toUpperCase());
        out += '<div class="bar"><span class="food" style="width:' + Math.round(e.progress * 100) + '%"></span></div>';
        out += kv('PROGRESS', Math.round(e.progress * 100) + '%');
        out += kv('NURSES', e.nurses + (e.nurses ? ' (' + Math.round(cut * 100) + '% faster)' : ''));
        out += kv('HATCHES IN', Math.ceil(left) + 's');
        return out;
      }
      case 'food': {
        var f = h.food;
        en = C.food(f.kind) || { name: 'Food', desc: '' };
        out += '<h4>' + en.name.toUpperCase() + '</h4>';
        out += kv('FOOD', '+' + f.art.food);
        if (f.art.mat) out += kv('MATERIAL', f.art.mat);
        out += kv('STATUS', f.claimed ? 'a gatherer is coming' : (f.onGround ? 'waiting to be picked up' : 'falling'));
        out += '<p>' + en.desc + '</p>';
        return out;
      }
      case 'granary': {
        var g = this.game, m = g.mat;
        out += '<h4>GRANARY</h4>';
        out += kv('FOOD', Math.floor(g.food));
        out += kv('TWIGS / LEAVES / DIRT', m.twig + ' / ' + m.leaf + ' / ' + m.dirt);
        out += '<p>' + C.item('granary').desc + '</p>';
        return out;
      }
      case 'node': {
        en = C.node(h.node.kind);
        out += '<h4>' + en.name.toUpperCase() + '</h4>';
        out += kv('NEXT DROP', Math.max(0, Math.ceil(h.node.t)) + 's');
        out += '<p>' + en.desc + '</p>';
        return out;
      }
      case 'place': {
        out += '<h4>' + (h.ok ? 'PLACE THE QUEEN HERE' : 'NOT HERE') + '</h4>';
        out += '<p>' + (h.ok ? 'Click to dig the royal chamber. A crevice will open up to daylight.'
          : 'The queen needs deep, open dirt: 5 to 15 rows down, clear of stone, with room for a tunnel to the surface.') + '</p>';
        return out;
      }
      case 'tile': {
        if (h.sky) en = C.block('sky');
        else if (h.tile === T.TUNNEL || h.tile === T.AIR) en = C.block('tunnel');
        else en = C.tile(h.tile) || C.block('dirt');
        out += '<h4>' + en.name.toUpperCase() + '</h4>';
        if (h.tile === T.WOOD || h.tile === T.THATCH) {
          out += kv('STRENGTH', h.shp + ' / ' + CFG.STRUCT_HP);
          if (h.shp < CFG.STRUCT_HP) out += '<p>Cracked. Click to send a builder to mend it.</p>';
        }
        if (h.water > 0) out += kv('WATER', h.water + ' / ' + CFG.WATER_MAX + (h.water >= CFG.DROWN_AMOUNT ? ' (deep: drowning)' : ''));
        if (h.sand > 0) out += kv('SAND', h.sand + ' / ' + CFG.SAND_MAX);
        out += '<p>' + en.desc + '</p>';
        if (global.World.isDiggable(h.tile)) out += '<p>Click to mark it for digging.</p>';
        return out;
      }
    }
    return '';
  };

  /* ---------------- inspector ---------------- */
  P.updateInspect = function () {
    var g = this.game, a = g.selected, C = global.CATALOG;
    if (!a || a.dead) {
      if (a && a.dead && g.selectedDeadAt) {
        this.el.iName.textContent = C.ant(a.role).name.toUpperCase();
        this.el.iBody.innerHTML = '<div class="p-note">This ant has died.</div>';
        this.el.inspect.classList.remove('hidden');
      } else {
        this.el.inspect.classList.add('hidden');
      }
      return;
    }
    this.el.inspect.classList.remove('hidden');
    this.el.iName.textContent = C.ant(a.role).name.toUpperCase() + (a.isEnemy ? ' (ENEMY)' : '');
    var hpPct = Math.round(a.hp / a.maxHp * 100);
    var row = function (k, v) { return '<div class="row"><span>' + k + '</span><b>' + v + '</b></div>'; };
    var html = '';
    html += '<div class="bar"><span class="hp' + (a.isEnemy ? '' : ' ok') + '" style="width:' + hpPct + '%"></span></div>';
    html += row('HP', a.hp.toFixed(1) + ' / ' + a.maxHp);
    html += row('BITE', a.def.atk + ' per second');
    html += row('DOING', C.STATES[a.state] || a.state);
    if (a.carry > 0) html += row('CARRYING', a.carry + ' ' + (a.carryKind || 'food'));
    if (a.job && a.state !== 'defend') html += row('JOB', (C.JOBS[a.job.kind] || a.job.kind).toUpperCase());
    if (!a.isEnemy && a.role !== 'queen') html += row('HEALING', CFG.HEAL_COST + ' food → ' + CFG.HEAL_AMOUNT + ' HP');
    if (this.lastInspect !== html) { this.el.iBody.innerHTML = html; this.lastInspect = html; }
  };

  P.setSeedLabel = function (seed) {
    var el = $('t-seed');
    if (el) el.innerHTML = 'SEED ' + seed;
  };
  global.UI = UI;
})(window);
