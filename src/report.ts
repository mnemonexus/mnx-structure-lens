/**
 * What a run reports to the host (practice-v1, HOST_CONTRACT.md section 13), and how a typed label is matched.
 * One criterion per label or per target, each in plain words. The add-on never reports a grade: the host derives it.
 * Pure functions, so they can be tested without a browser.
 */
import type { PracticeCriterion, PracticeResult } from '@mnemonexus/addon-sdk/practice';
import type { FindActivity, FindDraft, LabelActivity, LabelBox, LabelDraft, Selector, Target } from './types';

const MAX_LABEL = 200;
const MAX_NOTE = 600;
const MAX_MISCONCEPTIONS = 32;

export const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

// ── Matching what was typed ──────────────────────────────────────────────────

const GREEK: Record<string, string> = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'κ': 'kappa', 'λ': 'lambda',
  'μ': 'mu', 'ν': 'nu', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'τ': 'tau', 'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega', 'Δ': 'delta', 'Σ': 'sigma',
};

/** Case, accents, punctuation, hyphens, Greek letters and a leading "the" do not matter. */
export function normalise(text: string): string {
  let out = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  out = out.replace(/[αβγδεζηθκλμνπρστφχψωΔΣ]/g, (ch) => ` ${GREEK[ch] ?? ch} `);
  out = out.replace(/['’′`]/g, ' prime ');
  out = out.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  out = out.replace(/^(the|a|an) /, '');
  return out.replace(/\s+/g, ' ');
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = keep;
    }
  }
  return row[b.length];
}

/** True when the typed text is one of the accepted forms, allowing one slip in a longer word. */
export function matches(typed: string, accept: readonly string[]): boolean {
  const t = normalise(typed);
  if (!t) return false;
  const squash = (s: string) => s.replace(/ /g, '');
  for (const form of accept) {
    const a = normalise(form);
    if (!a) continue;
    if (a === t || squash(a) === squash(t)) return true;
    const slack = a.length >= 14 ? 2 : a.length >= 7 ? 1 : 0;
    if (slack && distance(squash(a), squash(t)) <= slack) return true;
  }
  return false;
}
export const labelMatches = (typed: string, label: Pick<LabelBox, 'answer' | 'accept'>) => matches(typed, [label.answer, ...label.accept]);

// ── A label run ──────────────────────────────────────────────────────────────

export const emptyLabelDraft = (): LabelDraft => ({ v: 1, phase: 'answer', answers: {}, checks: 0, hints: {}, bank: false, own: {}, elapsed: 0, savedAt: 0 });

export function labelCorrect(activity: LabelActivity, draft: Pick<LabelDraft, 'answers' | 'own'>, label: LabelBox): boolean {
  return draft.own[label.id] === true || labelMatches(draft.answers[label.id] ?? '', label);
}
export function labelTally(activity: LabelActivity, draft: Pick<LabelDraft, 'answers' | 'own'>): { met: number; total: number; answered: number } {
  let met = 0; let answered = 0;
  for (const label of activity.labels) {
    if ((draft.answers[label.id] ?? '').trim()) answered++;
    if (labelCorrect(activity, draft, label)) met++;
  }
  return { met, total: activity.labels.length, answered };
}

/** When a wrong answer is another label's name in the same figure, say so: that is a confusion worth recording. */
function confusion(activity: LabelActivity, label: LabelBox, typed: string): string | null {
  for (const other of activity.labels) {
    if (other.id !== label.id && labelMatches(typed, other)) return clip(`Called ${label.answer} by the name of ${other.answer}`, 120);
  }
  return null;
}

export interface LabelResultInput { activity: LabelActivity; draft: LabelDraft; hintsUsed: number; finished: boolean }

export function buildLabelResult({ activity, draft, hintsUsed, finished }: LabelResultInput): PracticeResult {
  const { met, total, answered } = labelTally(activity, draft);
  if (!finished) {
    return {
      version: 1, activityId: activity.id, valid: false, criteria: [], hintsUsed, attempts: draft.checks,
      note: 'This run was ended before it was finished, so it does not count.',
    };
  }
  const skill = activity.skills[0];
  const criteria: PracticeCriterion[] = activity.labels.map((label, i) => {
    const own = draft.own[label.id] === true && !labelMatches(draft.answers[label.id] ?? '', label);
    return {
      id: label.id,
      label: clip(`Names box ${i + 1} as ${label.answer}${own ? ' (counted by the learner)' : ''}`, MAX_LABEL),
      met: labelCorrect(activity, draft, label), weight: 1, skill,
    };
  });
  const misconceptions: string[] = [];
  for (const label of activity.labels) {
    const typed = (draft.answers[label.id] ?? '').trim();
    if (!typed || labelCorrect(activity, draft, label)) continue;
    const tag = confusion(activity, label, typed);
    if (tag && !misconceptions.includes(tag)) misconceptions.push(tag);
  }
  const valid = answered * 2 >= total;
  const note = [`Named ${met} of ${total} labels (the learner's own tally, not a grade).`];
  if (!valid) note.push('Most boxes were left empty, so this run does not count.');
  return {
    version: 1, activityId: activity.id, valid, criteria,
    skills: [{ id: skill, evidence: total ? Math.round((met / total) * 100) / 100 : 0 }],
    misconceptions: misconceptions.slice(0, MAX_MISCONCEPTIONS),
    hintsUsed, attempts: Math.max(1, draft.checks),
    note: clip(note.join(' '), MAX_NOTE),
  };
}

// ── A find run ───────────────────────────────────────────────────────────────

/** How many wrong clicks a target allows and still counts as found. */
export const MISS_ALLOWANCE = 3;

export const emptyFindDraft = (): FindDraft => ({ v: 1, phase: 'find', index: 0, targets: {}, clicks: 0, elapsed: 0, savedAt: 0 });
export const blankTarget = (): FindDraft['targets'][string] => ({ status: 'open', misses: 0, hit: false, hint: false });

export function targetMet(state: FindDraft['targets'][string] | undefined): boolean {
  return !!state && state.status === 'found' && state.misses <= MISS_ALLOWANCE;
}
export function findTally(activity: FindActivity, draft: Pick<FindDraft, 'targets'>): { met: number; total: number; resolved: number } {
  let met = 0; let resolved = 0;
  for (const target of activity.targets) {
    const state = draft.targets[target.id];
    if (state && state.status !== 'open') resolved++;
    if (targetMet(state)) met++;
  }
  return { met, total: activity.targets.length, resolved };
}

export interface FindResultInput { activity: FindActivity; draft: FindDraft; hintsUsed: number; finished: boolean }

export function buildFindResult({ activity, draft, hintsUsed, finished }: FindResultInput): PracticeResult {
  const { met, total, resolved } = findTally(activity, draft);
  if (!finished) {
    return {
      version: 1, activityId: activity.id, valid: false, criteria: [], hintsUsed, attempts: draft.clicks,
      note: 'This run was ended before every feature was found or shown, so it does not count.',
    };
  }
  const skill = activity.skills[0];
  const criteria: PracticeCriterion[] = activity.targets.map((target) => ({
    id: target.id,
    label: clip(`Finds ${target.name} in the structure: ${target.ask.replace(/^(Click|Find|Select)\s+/i, '').replace(/\.$/, '')}`, MAX_LABEL),
    met: targetMet(draft.targets[target.id]), weight: 1, skill,
  }));
  const shown = activity.targets.filter((t) => draft.targets[t.id]?.status === 'shown').map((t) => t.name);
  const note = [`Found ${met} of ${total} features in ${activity.pdb} by clicking (the learner's own tally, not a grade).`];
  if (shown.length) note.push(`Shown rather than found: ${shown.join(', ')}.`);
  return {
    version: 1, activityId: activity.id, valid: resolved === total, criteria,
    skills: [{ id: skill, evidence: total ? Math.round((met / total) * 100) / 100 : 0 }],
    misconceptions: [],
    hintsUsed, attempts: Math.max(1, draft.clicks),
    note: clip(note.join(' '), MAX_NOTE),
  };
}

// ── Where a click landed ─────────────────────────────────────────────────────

export interface Residue { chain: string; resi: number; resn: string }

/** Does this residue belong to the selector? A selector with `atoms` still counts on the residue: the viewer picks residues. */
export function selectorHas(selector: Selector, residue: Residue): boolean {
  if (residue.chain !== selector.chain) return false;
  if (selector.resi === undefined && selector.from === undefined) return true;
  if (selector.resi !== undefined) return residue.resi === selector.resi && (!selector.resn || selector.resn === residue.resn);
  return residue.resi >= (selector.from as number) && residue.resi <= (selector.to as number);
}
export const targetHas = (target: Pick<Target, 'select'>, residue: Residue) => target.select.some((s) => selectorHas(s, residue));

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60); const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** A saved label draft is only trusted when it has the shape this version writes. */
export function parseLabelDraft(raw: string | null, activity: LabelActivity): LabelDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<LabelDraft>;
    if (d.v !== 1 || (d.phase !== 'answer' && d.phase !== 'review')) return null;
    const known = new Set(activity.labels.map((l) => l.id));
    const answers: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.answers ?? {})) if (known.has(k) && typeof v === 'string') answers[k] = v.slice(0, 200);
    const flags = (src: unknown) => {
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries((src ?? {}) as Record<string, unknown>)) if (v === true && known.has(k)) out[k] = true;
      return out;
    };
    return {
      v: 1, phase: d.phase, answers, hints: flags(d.hints), own: flags(d.own), bank: d.bank === true,
      checks: Number.isInteger(d.checks) && (d.checks as number) >= 0 && (d.checks as number) < 1000 ? (d.checks as number) : 0,
      elapsed: typeof d.elapsed === 'number' && d.elapsed >= 0 && d.elapsed < 86400 ? d.elapsed : 0,
      savedAt: typeof d.savedAt === 'number' ? d.savedAt : 0,
    };
  } catch { return null; }
}

export function parseFindDraft(raw: string | null, activity: FindActivity): FindDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<FindDraft>;
    if (d.v !== 1 || (d.phase !== 'find' && d.phase !== 'review')) return null;
    const targets: FindDraft['targets'] = {};
    for (const t of activity.targets) {
      const s = (d.targets ?? {})[t.id] as Partial<FindDraft['targets'][string]> | undefined;
      if (!s) continue;
      targets[t.id] = {
        status: s.status === 'found' || s.status === 'shown' ? s.status : 'open',
        misses: Number.isInteger(s.misses) && (s.misses as number) >= 0 && (s.misses as number) < 1000 ? (s.misses as number) : 0,
        hit: s.hit === true, hint: s.hint === true,
      };
    }
    const index = Number.isInteger(d.index) ? Math.min(Math.max(d.index as number, 0), activity.targets.length - 1) : 0;
    return {
      v: 1, phase: d.phase, index, targets,
      clicks: Number.isInteger(d.clicks) && (d.clicks as number) >= 0 && (d.clicks as number) < 100000 ? (d.clicks as number) : 0,
      elapsed: typeof d.elapsed === 'number' && d.elapsed >= 0 && d.elapsed < 86400 ? d.elapsed : 0,
      savedAt: typeof d.savedAt === 'number' ? d.savedAt : 0,
    };
  } catch { return null; }
}
