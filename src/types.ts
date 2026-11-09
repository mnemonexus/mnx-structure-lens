/** The shapes the build writes into assets/ (see content/SCHEMA.md and dev/build-content.mjs). */
import type { PracticeActivity } from '@mnemonexus/addon-sdk/practice';

export type Kind = 'label' | 'find';
export type Module = 'gem' | 'bri';

/** What the catalogue's opaque `launch` holds. `n` is how many criteria the activity reports. */
export interface Launch { a: string; k: Kind; m: Module; n: number; s: string; c: string[] }
export type CatalogueEntry = PracticeActivity & { launch: Launch & Record<string, unknown> };

interface Common {
  id: string;
  module: Module;
  title: string;
  summary: string;
  level: 1 | 2 | 3;
  minutes: number;
  skills: string[];
  context: string;
  cite: string[];
}

export interface LabelBox {
  id: string;
  answer: string;
  accept: string[];
  /** x, y, width, height in pixels of the figure image. */
  box: [number, number, number, number];
  hint: string;
  why: string;
  cite: string[];
}
export interface LabelActivity extends Common {
  kind: 'label';
  figure: { src: string; full: string; width: number; height: number; alt: string; cite: string };
  labels: LabelBox[];
  bank: string[];
}

/** One residue, a run of residues, a ligand or a whole chain, in the AUTH ids 3Dmol reads from mmCIF. */
export interface Selector { chain: string; resi?: number; from?: number; to?: number; resn?: string; seq?: string; atoms?: string[] }
export interface Target {
  id: string;
  ask: string;
  name: string;
  select: Selector[];
  hint: string;
  why: string;
  ref: string;
  cite: string[];
}
export interface StructureEntry {
  title: string;
  organism?: string;
  method?: string;
  citation?: string;
  chains?: Record<string, string>;
  entities?: string;
  source?: string;
  /** Pack path of the mmCIF file. */
  file: string;
}
export interface FindActivity extends Common {
  kind: 'find';
  pdb: string;
  entry: StructureEntry;
  view?: { show?: Selector[]; hide?: string[] };
  targets: Target[];
}
export type Activity = LabelActivity | FindActivity;

/** What is kept between sessions: a label run. */
export interface LabelDraft {
  v: 1;
  phase: 'answer' | 'review';
  answers: Record<string, string>;
  /** How many times Check was pressed. */
  checks: number;
  /** Rows the learner has checked and that were wrong at the last check. */
  hints: Record<string, boolean>;
  bank: boolean;
  /** Rows the learner counted as right in review although the match said no. */
  own: Record<string, boolean>;
  elapsed: number;
  savedAt: number;
}
/** A find run. */
export interface TargetState { status: 'open' | 'found' | 'shown'; misses: number; hit: boolean; hint: boolean }
export interface FindDraft {
  v: 1;
  phase: 'find' | 'review';
  index: number;
  targets: Record<string, TargetState>;
  clicks: number;
  elapsed: number;
  savedAt: number;
}
export interface DoneRecord { met: number; total: number; at: number; valid: boolean }
