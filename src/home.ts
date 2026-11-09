/** The list: opened by the learner from the Experiences page. When the host chooses an activity it goes straight to it. */
import type { ExperienceHost } from '@mnemonexus/addon-sdk';
import { empty, h } from './dom';
import { KIND_LABEL, LEVEL, MODULE_LONG, MODULE_SHORT } from './shell';
import { doneKey, draftKey, parseDone, type Store } from './store';
import type { CatalogueEntry, DoneRecord, Kind, Module } from './types';

export const EXAMS_FROM = '2027-01-18';
const FILTER_KEY = 'ui:filters';

export interface HomeDeps { host: ExperienceHost; store: Store; entries: CatalogueEntry[]; onOpen: (entry: CatalogueEntry) => void }
interface Filters { module: Module | 'all'; kind: Kind | 'all'; search: string; undone: boolean }

export const daysUntil = (iso: string, now = Date.now()) => Math.ceil((Date.parse(`${iso}T00:00:00`) - now) / 86400000);

export async function openHome(root: HTMLElement, deps: HomeDeps): Promise<void> {
  const { store, entries } = deps;
  empty(root);
  const keys = new Set(await store.keys());
  const done = new Map<string, DoneRecord>();
  await Promise.all(entries.map(async (e) => {
    if (!keys.has(doneKey(e.id))) return;
    const record = parseDone(await store.get(doneKey(e.id)));
    if (record) done.set(e.id, record);
  }));
  let filters: Filters = { module: 'all', kind: 'all', search: '', undone: false };
  try {
    const saved = JSON.parse((await store.get(FILTER_KEY)) ?? 'null') as Partial<Filters> | null;
    if (saved) filters = { ...filters, ...saved, search: '' };
  } catch { /* a convenience only */ }

  const shell = h('div', { class: 'sl-root sl-home', 'data-view': 'home' });
  root.append(shell);
  const days = daysUntil(EXAMS_FROM);
  const examLine = days > 0 ? `Exams from 18 January 2027: ${days} day${days === 1 ? '' : 's'} to go.` : 'The exam period has started.';
  const list = h('ul', { class: 'sl-cards', 'data-role': 'list' });
  const count = h('p', { class: 'sl-muted', role: 'status', 'data-role': 'count' });
  const controls = h('div', { class: 'sl-controls' });
  const persist = () => { void store.set(FILTER_KEY, JSON.stringify({ ...filters, search: '' })); };

  const chips = <T extends string>(label: string, current: T, options: [T, string][], set: (value: T) => void) => {
    const group = h('div', { class: 'sl-chips', role: 'group', 'aria-label': label });
    for (const [value, text] of options) {
      group.append(h('button', { type: 'button', class: 'mnx-chip', 'aria-pressed': String(current === value), 'data-filter': `${label}:${value}`, onclick: () => { set(value); persist(); render(true); } }, text));
    }
    return group;
  };

  const render = (rebuildControls = false) => {
    if (rebuildControls) {
      empty(controls);
      controls.append(
        chips<Kind | 'all'>('Kind', filters.kind, [['all', 'All kinds'], ['label', KIND_LABEL.label], ['find', KIND_LABEL.find]], (v) => { filters.kind = v; }),
        chips<Module | 'all'>('Module', filters.module, [['all', 'All modules'], ['gem', MODULE_SHORT.gem], ['bri', MODULE_SHORT.bri]], (v) => { filters.module = v; }),
        h('div', { class: 'sl-chips', role: 'group', 'aria-label': 'Progress' },
          h('button', { type: 'button', class: 'mnx-chip', 'aria-pressed': String(filters.undone), 'data-filter': 'undone', onclick: () => { filters.undone = !filters.undone; persist(); render(true); } }, 'Not done yet')));
    }
    const q = filters.search.trim().toLowerCase();
    const shown = entries.filter((e) => {
      const l = e.launch;
      if (filters.module !== 'all' && l.m !== filters.module) return false;
      if (filters.kind !== 'all' && l.k !== filters.kind) return false;
      if (filters.undone && done.has(e.id)) return false;
      if (q && !`${e.title} ${e.summary ?? ''} ${e.terms.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    empty(list);
    for (const e of shown) {
      const l = e.launch;
      const record = done.get(e.id);
      const status = record ? `Done: ${record.met} of ${record.total}` : keys.has(draftKey(e.id)) ? 'In progress' : '';
      list.append(h('li', null, h('button', { type: 'button', class: 'sl-card', 'data-activity': e.id, 'data-kind': l.k, onclick: () => deps.onOpen(e) },
        h('span', { class: 'sl-card__top' },
          h('span', { class: 'sl-eyebrow' }, `${KIND_LABEL[l.k]} · ${MODULE_SHORT[l.m]}`),
          status ? h('span', { class: `mnx-badge${record ? ' mnx-badge--success' : ''}` }, status) : null),
        h('span', { class: 'sl-card__title' }, e.title),
        h('span', { class: 'sl-card__source' }, l.s),
        h('span', { class: 'sl-card__meta' }, `${l.n} ${l.k === 'label' ? 'labels' : l.n === 1 ? 'feature' : 'features'} · about ${e.minutes} min · ${LEVEL[e.level]}`))));
    }
    count.textContent = shown.length === entries.length ? `${entries.length} activities.` : `${shown.length} of ${entries.length} activities.`;
    if (!shown.length) list.append(h('li', { class: 'mnx-empty' }, h('p', { class: 'mnx-empty__title' }, 'Nothing matches'), h('p', { class: 'mnx-empty__text' }, 'Clear a filter or the search to see more.')));
  };

  const search = h('input', { type: 'search', class: 'mnx-input', placeholder: 'Search titles and topics', 'aria-label': 'Search', 'data-role': 'search' }) as HTMLInputElement;
  search.addEventListener('input', () => { filters.search = search.value; render(); });

  shell.append(h('main', { class: 'sl-main' },
    h('header', { class: 'sl-homehead' },
      h('h1', { class: 'mnx-title' }, 'Structure Lens'),
      h('p', { class: 'mnx-text' }, 'Point at the right thing: name the hidden labels on a lecture figure, or find the feature in a real 3D structure.'),
      h('p', { class: 'sl-muted' }, `${examLine} ${MODULE_LONG.gem}, and ${MODULE_LONG.bri}.`),
      h('p', { class: 'sl-muted' }, 'Private study pack: it contains university course material and is not for sharing.')),
    search, controls, count, list,
    h('details', { class: 'sl-details sl-notices' }, h('summary', null, 'Sources and licences'),
      h('p', { class: 'sl-ref' }, 'Figures are taken from the course lectures (University of York, Department of Biology) and are for the owner’s own study.'),
      h('p', { class: 'sl-ref' }, 'Structures are from the RCSB Protein Data Bank (data released under CC0). Each activity names its entry and the paper it comes from.'),
      h('p', { class: 'sl-ref' }, '3Dmol.js (Copyright 2014, University of Pittsburgh and contributors; BSD-3-Clause) draws the structures. Its notice is shipped in the pack as assets/licenses/3Dmol-LICENSE.txt.'))));
  render(true);
}
