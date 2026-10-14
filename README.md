# ANT FARM

A pixel-art ant colony simulation that runs in the browser. You place the Queen;
everything after that is the colony working on its own.

## Play

Open **`index.html`** in any modern browser. No build step, no dependencies —
plain ES5 and a `<canvas>`.

```
Ant Farm/
  index.html        the whole UI shell
  css/style.css     panels, HUD, modals
  js/
    util.js         tuning constants, math, seeded RNG, value noise
    pixel.js        palette, 5x7 bitmap font, baked ant sprites
    world.js        tile grid, terrain generation, pathing, water + sand physics
    entities.js     actors, ants, eggs, food, particles, collision, climbing
    catalog.js      names and descriptions shared by the index and the tooltips
    ants.js         role behaviour: queen, gatherer, builder, nurse, army, raiders, defence
    events.js       weather, debris, raids, day/night
    ui.js           DOM chrome: HUD, tooltips, pause menu, colony index, inspector
    game.js         state, economy, job director, camera, rendering
    main.js         bootstrap + fixed-timestep loop
  tools/            headless test harness (Node, not needed to play)
```

## The loop

1. Click **DIG IN**, then click deep dirt to place the Queen. A natural crevice
   is cut from her chamber up to daylight so the colony can forage from the
   first egg.
2. When she is ready she asks what to lay. Pick a brood.
3. That is your whole job. Choose well and the colony grows; choose badly and
   it starves.

| Brood | HP | Bite | What it does |
|---|---|---|---|
| **Gatherer** | 5 | 1 | Forages food, twigs and leaves from the surface and falling debris |
| **Builder** | 5 | 1 | Digs tunnels and rooms, raises walls, dams the rain, mends damage |
| **Nurse** | 5 | 1 | Sits on eggs; every nurse cuts hatch time by 16% (capped at 72%) |
| **Soldier** | 10 | 3 | Patrols round the Queen and charges raiders |
| **Queen** | 100 | 5 | Lays the next egg whenever food allows. Lose her and it is over |

Everyone bites once a second. Raiders, thieves and brutes bite for 2. Workers
no longer run from raiders: whoever a raider is chewing on bites back.

The world is 288 x 144 tiles. Ants walk floors, step on and off ledges, climb
any wall they touch, and climb or drop down shafts. The pathfinder plans in
exactly those moves, so nobody hops or scrambles.

Food feeds three things: eggs (2 food), healing wounded ants (3 food buys 2 HP),
and the faster lay timer — the fuller the granary, the sooner she lays again.

## Events

- **Raids** — periodic. A warning banner fires ~14s ahead. Raiders hunt the
  Queen; thieves make for the granary and run; brutes smash structures.
- **Rain** — water falls from the sky, pools on the surface and runs down the
  shafts. Builders must dam the openings or the chambers flood.
- **Sandstorms** — sand buries the tunnels. It slows everyone and has to be
  cleared out.
- **Falling debris** — leaves, twigs, feathers, seeds and berries drift down from
  above. Free food for whoever is quick.
- **Day/night** — a 150s cycle. Nights slow the surface growth of food.

## Your direct orders

- Click any cracked wall, leaking tunnel, or patch of dirt and a builder will
  be sent to deal with it.
- Press **DEFEND** (`G`) when raiders come. Every ant drops its work and
  rallies round the Queen: workers hold a ring around her, soldiers go out to
  meet the raiders. Once the raid is over (and at least 8 seconds have passed)
  everyone goes back to what they were doing.

Everything else the colony decides for itself. Hover over anything (an ant, an
egg, food, a block) to see what it is.

## Controls

| | |
|---|---|
| Click | place the Queen, select an ant, or order a repair |
| Hover | tooltip for whatever is under the cursor |
| Drag / `WASD` | pan the camera |
| Wheel / `+` `-` | zoom (1/2x, 1x, 2x, 3x) |
| `Space` / `Esc` | pause menu: resume, colony index, handbook, save, new colony |
| `I` | colony index: every ant, block, item and event |
| `G` | defend: call every ant back to the Queen |
| `1` `2` `3` | game speed (when no egg prompt is open) |
| `1`-`4` | choose the brood when the Queen offers |
| `F` | snap the camera to the Queen |
| `V` | cycle overlays (jobs, threats, economy) |
| `H` | handbook |

The colony autosaves every 90 seconds and when you leave; **Save colony** in
the pause menu saves on demand. Saves from the old 96 x 48 map cannot be loaded.

## Development tools

The simulation runs headless under Node so the rules can be checked without a
browser.

```
node tools/smoke.js 300          # simulate 300 seconds, print a colony report
node tools/playthrough.js 39585 480   # play a full game, log a timeline, render frames
node tools/pathsweep.js 300      # prove every founding nest reaches daylight
node tools/validate.js 8 420     # run 8 seeds x 420s and compare outcomes
node tools/pathcheck.js 12345 48 22   # dump pathing + terrain for one placement
node tools/input-test.js         # drive the real DOM events: title -> place -> select -> order
node tools/shot.js shots         # rasterise real frames to PNG (no browser needed)
node tools/fontcheck.js PAUSED   # render bitmap-font glyphs as ASCII art
```

`playthrough.js` is the quickest way to see the game working end to end: it
plays with a brood strategy, prints a timeline of the colony, and drops frames
into `shots/`.

`input-test.js` dispatches genuine `mousedown`/`mousemove`/`mouseup` events
through a recording DOM stub, so a broken handler shows up as a failed assertion
instead of a game that quietly stops responding to clicks.

`shot.js` and `playthrough.js` run the real renderer against a small software
rasteriser (`tools/raster.js`, plus a hand-rolled PNG encoder), which makes the
visuals checkable without a browser.

Environment variables: `SEED=<n>` for a reproducible world, `TRACE=1` for a
per-5-second ant state log, `DEBUG=1` for terrain and field dumps.

## Known rough edges

- Brood composition is the whole game and the feedback is slow. A colony with
  too many army ants and no nurses will look fine for a few minutes and then
  stop growing, because hatching is the bottleneck. Watch the egg counter, not
  the ant count.
- Builders raise structures when there is something to dam or wall off. A quiet
  map with no rain and no raids may not see a wall go up for a long while.
- Night is dim by design, but tuned to stay playable. The night ambient is the
  first `PX.mix(...)` in `drawLighting` in `js/game.js` if you want it darker.
