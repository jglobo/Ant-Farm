/* multi-seed validation: does a colony survive, and does the loop close?
     node tools/validate.js [runs] [seconds] */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const RUNS = Number(process.argv[2] || 8);
const SECS = Number(process.argv[3] || 420);
const smoke = path.join(__dirname, 'smoke.js');

let crash = 0, queenDied = 0, grew = 0, food = 0, built = 0, dug = 0, gathered = 0;
const rows = [];

for (let i = 0; i < RUNS; i++) {
  const seed = 1000 + i * 7717;
  let out = '';
  try {
    out = execFileSync(process.execPath, [smoke, String(SECS)], {
      env: Object.assign({}, process.env, { SEED: String(seed) }),
      encoding: 'utf8'
    });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  const num = (label) => {
    const m = out.match(new RegExp(label + '\\s*:\\s*([0-9]+)', 'm'));
    return m ? Number(m[1]) : 0;
  };
  const errs = (out.match(/runtime errors: (\d+)/) || [0, 0])[1] * 1;
  const peak = num('peak ants');
  const f = num('^food');
  // smoke prints "tunnels / wood : 180 / 2 (thatch 0)"
  const twm = out.match(/tunnels \/ wood\s*:\s*([0-9]+)\s*\/\s*([0-9]+)\s*\(thatch ([0-9]+)\)/);
  const t = twm ? Number(twm[1]) : 0;
  const w = twm ? Number(twm[2]) + Number(twm[3]) : 0;
  const g = (out.match(/"gathered":([0-9]+)/) || [0, 0])[1] * 1;
  const phase = (out.match(/phase\s+: (\w+)/) || [0, '?'])[1];
  const qhp = (out.match(/queen HP\s+: ([0-9.]+)/) || [0, 0])[1];
  if (errs > 0) crash++;
  if (phase === 'over' || Number(qhp) <= 0) queenDied++;
  if (peak >= 4) grew++;
  if (f >= 4) food++;
  if (w > 0) built++;
  if (t > 150) dug++;
  gathered += g;
  rows.push('seed ' + String(seed).padEnd(6) + ' phase=' + String(phase).padEnd(5) +
    ' qhp=' + String(qhp).padStart(5) + ' peak=' + String(peak).padStart(2) +
    ' food=' + String(f).padStart(3) + ' tunnels=' + String(t).padStart(4) +
    ' wood=' + String(w).padStart(3) + ' gathered=' + String(g).padStart(3) + ' errors=' + errs);
}

console.log('runs: ' + RUNS + ' x ' + SECS + 's\n');
rows.forEach(r => console.log('  ' + r));
console.log('\ncrashed          : ' + crash + '/' + RUNS);
console.log('queen died       : ' + queenDied + '/' + RUNS);
console.log('colony grew (4+) : ' + grew + '/' + RUNS);
console.log('food buffer >=4  : ' + food + '/' + RUNS);
console.log('mined 150+ tiles : ' + dug + '/' + RUNS);
console.log('built a structure: ' + built + '/' + RUNS);
console.log('total food gathered: ' + gathered);
