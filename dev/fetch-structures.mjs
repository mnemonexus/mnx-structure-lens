// Downloads every PDB id named in content/structures/entries.json that is not yet in content/structures/files/,
// exactly as RCSB serves it (mmCIF). Prints sizes.   node dev/fetch-structures.mjs
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(ROOT, 'content', 'structures', 'files');
mkdirSync(dir, { recursive: true });
const entries = JSON.parse(readFileSync(join(ROOT, 'content', 'structures', 'entries.json'), 'utf8'));
let total = 0;
for (const id of Object.keys(entries)) {
  const file = join(dir, `${id.toLowerCase()}.cif`);
  if (!existsSync(file)) {
    const res = await fetch(`https://files.rcsb.org/download/${id.toUpperCase()}.cif`);
    if (!res.ok) { console.error(`${id}: HTTP ${res.status}`); process.exitCode = 1; continue; }
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log(`${id}: downloaded`);
  }
  const size = statSync(file).size;
  total += size;
  console.log(`${id.padEnd(5)} ${(size / 1048576).toFixed(2)} MB`);
}
console.log(`total ${(total / 1048576).toFixed(1)} MB in ${Object.keys(entries).length} files`);
