// A small mmCIF `_atom_site` reader. It uses the same ids 3Dmol's CIF reader gives the viewer:
// chain = auth_asym_id, resi = auth_seq_id, resn = auth_comp_id, atom = auth_atom_id (quotes stripped),
// and only the first model. Used by dev/verify-structures.mjs and importable by other dev scripts.
import { readFileSync } from 'node:fs';

const AA = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M',
  PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', MSE: 'M', A: 'A', C: 'C', G: 'G', U: 'U', T: 'T', DA: 'A', DC: 'C', DG: 'G', DT: 'T', DU: 'U',
};
export const oneLetter = (resn) => AA[resn] ?? 'X';

/** Split one mmCIF data line into tokens (handles 'quoted' and "quoted" values). */
function tokens(line) {
  const out = [];
  const re = /'([^']*(?:'[^\s][^']*)*)'(?=\s|$)|"([^"]*)"(?=\s|$)|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Reads the _atom_site loop. Returns { atoms: [{group, chain, resi, icode, resn, atom, x, y, z, altloc, element, model}] }. */
export function readStructure(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const atoms = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== 'loop_') continue;
    const cols = [];
    let j = i + 1;
    while (j < lines.length && lines[j].startsWith('_')) { cols.push(lines[j].trim()); j++; }
    if (!cols.length || !cols[0].startsWith('_atom_site.')) { i = j - 1; continue; }
    const at = (name) => cols.indexOf(`_atom_site.${name}`);
    const c = {
      group: at('group_PDB'), chain: at('auth_asym_id'), lchain: at('label_asym_id'), resi: at('auth_seq_id'), resn: at('auth_comp_id'),
      atom: at('auth_atom_id'), latom: at('label_atom_id'), x: at('Cartn_x'), y: at('Cartn_y'), z: at('Cartn_z'), alt: at('label_alt_id'),
      model: at('pdbx_PDB_model_num'), icode: at('pdbx_PDB_ins_code'), el: at('type_symbol'), lresn: at('label_comp_id'), bfac: at('B_iso_or_equiv'),
    };
    let firstModel = null;
    for (; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim() || line.startsWith('#') || line.startsWith('loop_') || line.startsWith('_') || line.startsWith('data_')) break;
      const t = tokens(line);
      if (t.length < cols.length) continue;
      const model = c.model >= 0 ? t[c.model] : '1';
      if (firstModel === null) firstModel = model;
      if (model !== firstModel) continue;
      atoms.push({
        group: t[c.group], chain: t[c.chain >= 0 ? c.chain : c.lchain], lchain: t[c.lchain], resi: parseInt(t[c.resi >= 0 ? c.resi : at('label_seq_id')], 10),
        icode: c.icode >= 0 && t[c.icode] !== '?' ? t[c.icode] : '', resn: (t[c.resn >= 0 ? c.resn : c.lresn] ?? '').trim(),
        atom: (t[c.atom >= 0 ? c.atom : c.latom] ?? '').replace(/"/g, ''), x: +t[c.x], y: +t[c.y], z: +t[c.z], altloc: c.alt >= 0 ? t[c.alt] : '.',
        element: t[c.el], bfac: +t[c.bfac],
      });
    }
    break;
  }
  if (!atoms.length) throw new Error(`${path}: no _atom_site rows found`);
  return { atoms };
}

/** One entry per residue (chain + number + insertion code), in file order. */
export function residues(structure) {
  const map = new Map();
  for (const a of structure.atoms) {
    const key = `${a.chain}|${a.resi}|${a.icode}`;
    let r = map.get(key);
    if (!r) { r = { chain: a.chain, resi: a.resi, icode: a.icode, resn: a.resn, hetero: a.group === 'HETATM', atoms: [] }; map.set(key, r); }
    r.atoms.push(a);
  }
  return [...map.values()];
}

/** The residues a selector names, in order: {chain, resi, resn?} | {chain, from, to} | {chain}. */
export function selectorResidues(structure, selector) {
  const all = residues(structure).filter((r) => r.chain === selector.chain);
  if (selector.resi !== undefined) return all.filter((r) => r.resi === selector.resi);
  if (selector.from !== undefined) return all.filter((r) => r.resi >= selector.from && r.resi <= selector.to);
  return all;
}

/** The atoms a selector names (honours `atoms`), so a viewer or script can find where a feature sits. */
export function selectorAtoms(structure, selector) {
  const out = [];
  for (const r of selectorResidues(structure, selector)) {
    for (const a of r.atoms) if (!selector.atoms || selector.atoms.includes(a.atom)) out.push(a);
  }
  return out;
}

export function centroid(atoms) {
  const n = atoms.length || 1;
  return atoms.reduce((s, a) => [s[0] + a.x / n, s[1] + a.y / n, s[2] + a.z / n], [0, 0, 0]);
}
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const atomOf = (structure, chain, resi, name) => structure.atoms.find((a) => a.chain === chain && a.resi === resi && a.atom === name && (a.altloc === '.' || a.altloc === 'A'));
