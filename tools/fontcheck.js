/* render the bitmap font as ASCII art to verify glyphs
   node tools/fontcheck.js "PAUSED" */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'pixel.js'), 'utf8');
const m = /var GLYPHS = \{([\s\S]*?)\n  \};/.exec(src);
if (!m) { console.error('could not find GLYPHS'); process.exit(1); }

const FONT = {};
for (const line of m[1].split('\n')) {
  const g = /^\s*'?([^':]+)'?\s*:\s*'([01 ]+)'/.exec(line);
  if (!g) continue;
  const rows = g[2].trim().split(/\s+/);
  const glyph = new Uint8Array(7);
  for (let y = 0; y < 7; y++) {
    let bits = 0;
    for (let x = 0; x < 5; x++) if (rows[y] && rows[y][x] === '1') bits |= (1 << x);
    glyph[y] = bits;
  }
  FONT[g[1].trim()] = glyph;
}

const text = (process.argv[2] || 'PAUSED').toUpperCase();
const grid = [];
for (let y = 0; y < 7; y++) grid.push([]);
for (const ch of text) {
  const g = FONT[ch] || FONT['?'];
  for (let y = 0; y < 7; y++) {
    let row = '';
    for (let x = 0; x < 5; x++) row += (g[y] & (1 << x)) ? '#' : '.';
    grid[y].push(row);
  }
  for (let y = 0; y < 7; y++) grid[y].push('.');   // 1px gap
}
for (let y = 0; y < 7; y++) console.log(grid[y].join(' '));

// also print every glyph so any mis-shaped letter is obvious
if (process.argv[3] === 'all') {
  console.log('\nall glyphs:');
  const keys = Object.keys(FONT);
  for (let i = 0; i < keys.length; i += 20) {
    const chunk = keys.slice(i, i + 20);
    const rows = [[], [], [], [], [], [], [], []];
    for (const k of chunk) {
      const g = FONT[k];
      for (let y = 0; y < 7; y++) {
        let r = '';
        for (let x = 0; x < 5; x++) r += (g[y] & (1 << x)) ? '#' : '.';
        rows[y].push(r);
      }
    }
    for (let y = 0; y < 7; y++) console.log(rows[y].join(' '));
    console.log(' '.repeat(chunk.length * 4 - 1) + '');
    console.log(chunk.map(k => k.padStart(5)).join(' '));
    console.log('');
  }
}
