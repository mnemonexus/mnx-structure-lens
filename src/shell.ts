/** Pieces both kinds of activity share: the bar, the leave and end controls, the settings, and saving a run. */
import type { ExperienceHost } from '@mnemonexus/addon-sdk';
import type { PracticeResult } from '@mnemonexus/addon-sdk/practice';
import { button, h } from './dom';
import type { Store } from './store';
import { doneKey } from './store';

export interface Settings { showHints: boolean; labelAnswers: 'type' | 'pick'; lighter: boolean }

export interface RunDeps {
  host: ExperienceHost;
  store: Store;
  settings: () => Settings;
  /** Present when the learner chose this from the list, so there is somewhere to go back to. */
  onBack?: () => void;
  /** Present when the host chose this activity (practice-v1): why it was offered. */
  reason?: string;
}

export const KIND_LABEL = { label: 'Label the figure', find: 'Find it in the structure' } as const;
export const MODULE_SHORT = { gem: 'Genome', bri: 'Reactions' } as const;
export const MODULE_LONG = { gem: 'Genome Expression & Maintenance', bri: 'Biochemical Reactions & Interactions' } as const;
export const LEVEL = { 1: 'Introductory', 2: 'Intermediate', 3: 'Advanced' } as const;

export function bar(eyebrow: string, title: string, deps: RunDeps, leave: () => void): HTMLElement {
  const row = h('div', { class: 'sl-bar__row' });
  if (deps.onBack) row.append(button('Back', 'ghost', leave, { small: true, 'data-action': 'back', 'aria-label': 'Back to the list' }));
  row.append(h('div', { class: 'sl-bar__title' }, h('span', { class: 'sl-eyebrow' }, eyebrow), h('h1', { class: 'sl-bar__name' }, title)));
  return h('header', { class: 'sl-bar' }, row);
}

/** "End without finishing" asks once, then the run is reported as not counting. */
export function endControls(onEnd: () => void): { node: HTMLElement; reset: () => void } {
  const ask = h('p', { class: 'sl-confirm mnx-feedback mnx-feedback--hint', role: 'status', hidden: true },
    'End this run now? It will not count, and your progress is kept so you can come back to it.');
  const yes = button('Yes, end it', 'danger', onEnd, { small: true, 'data-action': 'confirm-end', hidden: true });
  const no = button('Keep going', 'ghost', () => reset(), { small: true, 'data-action': 'cancel-end', hidden: true });
  const open = button('End without finishing', 'ghost', () => {
    ask.hidden = false; yes.hidden = false; no.hidden = false; open.hidden = true; yes.focus();
  }, { small: true, 'data-action': 'end' });
  const reset = () => { ask.hidden = true; yes.hidden = true; no.hidden = true; open.hidden = false; };
  return { node: h('div', { class: 'sl-end' }, open, ask, yes, no), reset };
}

/** Remember that an activity was done, for the list. Never throws: the list is a convenience. */
export async function rememberDone(store: Store, id: string, met: number, total: number, valid: boolean) {
  try { await store.set(doneKey(id), JSON.stringify({ met, total, at: Date.now(), valid })); } catch { /* optional */ }
}

export function complete(host: ExperienceHost, practice: PracticeResult, elapsedSeconds: number, completed: boolean) {
  host.complete({ completed, elapsedSeconds: Math.max(0, Math.min(86400, Math.round(elapsedSeconds))), practice });
}

/** A short paragraph list from text with line breaks. */
export function paragraphs(text: string, className = 'mnx-text'): HTMLElement[] {
  return text.split(/\n+/).filter((line) => line.trim()).map((line) => h('p', { class: className }, line));
}

/** Cite ids like "003:A9.5" as words a student can read. */
export function citeWords(cites: readonly string[]): string {
  const byPacket = new Map<string, string[]>();
  for (const c of cites) {
    const [packet, line = ''] = c.split(':');
    (byPacket.get(packet) ?? byPacket.set(packet, []).get(packet)!).push(line);
  }
  return [...byPacket].map(([packet, lines]) => `course packet ${packet}, ${lines.join(', ')}`).join('; ');
}
