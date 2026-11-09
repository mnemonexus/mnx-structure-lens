/**
 * The 3D viewer: 3Dmol.js (BSD-3-Clause, bundled into the pack, no network), drawn into a WebGL canvas inside the frame.
 * 3Dmol's own click handling cannot see cartoon atoms, so a click is resolved here: every residue has a few
 * representative atoms (the alpha carbon, the phosphorus, or every atom of a ligand), they are projected to the screen,
 * and the nearest one wins, with the front-most breaking a tie. Everything is by AUTH chain and residue number, the same
 * ids dev/structure-lib.mjs verified.
 */
import * as lib from '3dmol';
import type { Residue } from './report';
import type { Selector } from './types';

type Atom = { serial: number; chain: string; resi: number; resn: string; atom: string; elem: string; hetflag: boolean; x: number; y: number; z: number };
interface Group { chain: string; resi: number; resn: string; kind: 'protein' | 'nucleic' | 'ligand' | 'ion'; atoms: Atom[]; rep: Atom[] }
export type MarkKind = 'click' | 'found' | 'shown';
interface Mark { kind: MarkKind; groups: Group[] }

const WATER = new Set(['HOH', 'WAT', 'DOD', 'H2O']);
const NUCLEIC = new Set(['A', 'C', 'G', 'U', 'T', 'I', 'DA', 'DC', 'DG', 'DT', 'DU', 'DI', 'N', 'DN']);
const MARK_COLOUR: Record<MarkKind, string> = { click: '#ffd21f', found: '#16c47f', shown: '#ff4d8d' };
const LABEL_TEXT: Record<MarkKind, string> = { click: '#111111', found: '#04210f', shown: '#2b0314' };
/** Warm tones for nucleic acids, so DNA and RNA never read as another protein chain. */
const NUCLEIC_TONES = ['#e0892b', '#c75fa3', '#d9a441', '#b8613f'];
const PICK_RADIUS = 16;

export interface ChainInfo { id: string; kind: 'protein' | 'nucleic' | 'ligand'; residues: number; colour: string }
export interface StructureView {
  chains: ChainInfo[];
  atomCount: number;
  onClick(handler: (residue: Residue | null) => void): void;
  mark(kind: MarkKind, residues: Residue[], text?: string): void;
  clearMarks(kind?: MarkKind): void;
  residuesOf(selectors: Selector[]): Residue[];
  focus(selectors: Selector[]): void;
  reset(): void;
  zoom(factor: number): void;
  setChainHidden(chain: string, hidden: boolean): void;
  isHidden(chain: string): boolean;
  restyle(): void;
  resize(): void;
  /** For tests: where a residue's picking atom is on the page, what a click at a point resolves to, and a turn about an axis. */
  screenOf(residue: Residue): { x: number; y: number } | null;
  pickAt(pageX: number, pageY: number): Residue | null;
  rotate(degrees: number, axis: 'x' | 'y'): void;
  destroy(): void;
}

export interface ViewOptions { text: string; hide?: string[]; show?: Selector[]; lighter?: boolean; reducedMotion?: boolean }

/** A CSS colour (a variable, a colour-mix) as #rrggbb, by letting the browser paint it. */
const swatch = (() => {
  let ctx: CanvasRenderingContext2D | null = null;
  return (css: string, fallback: string): string => {
    try {
      ctx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      if (!ctx) return fallback;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      if (a === 0) return fallback;
      return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    } catch { return fallback; }
  };
})();

function cssVar(name: string, fallback: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${name}, ${fallback})`;
  probe.style.display = 'none';
  document.body.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return swatch(resolved || fallback, fallback);
}

export function createStructureView(container: HTMLElement, options: ViewOptions): StructureView {
  const viewer = (lib as any).createViewer(container, { backgroundColor: cssVar('--mnx-surface-2', '#f1f5f9'), antialias: true });
  viewer.addModel(options.text, 'cif');
  const raw = viewer.selectedAtoms({}) as Atom[];

  // Index: residues, their kind and their picking atoms.
  const groups = new Map<string, Group>();
  const order: string[] = [];
  for (const atom of raw) {
    if (WATER.has(atom.resn) || atom.elem === 'H') continue;
    const key = `${atom.chain}:${atom.resi}:${atom.resn}`;
    let group = groups.get(key);
    if (!group) {
      group = { chain: atom.chain, resi: atom.resi, resn: atom.resn, kind: 'ligand', atoms: [], rep: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.atoms.push(atom);
  }
  for (const group of groups.values()) {
    const names = new Set(group.atoms.map((a) => a.atom));
    if (names.has('CA') && !group.atoms.every((a) => a.hetflag && a.resn !== 'MSE')) {
      group.kind = 'protein';
      group.rep = group.atoms.filter((a) => a.atom === 'CA');
    } else if (NUCLEIC.has(group.resn) || names.has('P') || names.has("C4'")) {
      group.kind = 'nucleic';
      group.rep = group.atoms.filter((a) => a.atom === 'P' || a.atom === "C4'");
      if (!group.rep.length) group.rep = group.atoms.slice(0, 1);
    } else {
      group.kind = group.atoms.length === 1 ? 'ion' : 'ligand';
      group.rep = group.atoms;
    }
  }
  const all = order.map((k) => groups.get(k) as Group);
  const byResidue = new Map<string, Group[]>();
  for (const g of all) { const k = `${g.chain}:${g.resi}`; (byResidue.get(k) ?? byResidue.set(k, []).get(k)!).push(g); }

  const chainIds: string[] = [];
  for (const g of all) if (!chainIds.includes(g.chain)) chainIds.push(g.chain);
  const chainKind = (id: string): ChainInfo['kind'] => {
    const mine = all.filter((g) => g.chain === id);
    if (mine.some((g) => g.kind === 'protein')) return 'protein';
    if (mine.some((g) => g.kind === 'nucleic')) return 'nucleic';
    return 'ligand';
  };

  const hidden = new Set(options.hide ?? []);
  const marks: Mark[] = [];
  const labels: any[] = [];
  const showGroups = resolve(options.show ?? []);
  let handler: ((r: Residue | null) => void) | null = null;
  let palette: string[] = [];
  const colourOf = new Map<string, string>();

  function resolve(selectors: Selector[]): Group[] {
    const out = new Set<Group>();
    for (const s of selectors) {
      for (const g of all) {
        if (g.chain !== s.chain) continue;
        if (s.resi !== undefined) { if (g.resi === s.resi && (!s.resn || g.resn === s.resn)) out.add(g); }
        else if (s.from !== undefined) { if (g.resi >= s.from && g.resi <= (s.to ?? s.from)) out.add(g); }
        else out.add(g);
      }
    }
    return [...out];
  }
  const toResidue = (g: Group): Residue => ({ chain: g.chain, resi: g.resi, resn: g.resn });

  function loadPalette() {
    palette = [];
    for (let i = 1; i <= 8; i++) palette.push(cssVar(`--mnx-data-${i}`, ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6', '#65a30d', '#e11d48'][i - 1]));
    colourOf.clear();
    let p = 0; let n = 0;
    for (const id of chainIds) {
      const kind = chainKind(id);
      colourOf.set(id, kind === 'nucleic' ? NUCLEIC_TONES[n++ % NUCLEIC_TONES.length] : palette[p++ % palette.length]);
    }
  }

  function serials(gs: Group[]): number[] { return gs.flatMap((g) => g.atoms.map((a) => a.serial)); }

  function restyle() {
    loadPalette();
    viewer.setBackgroundColor(cssVar('--mnx-surface-2', '#f1f5f9'), 1);
    viewer.setStyle({}, {});
    const lighter = options.lighter === true;
    for (const id of chainIds) {
      if (hidden.has(id)) continue;
      const colour = colourOf.get(id) as string;
      const kind = chainKind(id);
      if (kind === 'protein' || kind === 'nucleic') viewer.setStyle({ chain: id, hetflag: false }, { cartoon: { color: colour, thickness: lighter ? 0.25 : 0.4, style: lighter ? 'trace' : 'rectangle', tubes: lighter } });
      // Bound ligands, cofactors and ions are always drawn: they are part of what the learner is asked about.
      const bound = all.filter((g) => g.chain === id && (g.kind === 'ligand' || g.kind === 'ion'));
      const sticks = bound.filter((g) => g.kind === 'ligand');
      if (sticks.length) viewer.setStyle({ serial: serials(sticks) }, { stick: { radius: 0.18, colorscheme: { prop: 'elem', map: { C: colour, N: '#4f7bd9', O: '#e0554d', S: '#e0b92b', P: '#e0892b' } } } });
      const ions = bound.filter((g) => g.kind === 'ion');
      if (ions.length) viewer.setStyle({ serial: serials(ions) }, { sphere: { radius: 0.9, color: '#9aa0a6' } });
      // Modified residues and anything else with a cartoon already keep it; hetero protein residues get sticks so they are not lost.
    }
    const extra = showGroups.filter((g) => !hidden.has(g.chain));
    if (extra.length) viewer.addStyle({ serial: serials(extra) }, { stick: { radius: 0.22 } });
    viewer.removeAllLabels();
    labels.length = 0;
    for (const m of marks) {
      const gs = m.groups.filter((g) => !hidden.has(g.chain));
      if (!gs.length) continue;
      const colour = MARK_COLOUR[m.kind];
      if (gs.length <= 14) {
        viewer.addStyle({ serial: serials(gs) }, { stick: { radius: 0.28, color: colour } });
        for (const g of gs) viewer.addStyle({ serial: g.rep.map((a) => a.serial) }, { sphere: { radius: g.kind === 'protein' || g.kind === 'nucleic' ? 0.7 : 0.5, color: colour } });
      } else {
        viewer.addStyle({ serial: serials(gs) }, { cartoon: { color: colour, thickness: 0.55 } });
      }
    }
    viewer.render();
  }

  function addLabel(kind: MarkKind, g: Group, text: string) {
    const atom = g.rep[0] ?? g.atoms[0];
    viewer.addLabel(text, {
      position: { x: atom.x, y: atom.y, z: atom.z }, fontSize: 13, fontColor: LABEL_TEXT[kind], backgroundColor: MARK_COLOUR[kind], backgroundOpacity: 0.95,
      borderThickness: 0, inFront: true, showBackground: true, alignment: 'bottomLeft',
    });
    viewer.render();
  }

  // ── picking ────────────────────────────────────────────────────────────────
  const candidates: { g: Group; a: Atom }[] = [];
  for (const g of all) for (const a of g.rep) candidates.push({ g, a });

  function depthOf(view: number[], a: Atom): number {
    // View-space z of an atom: rotate (position + model offset) by the view quaternion. Larger is nearer the camera.
    const [px, py, pz, , qx, qy, qz, qw] = view;
    const vx = a.x + px; const vy = a.y + py; const vz = a.z + pz;
    const tx = 2 * (qy * vz - qz * vy); const ty = 2 * (qz * vx - qx * vz);
    return vz + qw * (2 * (qx * vy - qy * vx)) + (qx * ty - qy * tx);
  }

  function pickAt(pageX: number, pageY: number): Group | null {
    const live = candidates.filter((c) => !hidden.has(c.g.chain));
    if (!live.length) return null;
    const screen = viewer.modelToScreen(live.map((c) => c.a)) as { x: number; y: number }[];
    const view = viewer.getView() as number[];
    const near: { g: Group; d: number; z: number }[] = [];
    let best = Infinity;
    for (let i = 0; i < live.length; i++) {
      const dx = screen[i].x - pageX; const dy = screen[i].y - pageY;
      const d = Math.hypot(dx, dy);
      if (d > PICK_RADIUS) continue;
      near.push({ g: live[i].g, d, z: depthOf(view, live[i].a) });
      if (d < best) best = d;
    }
    if (!near.length) return null;
    const close = near.filter((n) => n.d <= best + 5);
    close.sort((a, b) => b.z - a.z);
    return close[0].g;
  }

  let down: { x: number; y: number; t: number } | null = null;
  const onDown = (e: PointerEvent) => { down = { x: e.pageX, y: e.pageY, t: performance.now() }; };
  const onUp = (e: PointerEvent) => {
    const start = down; down = null;
    if (!start || e.button > 0) return;
    if (Math.hypot(e.pageX - start.x, e.pageY - start.y) > 5 || performance.now() - start.t > 700) return;
    const hit = pickAt(e.pageX, e.pageY);
    handler?.(hit ? toResidue(hit) : null);
  };
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointerup', onUp);

  restyle();
  viewer.zoomTo();
  viewer.render();
  const observer = new ResizeObserver(() => { viewer.resize(); viewer.render(); });
  observer.observe(container);

  const self: StructureView = {
    chains: chainIds.map((id) => ({ id, kind: chainKind(id), residues: all.filter((g) => g.chain === id && g.kind !== 'ion').length, colour: colourOf.get(id) as string })),
    atomCount: raw.length,
    onClick(h) { handler = h; },
    mark(kind, residues, text) {
      const gs = residues.flatMap((r) => (byResidue.get(`${r.chain}:${r.resi}`) ?? []).filter((g) => g.resn === r.resn));
      marks.push({ kind, groups: gs });
      restyle();
      if (text && gs.length) addLabel(kind, gs[0], text);
    },
    clearMarks(kind) {
      for (let i = marks.length - 1; i >= 0; i--) if (!kind || marks[i].kind === kind) marks.splice(i, 1);
      restyle();
    },
    residuesOf(selectors) { return resolve(selectors).map(toResidue); },
    focus(selectors) {
      const gs = resolve(selectors).filter((g) => !hidden.has(g.chain));
      if (!gs.length) return;
      viewer.zoomTo({ serial: serials(gs) }, options.reducedMotion ? 0 : 600);
      viewer.render();
    },
    reset() { viewer.zoomTo(); viewer.render(); },
    zoom(factor) { viewer.zoom(factor, options.reducedMotion ? 0 : 250); },
    setChainHidden(chain, value) { if (value) hidden.add(chain); else hidden.delete(chain); restyle(); },
    isHidden: (chain) => hidden.has(chain),
    restyle,
    screenOf(r) {
      const g = (byResidue.get(`${r.chain}:${r.resi}`) ?? []).find((x) => x.resn === r.resn);
      const a = g?.rep[0] ?? g?.atoms[0];
      return a ? (viewer.modelToScreen(a) as { x: number; y: number }) : null;
    },
    pickAt(x, y) { const g = pickAt(x, y); return g ? toResidue(g) : null; },
    rotate(degrees, axis) { viewer.rotate(degrees, axis, 0); viewer.render(); },
    resize() { viewer.resize(); viewer.render(); },
    destroy() {
      observer.disconnect();
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointerup', onUp);
      try {
        // Give the graphics context back at once: a frame that opens many structures must not run out of them.
        const canvas = viewer.getCanvas() as HTMLCanvasElement;
        const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
        viewer.clear();
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
      } catch { /* the canvas may already be gone */ }
      container.replaceChildren();
    },
  };
  return self;
}
