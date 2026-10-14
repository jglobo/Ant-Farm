/* ============================================================
  pixel.js  palette, 5x7 bitmap font, sprite baking, lighting
  ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG;

  /* ---------------- palette ---------------- */
  var PAL = {
    sky0: '#5c7fb8', sky1: '#8fb4dc', sky2: '#c8ddf0',
    grass0: '#3f7a2c', grass1: '#4f9a35', grass2: '#2f5c1e', grass3: '#6fbf46',
    dirt0: '#6b4526', dirt1: '#7d5430', dirt2: '#553319', dirt3: '#8a6039',
    deep0: '#3a2416', deep1: '#4a3020',
    stone0: '#4a4741', stone1: '#5c5851', stone2: '#332f2b',
    wood: '#8a6134', wood1: '#6b4a26',
    thatch: '#a8912f', thatch1: '#7d6a1f',
    water: '#3f8fd0', water1: '#63b4e8', foam: '#bfe4ff',
    sand: '#d8c084', sand1: '#bda468',
    root: '#4a2f18', root1: '#63401f',
    gold: '#e8b24a', red: '#d8483a'
  };

  /* ---------------- 5x7 font ---------------- */
  /* each glyph = 7 rows of 5 chars; '#' = lit */
  var GLYPHS = {
    'A': '01110 10001 10001 11111 10001 10001 10001',
    'B': '11110 10001 10001 11110 10001 10001 11110',
    'C': '01110 10001 10000 10000 10000 10001 01110',
    'D': '11110 10001 10001 10001 10001 10001 11110',
    'E': '11111 10000 10000 11110 10000 10000 11111',
    'F': '11111 10000 10000 11110 10000 10000 10000',
    'G': '01110 10001 10000 10111 10001 10001 01111',
    'H': '10001 10001 10001 11111 10001 10001 10001',
    'I': '11111 00100 00100 00100 00100 00100 11111',
    'J': '00111 00010 00010 00010 00010 10010 01100',
    'K': '10001 10010 10100 11000 10100 10010 10001',
    'L': '10000 10000 10000 10000 10000 10000 11111',
    'M': '10001 11011 10101 10101 10001 10001 10001',
    'N': '10001 11001 10101 10011 10001 10001 10001',
    'O': '01110 10001 10001 10001 10001 10001 01110',
    'P': '11110 10001 10001 11110 10000 10000 10000',
    'Q': '01110 10001 10001 10001 10101 10010 01101',
    'R': '11110 10001 10001 11110 10100 10010 10001',
    'S': '01111 10000 10000 01110 00001 00001 11110',
    'T': '11111 00100 00100 00100 00100 00100 00100',
    'U': '10001 10001 10001 10001 10001 10001 01110',
    'V': '10001 10001 10001 10001 10001 01010 00100',
    'W': '10001 10001 10001 10101 10101 11011 10001',
    'X': '10001 10001 01010 00100 01010 10001 10001',
    'Y': '10001 10001 01010 00100 00100 00100 00100',
    'Z': '11111 00001 00010 00100 01000 10000 11111',
    '0': '01110 10001 10011 10101 11001 10001 01110',
    '1': '00100 01100 00100 00100 00100 00100 01110',
    '2': '01110 10001 00001 00110 01000 10000 11111',
    '3': '11110 00001 00001 01110 00001 00001 11110',
    '4': '00010 00110 01010 10010 11111 00010 00010',
    '5': '11111 10000 11110 00001 00001 10001 01110',
    '6': '00110 01000 10000 11110 10001 10001 01110',
    '7': '11111 00001 00010 00100 01000 01000 01000',
    '8': '01110 10001 10001 01110 10001 10001 01110',
    '9': '01110 10001 10001 01111 00001 00010 01100',
    ' ': '00000 00000 00000 00000 00000 00000 00000',
    '.': '00000 00000 00000 00000 00000 01100 01100',
    ',': '00000 00000 00000 00000 01100 01100 01000',
    ':': '00000 01100 01100 00000 01100 01100 00000',
    '!': '00100 00100 00100 00100 00100 00000 00100',
    '?': '01110 10001 00001 00110 00100 00000 00100',
    "'": '00100 00100 00000 00000 00000 00000 00000',
    '"': '01010 01010 00000 00000 00000 00000 00000',
    '-': '00000 00000 00000 11111 00000 00000 00000',
    '+': '00000 00100 00100 11111 00100 00100 00000',
    '/': '00001 00010 00010 00100 01000 01000 10000',
    '(': '00010 00100 01000 01000 01000 00100 00010',
    ')': '01000 00100 00010 00010 00010 00100 01000',
    '%': '11001 11010 00010 00100 01000 01011 10011',
    '#': '01010 11111 01010 01010 11111 01010 00000',
    '*': '00000 10101 01110 11111 01110 10101 00000',
    '=': '00000 00000 11111 00000 11111 00000 00000',
    '<': '00010 00100 01000 10000 01000 00100 00010',
    '>': '01000 00100 00010 00001 00010 00100 01000',
    '~': '00000 00000 01001 10110 00000 00000 00000',
    '@': '01110 10001 10111 10101 10111 10000 01110',
    '&': '01100 10010 10010 01100 10101 10010 01101',
    '$': '00100 01111 10100 01110 00101 11110 00100',
    '[': '01110 01000 01000 01000 01000 01000 01110',
    ']': '01110 00010 00010 00010 00010 00010 01110',
    '_': '00000 00000 00000 00000 00000 00000 11111',
    '|': '00100 00100 00100 00100 00100 00100 00100',
    '^': '00100 01010 10001 00000 00000 00000 00000',
    // small icons used by the HUD
    '♥': '01010 11111 11111 11111 01110 00100 00000',
    '↑': '00100 01110 10101 00100 00100 00100 00100',
    '→': '00000 00100 00010 11111 00010 00100 00000',
    '↓': '00000 00100 00100 00100 10101 01110 00100',
    '←': '00000 00100 01000 11111 01000 00100 00000',
    '·': '00000 00000 00000 00100 00000 00000 00000'
  };

  var FONT = {};
  (function bake() {
    for (var k in GLYPHS) {
      if (!Object.prototype.hasOwnProperty.call(GLYPHS, k)) continue;
      var rows = GLYPHS[k].split(' ');
      var glyph = new Uint8Array(7);
      for (var y = 0; y < 7; y++) {
        var r = rows[y] || '00000', m = 0;
        for (var x = 0; x < 5; x++) if (r.charAt(x) === '#' || r.charAt(x) === '1') m |= (1 << x);
        glyph[y] = m;
      }
      FONT[k] = glyph;
    }
  })();

  /* ---------------- canvas helpers ---------------- */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    return c;
  }

  /* ---------------- text ---------------- */
  var CHAR_W = 5, CHAR_H = 7, CHAR_SPC = 1;

  function textWidth(str, scale, tracking) {
    scale = scale || 1; tracking = tracking || 0;
    if (!str.length) return 0;
    return (str.length * (CHAR_W + CHAR_SPC) - CHAR_SPC) * scale + (str.length - 1) * tracking;
  }

  /**
  * Draw bitmap text. opts: {scale, align:'left'|'center'|'right', shadow:color, tracking}
*/
  function text(ctx, str, x, y, color, opts) {
    opts = opts || {};
    str = String(str).toUpperCase();
    var s = opts.scale || 1;
    var tr = opts.tracking || 0;
    var w = textWidth(str, s, tr);
    var ox = x;
    if (opts.align === 'center') ox = Math.round(x - w / 2);
    else if (opts.align === 'right') ox = Math.round(x - w);
    ox = Math.round(ox); y = Math.round(y);

    if (opts.shadow) {
      drawRun(ctx, str, ox + s, y + s, opts.shadow, s, tr);
    }
    drawRun(ctx, str, ox, y, color, s, tr);
    return w;
  }

  function drawRun(ctx, str, ox, oy, color, s, tr) {
    ctx.fillStyle = color;
    var px = ox;
    for (var i = 0; i < str.length; i++) {
      var g = FONT[str.charAt(i)] || FONT['?'];
      for (var y = 0; y < 7; y++) {
        var m = g[y];
        if (!m) continue;
        for (var x = 0; x < 5; x++) {
          if (m & (1 << x)) ctx.fillRect(px + x * s, oy + y * s, s, s);
        }
      }
      px += (CHAR_W + CHAR_SPC) * s + tr;
    }
  }

  /* ---------------- sprite baking ---------------- */
  /*
   * Side-view ants, drawn procedurally so every role shares one anatomy:
   * abdomen (gaster), a one-pixel waist, thorax and head, each a shaded
   * ellipse; a dark outline tinted by the body colour so the role colour
   * reads against the dirt; six jointed legs walking in a tripod gait; and
   * elbowed antennae. The base is drawn facing right and mirrored or rotated
   * for the other poses.
   */
  var ANIM_FRAMES = 4;
  var spriteCache = {};

  // body length/height, and each part as [rx, ry] fractions of L and H
  var SPEC = {
    queen:    { L: 19, H: 8, gaster: [0.30, 0.62], thorax: [0.12, 0.40], head: [0.12, 0.44] },
    gatherer: { L: 11, H: 5, gaster: [0.24, 0.58], thorax: [0.13, 0.40], head: [0.14, 0.50] },
    builder:  { L: 11, H: 5, gaster: [0.24, 0.58], thorax: [0.13, 0.40], head: [0.14, 0.50] },
    nurse:    { L: 11, H: 5, gaster: [0.24, 0.58], thorax: [0.13, 0.40], head: [0.14, 0.50] },
    army:     { L: 13, H: 6, gaster: [0.21, 0.52], thorax: [0.13, 0.40], head: [0.19, 0.58] },
    raider:   { L: 11, H: 5, gaster: [0.24, 0.58], thorax: [0.13, 0.40], head: [0.15, 0.52] },
    thief:    { L: 11, H: 5, gaster: [0.24, 0.58], thorax: [0.13, 0.40], head: [0.14, 0.50] },
    brute:    { L: 15, H: 7, gaster: [0.22, 0.56], thorax: [0.14, 0.42], head: [0.19, 0.60] }
  };

  /** the right-facing base sprite for a role and walk frame */
  function bakeAnt(roleKey, frame) {
    var def = CFG.ROLE[roleKey], sp = SPEC[roleKey] || SPEC.gatherer;
    var L = sp.L, H = sp.H;
    var SW = L + 6, SH = H + 6;            // room for antennae, legs, jaws
    var ox = 2;                             // body starts here
    var bodyBottom = SH - 3;                // last body row; legs below
    var mid = bodyBottom + 1 - H / 2;       // body centre line (pixel units)

    var body = def.color;
    var lite = shade(body, 0.32), dim = shade(body, -0.3);
    var edge = shade(body, -0.74);
    var legC = shade(body, -0.62), legFar = mix(legC, body, 0.35);

    // ---- part geometry ----
    var gRx = sp.gaster[0] * L, gRy = sp.gaster[1] * H;
    var tRx = sp.thorax[0] * L, tRy = sp.thorax[1] * H;
    var hRx = sp.head[0] * L, hRy = sp.head[1] * H;
    var gCx = ox + gRx, gCy = mid - 0.08 * H;
    var petX = Math.round(gCx + gRx);
    var tCx = petX + 1 + tRx, tCy = mid + 0.06 * H;
    var hCx = tCx + tRx + hRx - 0.2, hCy = mid - 0.12 * H;

    // ---- mask: 0 none, 1 gaster, 2 waist, 3 thorax, 4 head ----
    var mask = new Uint8Array(SW * SH);
    function inE(x, y, cx, cy, rx, ry) {
      var dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      return dx * dx + dy * dy <= 1.08;
    }
    var x, y;
    for (y = 0; y < SH; y++) {
      for (x = 0; x < SW; x++) {
        var k = 0;
        if (inE(x, y, gCx, gCy, gRx, gRy)) k = 1;
        if (inE(x, y, tCx, tCy, tRx, tRy)) k = 3;
        if (inE(x, y, hCx, hCy, hRx, hRy)) k = 4;
        mask[y * SW + x] = k;
      }
    }
    // the waist: a one-pixel thread joining everything along the centre line
    var waistY = Math.floor(mid);
    var x0 = Math.floor(gCx), x1 = Math.ceil(hCx);
    for (x = x0; x <= x1; x++) if (!mask[waistY * SW + x]) mask[waistY * SW + x] = 2;

    var c = makeCanvas(SW, SH);
    var g = c.getContext('2d');
    function px(xx, yy, col) { if (xx >= 0 && yy >= 0 && xx < SW && yy < SH) { g.fillStyle = col; g.fillRect(xx, yy, 1, 1); } }
    function line(xa, ya, xb, yb, col) {
      xa = Math.round(xa); ya = Math.round(ya); xb = Math.round(xb); yb = Math.round(yb);
      var dx = Math.abs(xb - xa), dy = -Math.abs(yb - ya), sx = xa < xb ? 1 : -1, sy = ya < yb ? 1 : -1, err = dx + dy;
      for (var guard = 0; guard < 40; guard++) {
        px(xa, ya, col);
        if (xa === xb && ya === yb) break;
        var e2 = 2 * err;
        if (e2 >= dy) { err += dy; xa += sx; }
        if (e2 <= dx) { err += dx; ya += sy; }
      }
    }

    // ---- legs: tripod gait. Near-side legs A (back, front) and B (middle)
    // swing in opposite phase; the far side mirrors them, a shade lighter ----
    var ph = ((frame % ANIM_FRAMES) + ANIM_FRAMES) % ANIM_FRAMES;
    var swingA = [1, 0, -1, 0][ph], swingB = -swingA;
    var liftA = ph === 3 ? 1 : 0, liftB = ph === 1 ? 1 : 0;
    var reach = Math.max(2, Math.round(L * 0.2));
    var anchors = [tCx - tRx * 0.7, tCx, tCx + tRx * 0.7];
    var spread = [-reach, 0, reach];
    var footY = SH - 1, hipY = Math.min(bodyBottom, Math.round(tCy + tRy - 0.5));
    function leg(i, far) {
      var groupA = (i !== 1) !== far;
      var sw = groupA ? swingA : swingB, lift = groupA ? liftA : liftB;
      var ax = Math.round(anchors[i]) + (far ? 1 : 0);
      var fx = ax + spread[i] + sw;
      var kx = ax + Math.round(spread[i] * 0.6) + (spread[i] === 0 ? sw : 0);
      var col = far ? legFar : legC;
      line(ax, hipY, kx, hipY + 1 - lift, col);      // femur
      line(kx, hipY + 1 - lift, fx, footY - lift, col); // tibia to the foot
    }
    for (var li = 0; li < 3; li++) leg(li, true);
    for (li = 0; li < 3; li++) leg(li, false);

    // ---- body fill with top light and bottom shadow ----
    for (y = 0; y < SH; y++) {
      for (x = 0; x < SW; x++) {
        var m = mask[y * SW + x];
        if (!m) continue;
        var up = y > 0 ? mask[(y - 1) * SW + x] : 0;
        var dn = y < SH - 1 ? mask[(y + 1) * SW + x] : 0;
        var col = m === 4 ? shade(body, 0.08) : body;
        if (m === 2) col = dim;
        else if (!up) col = lite;
        else if (!dn) col = dim;
        px(x, y, col);
      }
    }
    // abdomen banding
    var bandCol = shade(body, -0.22);
    for (y = 0; y < SH; y++) {
      for (x = Math.round(gCx - 1); x <= Math.round(gCx + 1); x += 2) {
        if (mask[y * SW + x] === 1 && y > 0 && mask[(y - 1) * SW + x] === 1) px(x, y, bandCol);
      }
    }

    // ---- outline: every empty pixel touching the body ----
    var outline = [];
    for (y = 0; y < SH; y++) {
      for (x = 0; x < SW; x++) {
        if (mask[y * SW + x]) continue;
        if ((x > 0 && mask[y * SW + x - 1]) || (x < SW - 1 && mask[y * SW + x + 1]) ||
          (y > 0 && mask[(y - 1) * SW + x]) || (y < SH - 1 && mask[(y + 1) * SW + x])) outline.push(x, y);
      }
    }
    for (var o = 0; o < outline.length; o += 2) px(outline[o], outline[o + 1], edge);

    // ---- head furniture ----
    var headTop = Math.floor(hCy - hRy + 0.5), headFront = Math.floor(hCx + hRx - 0.2);
    var eyeX = Math.round(hCx + hRx * 0.3), eyeY = Math.round(hCy - hRy * 0.25);
    var enemyEye = roleKey === 'raider' || roleKey === 'brute' || roleKey === 'thief';
    px(eyeX, eyeY, enemyEye ? '#ff5a3c' : '#120b08');
    if (!enemyEye && hRy > 2.4) px(eyeX, eyeY - 1, '#fff6d8');   // glint on the larger heads

    // antennae, elbowed, tips nodding with the walk
    var aBase = Math.round(hCx + hRx * 0.1), nod = (ph === 1 || ph === 2) ? 1 : 0;
    var antC = shade(body, -0.55);
    px(aBase, headTop - 1, antC);
    px(aBase, headTop - 2, antC);
    px(aBase + 1, headTop - 3 + nod, antC);
    px(aBase + 2, headTop - 3 + nod, antC);
    px(aBase + 3, headTop - 2 + nod, antC);

    // mandibles
    var jawY = Math.round(hCy + hRy * 0.35);
    var jawC = '#e8d8b0';
    px(headFront + 1, jawY, jawC);
    if (roleKey === 'army' || roleKey === 'brute') {
      px(headFront + 2, jawY, jawC);
      px(headFront + 2, jawY + 1, shade(jawC, -0.3));
      px(headFront + 1, jawY - 1, shade(jawC, -0.2));
    }

    // ---- role marks ----
    switch (roleKey) {
      case 'queen': {
        // folded wings resting over the back
        var wx0 = Math.round(tCx - 1), wx1 = Math.round(gCx - gRx * 0.6), wy = Math.round(gCy - gRy) - 1;
        for (x = wx1; x <= wx0; x++) {
          px(x, wy, 'rgba(236,244,255,.75)');
          if (x > wx1 + 1 && x < wx0) px(x, wy - 1, 'rgba(236,244,255,.45)');
        }
        // a little crown
        px(Math.round(hCx - 1), headTop - 1, '#fff2a8');
        px(Math.round(hCx), headTop - 2, '#ffe066');
        px(Math.round(hCx + 1), headTop - 1, '#fff2a8');
        // golden bands on the abdomen
        for (y = 0; y < SH; y++) {
          for (x = Math.round(gCx - gRx * 0.5); x <= Math.round(gCx + gRx * 0.5); x += 3) {
            if (mask[y * SW + x] === 1 && mask[(y - 1) * SW + x] === 1) px(x, y, '#b07a22');
          }
        }
        break;
      }
      case 'builder': {
        // yellow hard hat with a brim
        for (x = Math.round(hCx - hRx); x <= Math.round(hCx + hRx); x++) {
          if (mask[(headTop) * SW + x] === 4 || mask[(headTop + 1) * SW + x] === 4) px(x, headTop, '#f2c84b');
        }
        px(Math.round(hCx + hRx) + 1, headTop + 1, '#c99a2a');
        px(Math.round(hCx - 1), headTop - 1 < 0 ? 0 : headTop, '#fff0a0');
        break;
      }
      case 'nurse': {
        // a pale sash across the abdomen
        var nx0 = Math.round(gCx + 1);
        for (y = 0; y < SH; y++) if (mask[y * SW + nx0] === 1) px(nx0, y, '#f2ffe2');
        px(Math.round(tCx), Math.round(tCy - tRy) , '#f2ffe2');
        break;
      }
      case 'gatherer': {
        // pollen-dusted back
        px(Math.round(gCx - 1), Math.round(gCy - gRy) + 1, '#ffd47a');
        px(Math.round(gCx + 1), Math.round(gCy - gRy) + 1, '#ffd47a');
        break;
      }
      case 'army': {
        // helmet ridge
        for (x = Math.round(hCx - hRx + 1); x <= Math.round(hCx + hRx - 1); x++) {
          if (mask[headTop * SW + x] === 4) px(x, headTop, '#ff8a6a');
        }
        px(Math.round(tCx), Math.round(tCy - tRy), '#5a1c17');
        break;
      }
      case 'raider': {
        // spines along the thorax
        px(Math.round(tCx - 1), Math.round(tCy - tRy) - 1, edge);
        px(Math.round(tCx + 1), Math.round(tCy - tRy) - 1, edge);
        break;
      }
      case 'thief': {
        // a stolen sack slung over the abdomen
        var sx0 = Math.round(gCx - 1), sy0 = Math.round(gCy - gRy) - 2;
        for (y = sy0; y < sy0 + 3; y++) for (x = sx0; x < sx0 + 3; x++) px(x, y, '#c8a25a');
        px(sx0, sy0, '#e6c88a'); px(sx0 + 2, sy0 + 2, '#8a6a34');
        break;
      }
      case 'brute': {
        // armour plates: a pale rim along the back
        for (x = 0; x < SW; x++) {
          for (y = 0; y < SH; y++) {
            var mm = mask[y * SW + x];
            if (mm && mm !== 2 && (y === 0 || !mask[(y - 1) * SW + x]) && (x % 2 === 0)) { px(x, y, '#9a6a5a'); break; }
          }
        }
        break;
      }
    }

    c.meta = { mouthX: headFront + 1, mouthY: jawY, bodyTop: Math.floor(mid - H / 2) };
    return c;
  }

  function flipX(src) {
    var c = makeCanvas(src.width, src.height), g = c.getContext('2d');
    g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
    if (src.meta) c.meta = { mouthX: src.width - 1 - src.meta.mouthX, mouthY: src.meta.mouthY, bodyTop: src.meta.bodyTop };
    return c;
  }

  /** quarter turn: dir -1 = counter-clockwise, +1 = clockwise */
  function rot90(src, dir) {
    var c = makeCanvas(src.height, src.width), g = c.getContext('2d');
    if (dir > 0) { g.translate(src.height, 0); g.rotate(Math.PI / 2); }
    else { g.translate(0, src.width); g.rotate(-Math.PI / 2); }
    g.drawImage(src, 0, 0);
    return c;
  }

  /**
   * face: 1 = right, -1 = left. Feet are on the bottom row, so draw it with
   * its bottom edge on the ant's feet.
   */
  function antSprite(roleKey, frame, face) {
    var key = roleKey + '|' + frame + '|' + face;
    if (spriteCache[key]) return spriteCache[key];
    var base = spriteCache[roleKey + '|' + frame + '|1'] || (spriteCache[roleKey + '|' + frame + '|1'] = bakeAnt(roleKey, frame));
    var s = face > 0 ? base : flipX(base);
    spriteCache[key] = s;
    return s;
  }

  /**
   * An ant on a wall: wall = side the wall is on (-1 left, 1 right),
   * vdir = -1 climbing up, 1 climbing down. Feet face the wall.
   */
  function antClimbSprite(roleKey, frame, wall, vdir) {
    var key = roleKey + '|' + frame + '|c' + wall + '|' + vdir;
    if (spriteCache[key]) return spriteCache[key];
    var base = antSprite(roleKey, frame, 1);
    // right-facing turned counter-clockwise: head up, feet right
    var s = vdir < 0 ? rot90(base, -1) : rot90(base, 1);
    // ...and turned clockwise: head down, feet left
    if ((vdir < 0 && wall < 0) || (vdir > 0 && wall > 0)) s = flipX(s);
    spriteCache[key] = s;
    return s;
  }

  /** a white silhouette of any sprite, for the hit flash */
  function flashOf(spr) {
    if (spr._flash) return spr._flash;
    var c = makeCanvas(spr.width, spr.height), g = c.getContext('2d');
    g.drawImage(spr, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, spr.width, spr.height);
    spr._flash = c;
    return c;
  }


  function rect(g, x, y, w, h, color) {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  }

  /* ---------------- color utils ---------------- */
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) + (clamp255(r) << 16) + (clamp255(g) << 8) + clamp255(b)).toString(16).slice(1);
  }
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

  /** amt in [-1,1]; negative darkens toward black, positive lightens toward white */
  function shade(hex, amt) {
    var c = hexToRgb(hex);
    if (amt < 0) {
      var k = 1 + amt;
      return rgbToHex(c[0] * k, c[1] * k, c[2] * k);
    }
    return rgbToHex(c[0] + (255 - c[0]) * amt, c[1] + (255 - c[1]) * amt, c[2] + (255 - c[2]) * amt);
  }
  function mix(a, b, t) {
    var x = hexToRgb(a), y = hexToRgb(b);
    return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  /* ---------------- misc draw helpers ---------------- */
  function panelBox(ctx, x, y, w, h, fill, edge, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    if (edge) { ctx.fillStyle = edge; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); }
    ctx.globalAlpha = 1;
  }

  function hpBar(ctx, x, y, w, frac, color) {
    rect(ctx, x - 1, y - 1, w + 2, 4, '#0a0705');
    rect(ctx, x, y, w, 2, '#2a1c16');
    var fw = Math.max(0, Math.min(w, Math.round(w * frac)));
    if (fw > 0) rect(ctx, x, y, fw, 2, color || '#e0604a');
  }

  /** darken a colour by depth in tiles */
  function depthShade(base, ty, H) {
    var t = global.U.clamp((ty - 6) / (H - 8), 0, 1);
    return mix(base, '#0d0a08', t * 0.55);
  }

  global.PX = {
    PAL: PAL, makeCanvas: makeCanvas, text: text, textWidth: textWidth,
    antSprite: antSprite, antClimbSprite: antClimbSprite, flashOf: flashOf, ANIM_FRAMES: ANIM_FRAMES,
    shade: shade, mix: mix, rgba: rgba, hexToRgb: hexToRgb,
    panelBox: panelBox, hpBar: hpBar, rect: rect, depthShade: depthShade
  };
})(window);
