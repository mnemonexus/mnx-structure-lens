// Checks content/facts/structures.json with the kit's own catalogue validator, and that every `unlockedBy` is a find activity here.
// (The pack build checks the merged catalogue again with the label activities.)
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = process.env.MNX_KIT || resolve(ROOT, '..', 'mnx-addon-kit-release');
const { validatePracticeCatalogue } = await import(pathToFileURL(join(KIT, 'sdk', 'src', 'practice.mjs')).href);
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const acts = [...read('content/structures/gem.json').activities, ...read('content/structures/bri.json').activities];
const facts = read('content/facts/structures.json').facts;
const skills = { x: { label: 'x' } };
validatePracticeCatalogue({ version: 1, skills, activities: acts.map((a) => ({ id: a.id, title: a.title, minutes: a.minutes, level: a.level, terms: a.terms, skills: ['x'], surfaces: ['study'] })), knowledge: facts });
const used = new Set(); let errors = 0;
for (const f of facts) {
  if (!f.id.startsWith('sl-f-')) { console.log('ERROR id prefix', f.id); errors++; }
  if (!f.questions?.length || f.questions.length > 2) { console.log('ERROR questions 1-2:', f.id); errors++; }
  for (const u of f.unlockedBy ?? []) used.add(u);
  for (const q of f.questions ?? []) {
    if (q.format === 'typed' && (q.marks?.length ?? 0) < 2) { console.log('ERROR typed needs 2+ marks', f.id, q.id); errors++; }
    if (q.format === 'choice' && (!q.options || q.options.filter((o) => o.correct).length !== 1 || q.options.every((o) => o.text !== q.answer))) { console.log('ERROR choice options', f.id, q.id); errors++; }
    if (q.format === 'order' && (q.steps?.length ?? 0) < 3) { console.log('ERROR order steps', f.id, q.id); errors++; }
    for (const m of q.marks ?? []) if (m.accept.some((a) => a !== a.toLowerCase())) { console.log('ERROR accept must be lower case', f.id, q.id, m.id); errors++; }
  }
}
const missing = acts.filter((a) => !used.has(a.id)).map((a) => a.id);
console.log(`${facts.length} facts, ${facts.reduce((n, f) => n + f.questions.length, 0)} questions, unlock ${used.size}/${acts.length} activities${missing.length ? '; not unlocking a fact: ' + missing.join(', ') : ''}`);
process.exitCode = errors ? 1 : 0;
