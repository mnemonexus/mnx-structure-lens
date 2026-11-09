// One-off helper: writes the expected one-letter `seq` into any run selector (chain/from/to) that has none,
// reading the sequence from the structure file. Review the result: verify-structures.mjs then guards it.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oneLetter, readStructure, selectorResidues } from './structure-lib.mjs';
const DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'content', 'structures');
for (const f of ['gem.json', 'bri.json']) {
  const doc = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  let n = 0;
  for (const a of doc.activities) {
    const s = readStructure(join(DIR, 'files', `${a.pdb.toLowerCase()}.cif`));
    for (const t of a.targets) for (const sel of t.select) {
      if (sel.from !== undefined && sel.seq === undefined) { sel.seq = selectorResidues(s, sel).map((r) => oneLetter(r.resn)).join(''); n++; }
    }
  }
  writeFileSync(join(DIR, f), JSON.stringify(doc, null, 2) + '\n');
  console.log(f, 'filled', n);
}
