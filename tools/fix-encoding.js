/* one-off: repair any remaining mangled comment terminators */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
let n = 0;
for (const d of ['js', 'tools']) {
  const full = path.join(dir, d);
  for (const f of fs.readdirSync(full)) {
    if (!f.endsWith('.js')) continue;
    const p = path.join(full, f);
    let text = fs.readFileSync(p, 'utf8');
    const before = text;
    // "... */" doubled up, or a banner line collapsed onto a code line
    text = text.replace(/\*\/\s*\*\//g, '*/');
    text = text.replace(/\*\/\*([^\n]*)/g, (m, rest) => '*/' + rest);
    if (text !== before) { fs.writeFileSync(p, text); console.log('repaired ' + d + '/' + f); n++; }
  }
}
console.log(n ? 'done (' + n + ' files)' : 'nothing to repair');
