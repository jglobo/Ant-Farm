/* ============================================================
  main.js  bootstrap + fixed-timestep loop
  ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.CFG;
  var STEP = 1 / 60;
  var MAX_STEPS = 14;

  function boot() {
    var canvas = document.getElementById('game');
    var game = new global.Game(canvas);
    global.game = game;

    // The title offers CONTINUE COLONY when a save exists (ui.refreshTitle);
    // its NEW WORLD link rolls a fresh map and drops back to DIG IN.
    game.ui.showTitle(game.seed);

    var acc = 0;
    var last = performance.now();
    var autoSave = 0;

    function frame(now) {
      var dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25;

      var frozen = game.paused || game.layPromptOpen;

      if (!frozen) {
        acc += dt * game.speed;
        var n = 0;
        while (acc >= STEP && n < MAX_STEPS) {
          game.step(STEP);
          acc -= STEP;
          n++;
        }
        if (n >= MAX_STEPS) acc = 0;

        autoSave += dt;
        if (autoSave > 90 && game.phase === 'play') {
          autoSave = 0;
          game.save();
        }
      } else {
        acc = 0;
      }

      game.ui.update(dt);
      game.render();
      global.requestAnimationFrame(frame);
    }
    global.requestAnimationFrame(frame);

    // leave with the colony saved
    window.addEventListener('beforeunload', function () {
      if (game.phase === 'play') game.save();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
