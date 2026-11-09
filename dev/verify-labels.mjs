// Checks every label activity in content/labels/*.json against content/SCHEMA.md.
//   node dev/verify-labels.mjs        errors fail (exit 1), warnings are notes
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKETS = process.env.MNX_PACKETS || 'E:/MnemoNexus-data/claude-docs/packets';
const LABELS = join(ROOT, 'content', 'labels');
const issues = [];
const err = (where, msg) => issues.push({ level: 'error', where, msg });
const warn = (where, msg) => issues.push({ level: 'warning', where, msg });

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\u03b1-\u03c9]+/g, '');

const skills = existsSync(join(LABELS, 'skills.json')) ? readJson(join(LABELS, 'skills.json')) : {};
const singles = new Set((existsSync(join(LABELS, 'single-terms.json')) ? readJson(join(LABELS, 'single-terms.json')) : []).map((t) => t.toLowerCase()));

const packetCache = new Map();
function packet(num) {
  if (packetCache.has(num)) return packetCache.get(num);
  let info = null;
  if (existsSync(PACKETS)) {
    const dir = readdirSync(PACKETS).find((d) => d.startsWith(`${num}-`));
    if (dir) {
      const keys = new Set();
      for (const f of ['lines.json', 'figures.json']) {
        const p = join(PACKETS, dir, f);
        if (existsSync(p)) for (const k of Object.keys(readJson(p))) keys.add(k);
      }
      info = { dir, keys };
    }
  }
  packetCache.set(num, info);
  return info;
}

function pngSize(path) {
  const b = readFileSync(path);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const files = readdirSync(LABELS).filter((f) => f.endsWith('.json') && !['skills.json', 'single-terms.json'].includes(f));
const seen = new Set();
let total = 0;
const perModule = {};
const images = new Set();
for (const file of files) {
  const doc = readJson(join(LABELS, file));
  for (const a of doc.activities ?? []) {
    total++;
    const at = a.id ?? `${file}#${total}`;
    perModule[a.module] = (perModule[a.module] ?? 0) + 1;
    if (!/^sl-l-[a-z0-9]+(-[a-z0-9]+)*$/.test(a.id ?? '') || a.id.length > 64) err(at, 'id must be kebab-case starting sl-l- and at most 64 characters');
    if (seen.has(a.id)) err(at, 'duplicate id');
    seen.add(a.id);
    if (!['gem', 'bri'].includes(a.module)) err(at, 'module must be gem or bri');
    if (!a.title || a.title.length > 90) err(at, 'title is 1 to 90 characters');
    if (!a.summary || a.summary.length > 300) err(at, 'summary is 1 to 300 characters');
    if (![1, 2, 3].includes(a.level)) err(at, 'level must be 1, 2 or 3');
    if (!(a.minutes >= 2 && a.minutes <= 8) && !(a.minutes >= 1 && a.minutes <= 8)) err(at, 'minutes must be 1 to 8');
    if (a.minutes < 2) warn(at, 'minutes under 2');
    if (!Array.isArray(a.terms) || a.terms.length < 3 || a.terms.length > 12) err(at, 'terms: 3 to 12');
    for (const t of a.terms ?? []) {
      if (t.trim().split(/\s+/).length < 2 && !singles.has(t.toLowerCase())) err(at, `term "${t}" is a single word that is not in single-terms.json`);
      if (t.length > 80) err(at, `term "${t}" is too long`);
    }
    for (const s of a.skills ?? []) if (!skills[s]) err(at, `skill "${s}" is not in skills.json`);
    if (!a.skills?.length) err(at, 'needs a skill');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.family ?? '')) err(at, 'family must be kebab-case');
    for (const c of a.cite ?? []) checkCite(at, c);
    if (!a.cite?.length) err(at, 'needs cite');

    const fig = a.figure ?? {};
    for (const f of ['packet', 'file', 'src', 'alt', 'cite']) if (!fig[f]) err(at, `figure.${f} missing`);
    const src = join(ROOT, 'content', fig.src ?? 'missing');
    let size = null;
    if (!existsSync(src)) err(at, `figure file ${fig.src} missing`);
    else size = pngSize(src);
    if (!size) err(at, 'figure is not a readable PNG');
    images.add(`${fig.packet}/${fig.file}`);
    for (const out of [`assets/fig/${a.id}.png`, `assets/fig/${a.id}-full.png`]) if (!existsSync(join(ROOT, out))) err(at, `${out} missing (run python dev/blank_figures.py)`);
    if (!a.context) err(at, 'context missing');

    const labels = a.labels ?? [];
    if (labels.length < 3 || labels.length > 10) err(at, `needs 3 to 10 labels, has ${labels.length}`);
    const boxes = [];
    const ids = new Set();
    labels.forEach((l, i) => {
      const w = `${at}/${l.id ?? i}`;
      if (l.id !== `b${i + 1}`) err(w, `label id should be b${i + 1}`);
      if (ids.has(l.id)) err(w, 'duplicate label id');
      ids.add(l.id);
      if (!l.answer) err(w, 'answer missing');
      if (!Array.isArray(l.accept) || !l.accept.some((x) => norm(x) === norm(l.answer))) err(w, 'accept must include the answer');
      if (!l.hint) err(w, 'hint missing');
      if (!l.why) err(w, 'why missing');
      if (norm(l.hint ?? '').includes(norm(l.answer ?? '')) && norm(l.answer ?? '').length >= 4) err(w, 'hint contains the answer');
      if (!l.cite?.length) err(w, 'cite missing');
      for (const c of l.cite ?? []) checkCite(w, c);
      checkBox(w, l.box, size);
      boxes.push({ w, box: l.box });
    });
    for (const [i, c] of (a.cover ?? []).entries()) checkBox(`${at}/cover${i}`, c, size);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [x1, y1, w1, h1] = boxes[i].box ?? []; const [x2, y2, w2, h2] = boxes[j].box ?? [];
      if (x1 < x2 + w2 && x2 < x1 + w1 && y1 < y2 + h2 && y2 < y1 + h1) err(at, `boxes ${i + 1} and ${j + 1} overlap`);
    }
    // alt and context must not give a label away (answers of 4+ characters, as whole words)
    const given = `${a.summary ?? ''} ${fig.alt ?? ''} ${a.context ?? ''}`.toLowerCase();
    for (const l of labels) {
      const ans = String(l.answer ?? '').toLowerCase();
      if (ans.length >= 5 && new RegExp(`(^|[^a-z0-9])${ans.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(given)) err(`${at}/${l.id}`, `summary, alt or context contains the answer "${l.answer}"`);
    }
    for (const b of a.bank ?? []) if (labels.some((l) => norm(l.answer) === norm(b))) err(at, `bank item "${b}" is also an answer`);
  }
}

function checkBox(where, box, size) {
  if (!Array.isArray(box) || box.length !== 4 || box.some((v) => !Number.isInteger(v))) return err(where, 'box must be [x, y, w, h] of integers');
  const [x, y, w, h] = box;
  if (w < 8 || h < 8) err(where, 'box is tiny');
  if (size && (x < 0 || y < 0 || x + w > size.w || y + h > size.h)) err(where, `box ${JSON.stringify(box)} is outside the ${size.w}x${size.h} image`);
}

function checkCite(where, cite) {
  const m = /^(\d{3}):(.+)$/.exec(cite);
  if (!m) return err(where, `cite "${cite}" is not <packet>:<line id>`);
  const p = packet(m[1]);
  if (!p) return warn(where, `packet ${m[1]} not found (is ${PACKETS} available?)`);
  if (!p.keys.has(m[2])) err(where, `cite "${cite}" is not a line or figure in packet ${m[1]}`);
}

console.log(`checked ${total} label activities (${Object.entries(perModule).map(([k, v]) => `${k} ${v}`).join(', ')}), ${images.size} different source images`);
for (const i of issues) console.log(`${i.level === 'error' ? 'ERROR  ' : 'warning'} ${i.where}: ${i.msg}`);
const errors = issues.filter((i) => i.level === 'error').length;
console.log(errors ? `${errors} error(s)` : 'no errors');
process.exit(errors ? 1 : 0);
