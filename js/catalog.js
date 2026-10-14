/* ============================================================
  catalog.js  names and descriptions for everything in the world.
  The colony index (pause menu) and the hover tooltips both read
  from here, so they always agree.
  ============================================================ */
(function (global) {
  'use strict';

  var T = global.T;

  var ANTS = [
    { id: 'queen', role: 'queen', name: 'Queen',
      desc: 'The heart of the colony. She lays an egg whenever there is food for one. If she dies, the game is over.',
      tip: 'Keep her alive.' },
    { id: 'gatherer', role: 'gatherer', name: 'Gatherer',
      desc: 'Climbs out of the nest to fetch berries, seeds, leaves and twigs, and carries them back to the granary.',
      tip: 'Food for eggs, healing, and materials for walls.' },
    { id: 'builder', role: 'builder', name: 'Builder',
      desc: 'Digs new tunnels and rooms, dams flooding shafts with leaves, raises twig walls during raids and mends damage.',
      tip: 'Click dirt, a leak or a cracked wall to send one.' },
    { id: 'nurse', role: 'nurse', name: 'Nurse',
      desc: 'Sits with the eggs. Every nurse beside an egg makes it hatch 16% sooner (up to 72% sooner).',
      tip: 'Hatching is usually the bottleneck.' },
    { id: 'army', role: 'army', name: 'Soldier',
      desc: 'Patrols around the queen and charges any raider that comes close. Tough, and bites three times as hard as a worker.',
      tip: 'Your raid defence.' },
    { id: 'raider', role: 'raider', name: 'Raider', enemy: true,
      desc: 'An enemy ant. Marches straight for the queen and bites anything in its way. Chews through walls it cannot get round.',
      tip: 'Arrives in raids from the surface.' },
    { id: 'thief', role: 'thief', name: 'Thief', enemy: true,
      desc: 'Sneaks to the granary, steals up to 14 food and runs for the surface. Kill it before it escapes to get the food back.',
      tip: 'Appears in raids from day 3.' },
    { id: 'brute', role: 'brute', name: 'Brute', enemy: true,
      desc: 'A heavy enemy that smashes walls twice as fast as a raider and takes three soldier bites to bring down.',
      tip: 'Appears in raids from day 4.' }
  ];

  var BLOCKS = [
    { id: 'grass', tile: T.GRASS, name: 'Grass', desc: 'The surface. Ants walk across it; rain pools on it.' },
    { id: 'dirt', tile: T.DIRT, name: 'Dirt', desc: 'Soft earth. Builders dig it out to make tunnels; each tile dug gives one dirt for repairs.' },
    { id: 'root', tile: T.ROOT, name: 'Root mat', desc: 'Roots just under the grass. Diggable, like dirt.' },
    { id: 'stone', tile: T.STONE, name: 'Stone', desc: 'Bedrock and surface pebbles. Nothing can dig through it.' },
    { id: 'tunnel', icon: 'tunnel', name: 'Tunnel', desc: 'Open space the colony has dug, or a natural cave. Ants walk its floors and climb its walls.' },
    { id: 'sky', icon: 'sky', name: 'Open air', desc: 'Above ground. Food grows and falls here; raiders arrive across it.' },
    { id: 'wood', tile: T.WOOD, name: 'Twig wall', desc: 'Raised by builders to choke a tunnel during a raid. Holds 3 bites; raiders chew through it.' },
    { id: 'thatch', tile: T.THATCH, name: 'Leaf dam', desc: 'Packed leaves that keep rain out of a shaft. Holds 3 bites.' },
    { id: 'cracked', icon: 'cracked', name: 'Cracked wall', desc: 'A damaged wall or dam. Click it and a builder will come and patch it with dirt.' },
    { id: 'water', icon: 'water', name: 'Water', desc: 'Rain runs down open shafts and pools. Ants slow down in it, and deep water drowns them.' },
    { id: 'sand', icon: 'sand', name: 'Sand', desc: 'Blown in by sandstorms. Slows ants down until builders clear it.' }
  ];

  var ITEMS = [
    { id: 'berry', food: 'berry', name: 'Berry', desc: 'Grows on bushes and falls from above.' },
    { id: 'seed', food: 'seed', name: 'Seed', desc: 'Shaken loose from grass and stones.' },
    { id: 'crumb', food: 'crumb', name: 'Crumb', desc: 'A scrap of something tasty.' },
    { id: 'leaf', food: 'leaf', name: 'Leaf', desc: 'Drifts down on the wind. Food, and a leaf for building dams.' },
    { id: 'bigleaf', food: 'bigleaf', name: 'Big leaf', desc: 'A generous meal, and a leaf for building dams.' },
    { id: 'twig', food: 'twig', name: 'Twig', desc: 'A little food, and a twig for building walls.' },
    { id: 'feather', food: 'feather', name: 'Feather', desc: 'Barely edible, but it counts as a twig for building.' },
    { id: 'egg', special: 'egg', name: 'Egg', desc: 'Costs 2 food. Hatches in 30 seconds, sooner with nurses beside it.' },
    { id: 'granary', special: 'granary', name: 'Granary', desc: 'The colony\'s food store on the chamber floor. Eggs and healing are paid from it.' },
    { id: 'bush', node: 'bush', name: 'Berry bush', desc: 'Drops a berry every 11 to 24 seconds (slower at night).' },
    { id: 'stones', node: 'stones', name: 'Seed stones', desc: 'Seeds collect between these stones.' },
    { id: 'log', node: 'log', name: 'Fallen log', desc: 'Sheds twigs.' },
    { id: 'crumbs', node: 'crumbs', name: 'Crumb pile', desc: 'Someone\'s picnic. Drops crumbs.' }
  ];

  var EVENTS = [
    { id: 'raid', name: 'Raid', icon: 'raider', desc: 'Enemy ants arrive from the surface. A warning comes about 14 seconds ahead. Press DEFEND to rally the whole colony around the queen.' },
    { id: 'rain', name: 'Rain', icon: 'water', desc: 'Water pours down open shafts. Builders dam the leaks with leaves.' },
    { id: 'sandstorm', name: 'Sandstorm', icon: 'sand', desc: 'Sand fills the tunnels and slows everyone until it is cleared.' },
    { id: 'debris', name: 'Falling debris', icon: 'leaf', desc: 'Leaves, twigs, seeds and berries drift down. Free food for quick gatherers.' },
    { id: 'night', name: 'Night', icon: 'sky', desc: 'Every 150 seconds the sun sets. Food grows more slowly in the dark.' },
    { id: 'heal', name: 'Healing', icon: 'granary', desc: 'Wounded ants go home and eat: 3 food restores 2 HP.' }
  ];

  var STATES = {
    idle: 'Deciding what to do', rest: 'Resting near the queen', out: 'Heading outside',
    surface: 'Foraging on the surface', toFood: 'Fetching food', toHome: 'Carrying food home',
    toEat: 'Going home to eat', toJob: 'Off to a job', work: 'Working', toEgg: 'Going to an egg',
    nurse: 'Tending an egg', patrol: 'Patrolling', guard: 'Standing guard', fight: 'Fighting',
    defend: 'Defending the queen', march: 'Marching on the queen', sneak: 'Sneaking to the granary',
    flee: 'Escaping with stolen food'
  };

  var JOBS = { dig: 'digging', room: 'carving a room', build: 'building', repair: 'repairing', clear: 'clearing sand' };

  function find(list, key, val) {
    for (var i = 0; i < list.length; i++) if (list[i][key] === val) return list[i];
    return null;
  }

  global.CATALOG = {
    ANTS: ANTS, BLOCKS: BLOCKS, ITEMS: ITEMS, EVENTS: EVENTS, STATES: STATES, JOBS: JOBS,
    ant: function (role) { return find(ANTS, 'role', role); },
    tile: function (t) { return find(BLOCKS, 'tile', t); },
    block: function (id) { return find(BLOCKS, 'id', id); },
    food: function (kind) { return find(ITEMS, 'food', kind); },
    node: function (kind) { return find(ITEMS, 'node', kind); },
    item: function (id) { return find(ITEMS, 'id', id); }
  };
})(window);
