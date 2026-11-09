// Loads content/**, and checks it against content/SCHEMA.md and against the files it points to.
// Used by verify-content.mjs (report) and build-content.mjs (refuses to build on errors).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NOT_CONTENT = new Set(['skills.json', 'single-terms.json', 'entries.json']);
const ORDINARY = new Set(['the', 'and', 'with', 'from', 'protein', 'enzyme', 'structure', 'figure', 'label', 'activity', 'site', 'active', 'binding', 'domain', 'model', 'complex', 'factor', 'chain', 'region', 'cell', 'dna', 'rna']);
export const MODULES = ['gem', 'bri'];

function jsonFiles(dir) {
  const full = join(ROOT, dir);
  return existsSync(full) ? readdirSync(full).filter((n) => n.endsWith('.json')).sort().map((n) => join(full, n)) : [];
}

export function pngSize(path) {
  const b = readFileSync(path);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

export function load() {
  const content = { labels: [], finds: [], facts: [], skills: {}, single: new Set(), entries: {}, files: [] };
  for (const path of jsonFiles('content/labels')) {
    const name = path.split(/[\\/]/).pop();
    if (name === 'skills.json') Object.assign(content.skills, readJson(path));
    else if (name === 'single-terms.json') for (const t of readJson(path)) content.single.add(String(t).toLowerCase());
    else for (const a of readJson(path).activities ?? []) content.labels.push({ ...a, kind: 'label', _file: name });
  }
  for (const path of jsonFiles('content/structures')) {
    const name = path.split(/[\\/]/).pop();
    if (name === 'skills.json') Object.assign(content.skills, readJson(path));
    else if (name === 'single-terms.json') for (const t of readJson(path)) content.single.add(String(t).toLowerCase());
    else if (name === 'entries.json') Object.assign(content.entries, readJson(path));
    else for (const a of readJson(path).activities ?? []) content.finds.push({ ...a, kind: 'find', _file: name });
  }
  for (const path of jsonFiles('content/facts')) for (const f of readJson(path).facts ?? []) content.facts.push({ ...f, _file: path.split(/[\\/]/).pop() });
  return content;
}

export function check(content) {
  const issues = [];
  const error = (where, msg) => issues.push({ level: 'error', where, msg });
  const warn = (where, msg) => issues.push({ level: 'warning', where, msg });
  const ids = new Set();
  const text = (where, field, value, max) => {
    if (typeof value !== 'string' || !value.trim()) error(where, `${field} is missing`);
    else if (value.length > max) error(where, `${field} is ${value.length} characters, at most ${max}`);
  };
  const common = (a, prefix) => {
    const where = a.id ?? `(${a._file})`;
    if (!ID.test(a.id ?? '') || a.id.length > 64) error(where, 'id must be kebab-case, at most 64 characters');
    else if (!a.id.startsWith(prefix)) error(where, `id must start with ${prefix}`);
    if (ids.has(a.id)) error(where, 'id is used twice');
    ids.add(a.id);
    if (!MODULES.includes(a.module)) error(where, `module must be one of ${MODULES.join(', ')}`);
    text(where, 'title', a.title, 90);
    text(where, 'summary', a.summary, 300);
    text(where, 'context', a.context, 1200);
    if (![1, 2, 3].includes(a.level)) error(where, 'level must be 1, 2 or 3');
    if (typeof a.minutes !== 'number' || a.minutes < 1 || a.minutes > 12) error(where, 'minutes must be 1 to 12');
    if (!Array.isArray(a.terms) || a.terms.length < 3 || a.terms.length > 12) error(where, 'terms must be 3 to 12 phrases');
    else for (const t of a.terms) {
      if (typeof t !== 'string' || !t.trim() || t.length > 80) { error(where, `bad term ${JSON.stringify(t)}`); continue; }
      const words = t.trim().split(/\s+/);
      if (words.length === 1 && !content.single.has(t.toLowerCase())) error(where, `term "${t}" is a single word that is not in single-terms.json`);
      if (words.length === 1 && ORDINARY.has(t.toLowerCase())) error(where, `term "${t}" is an ordinary word`);
    }
    if (!Array.isArray(a.skills) || !a.skills.length) error(where, 'skills needed');
    else for (const s of a.skills) if (!content.skills[s]) error(where, `skill "${s}" is not in a skills.json`);
    if (a.family !== undefined && !ID.test(a.family)) error(where, 'family must be kebab-case');
    if (a.cite !== undefined && !Array.isArray(a.cite)) error(where, 'cite must be a list');
  };

  for (const a of content.labels) {
    const where = a.id ?? a._file;
    common(a, 'sl-l-');
    const f = a.figure ?? {};
    for (const k of ['packet', 'file', 'src', 'alt', 'cite']) if (!f[k]) error(where, `figure.${k} is missing`);
    let size = null;
    if (f.src) {
      const p = join(ROOT, 'content', f.src);
      if (!existsSync(p)) error(where, `figure file content/${f.src} is missing`);
      else try { size = pngSize(p); } catch { warn(where, 'the figure is not a PNG; the build converts it'); }
    }
    const labels = a.labels ?? [];
    if (labels.length < 3 || labels.length > 10) error(where, `${labels.length} labels, need 3 to 10`);
    const seen = new Set();
    labels.forEach((l, i) => {
      const w = `${where}/${l.id ?? i}`;
      if (!/^b\d+$/.test(l.id ?? '') || seen.has(l.id)) error(w, 'label ids are b1, b2, ... and unique');
      seen.add(l.id);
      text(w, 'answer', l.answer, 120);
      if (!Array.isArray(l.accept)) error(w, 'accept must be a list');
      if (!Array.isArray(l.box) || l.box.length !== 4 || l.box.some((n) => typeof n !== 'number')) error(w, 'box must be [x, y, w, h]');
      else if (size && (l.box[0] < 0 || l.box[1] < 0 || l.box[0] + l.box[2] > size.width || l.box[1] + l.box[3] > size.height)) error(w, `box ${JSON.stringify(l.box)} leaves the ${size.width}x${size.height} image`);
      text(w, 'hint', l.hint, 400);
      text(w, 'why', l.why, 600);
      if (l.hint && l.answer && l.hint.toLowerCase().includes(l.answer.toLowerCase()) && l.answer.length > 3) error(w, 'the hint contains the answer');
    });
    for (const text of [a.context, f.alt]) for (const l of labels) if (text && l.answer && l.answer.length > 4 && text.toLowerCase().includes(l.answer.toLowerCase())) error(where, `context or alt gives away "${l.answer}"`);
  }

  for (const a of content.finds) {
    const where = a.id ?? a._file;
    common(a, 'sl-s-');
    const entry = content.entries[a.pdb];
    if (!entry) error(where, `pdb ${a.pdb} is not in entries.json`);
    else if (!existsSync(join(ROOT, 'content/structures/files', `${a.pdb.toLowerCase()}.cif`))) error(where, `content/structures/files/${a.pdb.toLowerCase()}.cif is missing`);
    const targets = a.targets ?? [];
    if (targets.length < 1 || targets.length > 4) error(where, `${targets.length} targets, need 1 to 4`);
    const seen = new Set();
    for (const t of targets) {
      const w = `${where}/${t.id}`;
      if (!/^t\d+$/.test(t.id ?? '') || seen.has(t.id)) error(w, 'target ids are t1, t2, ... and unique');
      seen.add(t.id);
      text(w, 'ask', t.ask, 200); text(w, 'name', t.name, 80); text(w, 'hint', t.hint, 400); text(w, 'why', t.why, 700); text(w, 'ref', t.ref, 900);
      if (!Array.isArray(t.select) || !t.select.length) error(w, 'select needs at least one selector');
      else for (const s of t.select) {
        if (!s.chain) error(w, 'selector without chain');
        if (s.resi !== undefined && !s.resn) error(w, 'a single residue selector needs resn');
      }
      if (!Array.isArray(t.cite) || !t.cite.length) warn(w, 'no cite');
    }
  }

  const activityIds = new Set([...content.labels, ...content.finds].map((a) => a.id));
  const factIds = new Set();
  for (const f of content.facts) {
    const w = f.id ?? f._file;
    if (!/^sl-f-[a-z0-9-]+$/.test(f.id ?? '')) error(w, 'fact id must start sl-f-');
    if (factIds.has(f.id)) error(w, 'fact id used twice');
    factIds.add(f.id);
    text(w, 'statement', f.statement, 2000); text(w, 'concept', f.concept, 240);
    if (!Array.isArray(f.unlockedBy) || !f.unlockedBy.length) error(w, 'unlockedBy needs at least one activity');
    else for (const u of f.unlockedBy) if (!activityIds.has(u)) error(w, `unlockedBy names ${u}, which is not an activity`);
    const qs = f.questions ?? [];
    if (qs.length < 1 || qs.length > 2) error(w, 'each fact has 1 or 2 questions');
    for (const q of qs) {
      const qw = `${w}/${q.id}`;
      if (![1, 2, 3, 4, 5].includes(q.level)) error(qw, 'level 1 to 5');
      if (!['choice', 'typed', 'order'].includes(q.format)) error(qw, 'format');
      text(qw, 'prompt', q.prompt, 2000); text(qw, 'answer', q.answer, 4000);
      if (q.format === 'typed' && !(q.marks?.length >= 2)) warn(qw, 'a typed question wants 2 to 4 marks');
      if (q.format === 'choice' && !(q.options?.length >= 2 && q.options.some((o) => o.correct))) error(qw, 'a choice question needs options, one correct');
    }
  }
  if (content.labels.length < 20) warn('pack', `only ${content.labels.length} label activities (20 wanted)`);
  if (content.finds.length < 20) warn('pack', `only ${content.finds.length} find activities (20 wanted)`);
  if (content.facts.length < 30) warn('pack', `only ${content.facts.length} facts (30 wanted)`);
  return issues;
}

export const fileSize = (path) => statSync(path).size;
