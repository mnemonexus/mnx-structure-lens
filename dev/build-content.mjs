// Turns content/** into what the pack ships:
//   assets/practice/catalogue.json   the practice-v1 catalogue, with its knowledge facts (validated with the kit's own validator)
//   assets/content/labels.json       label activities in full
//   assets/content/structures.json   find activities in full, each with its entry
//   assets/fig/<id>.png, -full.png   the blanked and the original figure (written by dev/blank_figures.py)
//   assets/structures/<pdb>.cif      the structures, as RCSB serves them
//   assets/licenses/                 the 3Dmol notice
// and keeps manifest.json's `assets` list in step with those files.
//   node dev/build-content.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, check, load, pngSize } from './content-lib.mjs';

const KIT = process.env.MNX_KIT || join(ROOT, '..', 'mnx-addon-kit-release');
const { validatePracticeCatalogue } = await import(pathToFileURL(join(KIT, 'sdk', 'src', 'practice.mjs')).href);

const content = load();
const issues = check(content);
for (const i of issues) console.log(`${i.level === 'error' ? 'ERROR  ' : 'warning'} ${i.where}: ${i.msg}`);
if (issues.some((i) => i.level === 'error')) { console.error('\nContent has errors; nothing was built.'); process.exit(1); }

// The blanked figures come from the original figures and the boxes. Rebuild them every time: they are cheap.
const python = process.env.PYTHON || 'python';
if (content.labels.length) {
  const run = spawnSync(python, [join(ROOT, 'dev', 'blank_figures.py')], { cwd: ROOT, encoding: 'utf8' });
  if (run.status !== 0) { console.error(run.stdout, run.stderr); console.error('\nCould not blank the figures; nothing was built.'); process.exit(1); }
  console.log(run.stdout.trim().split('\n').slice(-1)[0]);
}

const out = join(ROOT, 'assets');
for (const sub of ['content', 'structures', 'licenses', 'practice']) rmSync(join(out, sub), { recursive: true, force: true });
for (const sub of ['content', 'structures', 'licenses', 'practice']) mkdirSync(join(out, sub), { recursive: true });

const PER_LABEL = 0.6;
const surfacesOf = (minutes) => (minutes <= 5 ? ['study', 'recall'] : ['study', 'planner']);
const citeList = (cites) => [...new Set(cites)].sort();
const catalogue = { version: 1, skills: {}, activities: [], knowledge: [] };
for (const a of [...content.labels, ...content.finds]) for (const s of a.skills) catalogue.skills[s] = { label: content.skills[s].label };

const labels = {};
for (const a of content.labels) {
  const blank = join(out, 'fig', `${a.id}.png`);
  const full = join(out, 'fig', `${a.id}-full.png`);
  if (!existsSync(blank) || !existsSync(full)) { console.error(`${a.id}: the blanked or full figure was not written`); process.exit(1); }
  const { width, height } = pngSize(blank);
  const source = pngSize(full);
  if (width !== source.width || height !== source.height) { console.error(`${a.id}: blank and full figure differ in size`); process.exit(1); }
  const { _file, ...rest } = a;
  labels[a.id] = { ...rest, figure: { src: `assets/fig/${a.id}.png`, full: `assets/fig/${a.id}-full.png`, width, height, alt: a.figure.alt, cite: a.figure.cite }, bank: a.bank ?? [], cite: a.cite ?? a.labels.flatMap((l) => l.cite ?? []) };
  catalogue.activities.push({
    id: a.id, title: a.title, summary: a.summary, minutes: a.minutes, level: a.level, terms: [...new Set(a.terms)], skills: a.skills, surfaces: surfacesOf(a.minutes),
    family: a.family ?? a.id.replace(/^sl-l-/, ''),
    launch: { a: a.id, k: 'label', m: a.module, n: a.labels.length, s: a.figure.cite, c: citeList(a.labels.flatMap((l) => l.cite ?? [])) },
  });
}

const finds = {};
const pdbUsed = new Set();
for (const a of content.finds) {
  const entry = content.entries[a.pdb];
  const { _file, ...rest } = a;
  pdbUsed.add(a.pdb);
  finds[a.id] = { ...rest, entry: { ...entry, file: `assets/structures/${a.pdb.toLowerCase()}.cif` }, cite: a.cite ?? a.targets.flatMap((t) => t.cite ?? []) };
  catalogue.activities.push({
    id: a.id, title: a.title, summary: a.summary, minutes: a.minutes, level: a.level, terms: [...new Set(a.terms)], skills: a.skills, surfaces: surfacesOf(a.minutes),
    family: a.family ?? a.id.replace(/^sl-s-/, ''),
    launch: { a: a.id, k: 'find', m: a.module, n: a.targets.length, s: `${a.pdb}: ${entry.title}`, c: citeList(a.targets.flatMap((t) => t.cite ?? [])) },
  });
}
for (const pdb of pdbUsed) copyFileSync(join(ROOT, 'content', 'structures', 'files', `${pdb.toLowerCase()}.cif`), join(out, 'structures', `${pdb.toLowerCase()}.cif`));
copyFileSync(join(ROOT, 'licenses', '3Dmol-LICENSE.txt'), join(out, 'licenses', '3Dmol-LICENSE.txt'));

for (const f of content.facts) {
  const { _file, ...rest } = f;
  catalogue.knowledge.push(rest);
}
validatePracticeCatalogue(catalogue);

writeFileSync(join(out, 'practice', 'catalogue.json'), JSON.stringify(catalogue));
writeFileSync(join(out, 'content', 'labels.json'), JSON.stringify({ version: 1, activities: labels }));
writeFileSync(join(out, 'content', 'structures.json'), JSON.stringify({ version: 1, activities: finds }));

// Manifest assets: catalogue, the two content files, every figure, every structure, the notice.
const manifestPath = join(ROOT, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const mimes = { '.json': 'application/json', '.png': 'image/png', '.cif': 'chemical/x-cif', '.txt': 'text/plain' };
const logical = ['assets/practice/catalogue.json', 'assets/content/labels.json', 'assets/content/structures.json'];
for (const dir of ['fig', 'structures', 'licenses']) for (const name of readdirSync(join(out, dir)).sort()) logical.push(`assets/${dir}/${name}`);
const wanted = new Set(logical);
for (const name of readdirSync(join(out, 'fig'))) {
  const id = name.replace(/(-full)?\.png$/, '');
  if (!labels[id]) { console.error(`assets/fig/${name} belongs to no label activity`); process.exit(1); }
}
manifest.assets = [...wanted].map((logicalPath) => ({ logicalPath, mimeType: mimes[logicalPath.slice(logicalPath.lastIndexOf('.'))] ?? 'application/octet-stream' }));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const bytes = (dir) => readdirSync(join(out, dir)).reduce((n, f) => n + statSync(join(out, dir, f)).size, 0);
const modules = {};
for (const a of [...content.labels, ...content.finds]) { const k = `${a.kind}/${a.module}`; modules[k] = (modules[k] ?? 0) + 1; }
console.log(`\nbuilt ${content.labels.length} label and ${content.finds.length} find activities (${Object.entries(modules).map(([k, v]) => `${k} ${v}`).join(', ')}), ${content.facts.length} facts, ${pdbUsed.size} structures (${(bytes('structures') / 1048576).toFixed(1)} MB), figures ${(bytes('fig') / 1048576).toFixed(1)} MB`);
