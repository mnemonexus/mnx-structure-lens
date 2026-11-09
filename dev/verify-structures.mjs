// Checks every `find` activity in content/structures/*.json against content/SCHEMA.md and, above all, against the
// structure files themselves: chain, residue number, residue name, run sequence and atoms of every selector.
//   node dev/verify-structures.mjs            (prints one line per target; exits 1 on any error)
//   node dev/verify-structures.mjs --quiet    (only problems and the totals)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { centroid, oneLetter, readStructure, residues, selectorResidues } from './structure-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'content', 'structures');
const PACKETS = process.env.MNX_PACKETS || 'E:/MnemoNexus-data/claude-docs/packets';
const quiet = process.argv.includes('--quiet');

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const entries = read(join(DIR, 'entries.json'));
const skills = existsSync(join(DIR, 'skills.json')) ? read(join(DIR, 'skills.json')) : {};
const singleTerms = new Set((existsSync(join(DIR, 'single-terms.json')) ? read(join(DIR, 'single-terms.json')) : []).map((t) => t.toLowerCase()));

// ---- entries and files ----------------------------------------------------------------------------------------------
const structures = new Map();
function structureFor(pdb) {
  if (structures.has(pdb)) return structures.get(pdb);
  const file = join(DIR, 'files', `${pdb.toLowerCase()}.cif`);
  if (!existsSync(file)) { structures.set(pdb, null); return null; }
  const s = readStructure(file);
  s.res = residues(s);
  s.bytes = statSync(file).size;
  structures.set(pdb, s);
  return s;
}
for (const [pdb, e] of Object.entries(entries)) {
  const where = `entries.${pdb}`;
  for (const k of ['title', 'organism', 'method', 'citation', 'chains', 'source']) if (!e[k]) err(where, `missing ${k}`);
  const s = structureFor(pdb);
  if (!s) { err(where, `files/${pdb.toLowerCase()}.cif is missing (run node dev/fetch-structures.mjs)`); continue; }
  const present = new Set(s.atoms.map((a) => a.chain));
  for (const c of Object.keys(e.chains ?? {})) if (!present.has(c)) err(where, `chain ${c} is listed but not in the file`);
  const waters = s.atoms.filter((a) => a.resn === 'HOH').length;
  console.log(`${pdb.padEnd(5)} ${(s.bytes / 1048576).toFixed(2).padStart(6)} MB  ${String(s.atoms.length).padStart(6)} atoms (${waters} water)  chains ${[...present].join('')}  ${e.title}`);
}

// ---- packet citations -----------------------------------------------------------------------------------------------
const packetKeys = new Map();
function citeOk(cite) {
  const m = /^(\d{3}):(.+)$/.exec(cite);
  if (!m) return false;
  if (!packetKeys.has(m[1])) {
    const dir = existsSync(PACKETS) ? readdirSync(PACKETS).find((d) => d.startsWith(`${m[1]}-`)) : null;
    let keys = null;
    if (dir) {
      keys = new Set(Object.keys(read(join(PACKETS, dir, 'lines.json'))));
      for (const k of Object.keys(read(join(PACKETS, dir, 'figures.json')))) keys.add(k);
    }
    packetKeys.set(m[1], keys);
  }
  const keys = packetKeys.get(m[1]);
  return keys ? keys.has(m[2]) : null;
}

// ---- selectors ------------------------------------------------------------------------------------------------------
const seqOf = (rs) => rs.map((r) => oneLetter(r.resn)).join('');
function checkSelector(where, s, sel, out) {
  const rs = selectorResidues(s, sel);
  if (!rs.length) { err(where, `selector ${JSON.stringify(sel)} matches no residue`); return []; }
  if (sel.resi !== undefined) {
    if (!sel.resn) err(where, `selector ${JSON.stringify(sel)} needs resn`);
    else if (rs[0].resn !== sel.resn) err(where, `chain ${sel.chain} ${sel.resi} is ${rs[0].resn} in the file, not ${sel.resn}`);
    if (rs.length > 1) err(where, `${sel.chain}${sel.resi} is ambiguous (${rs.length} residues; insertion codes?)`);
  } else if (sel.from !== undefined) {
    if (rs[0].resi !== sel.from) warn(where, `run ${sel.chain}:${sel.from}-${sel.to} starts at ${rs[0].resi} in the file`);
    if (rs.at(-1).resi !== sel.to) warn(where, `run ${sel.chain}:${sel.from}-${sel.to} ends at ${rs.at(-1).resi} in the file`);
    if (sel.seq !== undefined && sel.seq !== seqOf(rs)) err(where, `run ${sel.chain}:${sel.from}-${sel.to} reads ${seqOf(rs)} in the file, not ${sel.seq}`);
    if (sel.seq === undefined) warn(where, `run ${sel.chain}:${sel.from}-${sel.to} has no seq (file reads ${seqOf(rs)})`);
    if (sel.resn && rs.some((r) => r.resn !== sel.resn)) err(where, `run ${sel.chain}:${sel.from}-${sel.to} is not all ${sel.resn}`);
  }
  if (sel.atoms) {
    for (const r of rs) for (const name of sel.atoms) if (!r.atoms.some((a) => a.atom === name)) err(where, `${sel.chain}${r.resi} ${r.resn} has no atom ${name}`);
  }
  out.push(...rs);
  return rs;
}
const describe = (rs) => {
  if (rs.length <= 3) return rs.map((r) => `${r.chain}:${r.resn}${r.resi}`).join(' ');
  return `${rs[0].chain}:${rs[0].resn}${rs[0].resi}..${rs.at(-1).resn}${rs.at(-1).resi} (${rs.length} res)`;
};

// ---- activities -----------------------------------------------------------------------------------------------------
const ids = new Set();
let activityCount = 0; let targetCount = 0;
const perModule = {};
for (const file of readdirSync(DIR).filter((f) => /^(gem|bri)\.json$/.test(f))) {
  const module = file.replace('.json', '');
  const activities = read(join(DIR, file)).activities ?? [];
  for (const a of activities) {
    activityCount++; perModule[module] = (perModule[module] ?? 0) + 1;
    const where = a.id ?? `${file}#${activityCount}`;
    if (!/^sl-s-[a-z0-9]+(-[a-z0-9]+)*$/.test(a.id ?? '') || a.id.length > 64) err(where, 'id must be kebab-case, start sl-s-, at most 64 characters');
    if (ids.has(a.id)) err(where, 'duplicate id'); ids.add(a.id);
    if (a.module !== module) err(where, `module ${a.module} in ${file}`);
    if (!a.title || a.title.length > 90) err(where, 'title missing or over 90 characters');
    if (!a.summary || a.summary.length > 300) err(where, 'summary missing or over 300 characters');
    if (![1, 2, 3].includes(a.level)) err(where, 'level must be 1, 2 or 3');
    if (!(a.minutes >= 2 && a.minutes <= 8)) err(where, 'minutes must be 2 to 8');
    if (!a.family || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.family)) err(where, 'family must be kebab-case');
    if (!Array.isArray(a.terms) || a.terms.length < 3 || a.terms.length > 12) err(where, 'terms must be 3 to 12 phrases');
    for (const t of a.terms ?? []) {
      if (!/\s/.test(t.trim()) && !singleTerms.has(t.trim().toLowerCase())) err(where, `term "${t}" is one word and not in single-terms.json`);
      if (t.length > 80) err(where, `term "${t}" is too long`);
    }
    if (!a.skills?.length) err(where, 'needs skills');
    for (const sk of a.skills ?? []) if (!skills[sk]) err(where, `skill ${sk} is not in skills.json`);
    if (!a.context) err(where, 'needs context');
    for (const c of a.cite ?? []) { const ok = citeOk(c); if (ok === false) err(where, `cite ${c} is not a line or figure of that packet`); else if (ok === null) warn(where, `cite ${c}: packet not found`); }
    if (!a.cite?.length) err(where, 'needs cite');

    const entry = entries[a.pdb];
    if (!entry) { err(where, `pdb ${a.pdb} is not in entries.json`); continue; }
    const s = structureFor(a.pdb);
    if (!s) continue;
    const present = new Set(s.atoms.map((x) => x.chain));
    const shownSel = [];
    for (const sel of a.view?.show ?? []) { const rs = checkSelector(`${where} view.show`, s, sel, []); shownSel.push(...rs); }
    for (const c of a.view?.hide ?? []) if (!present.has(c)) err(where, `view.hide names chain ${c}, which is not in the file`);
    if (!a.targets?.length || a.targets.length > 4) err(where, 'needs 1 to 4 targets');
    const tids = new Set();
    for (const t of a.targets ?? []) {
      targetCount++;
      const tw = `${where}/${t.id}`;
      if (tids.has(t.id)) err(tw, 'duplicate target id'); tids.add(t.id);
      for (const k of ['ask', 'name', 'hint', 'why', 'ref']) if (!t[k] || !String(t[k]).trim()) err(tw, `missing ${k}`);
      if (!t.cite?.length) err(tw, 'missing cite');
      for (const c of t.cite ?? []) { const ok = citeOk(c); if (ok === false) err(tw, `cite ${c} is not a line or figure of that packet`); else if (ok === null) warn(tw, `cite ${c}: packet not found`); }
      if (!t.select?.length) { err(tw, 'missing select'); continue; }
      const found = [];
      for (const sel of t.select) checkSelector(tw, s, sel, found);
      // The question and the hint must not hand over the number or the residue name+number.
      const nums = new Set();
      for (const sel of t.select) for (const n of [sel.resi, sel.from, sel.to]) if (Number.isInteger(n) && n >= 10) nums.add(String(n));
      for (const n of nums) {
        if (new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(`${t.ask} ${t.hint}`)) err(tw, `ask/hint leaks the number ${n}`);
      }
      if (t.name && /\d/.test(t.name) && new RegExp(t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(t.ask)) err(tw, 'ask contains the target name');
      if (t.hint && t.hint.length > 400) warn(tw, 'hint is long');
      const hidden = new Set(a.view?.hide ?? []);
      if (found.length && found.every((r) => hidden.has(r.chain))) err(tw, 'every residue of this target is in a hidden chain');
      const atoms = found.flatMap((r) => r.atoms.filter((x) => !t.select.some((sel) => sel.atoms && selectorResidues(s, sel).includes(r)) || t.select.some((sel) => sel.atoms && selectorResidues(s, sel).includes(r) && sel.atoms.includes(x.atom))));
      const c = centroid(atoms.length ? atoms : found.flatMap((r) => r.atoms)).map((v) => v.toFixed(1)).join(', ');
      if (!quiet) console.log(`  ${a.id} / ${t.id}  ${describe(found)}  [${c}]  ${t.name}`);
    }
  }
}

console.log(`\n${activityCount} activities (${Object.entries(perModule).map(([k, v]) => `${k} ${v}`).join(', ')}), ${targetCount} targets, ${Object.keys(entries).length} structures`);
for (const w of warnings) console.log(`warning ${w}`);
for (const e of errors) console.log(`ERROR   ${e}`);
console.log(errors.length ? `\n${errors.length} error(s)` : '\nno errors');
process.exitCode = errors.length ? 1 : 0;
