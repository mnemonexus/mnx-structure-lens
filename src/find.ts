/**
 * Find it in the structure: a real PDB entry in a viewer the learner rotates and zooms. Each target is a feature the
 * lecture names; click it. Wrong clicks say what was clicked, a hint says what to look for, "Show me" gives up on one
 * target. Phases: find -> review. The draft is saved as you go.
 */
import { Clock } from './clock';
import { structureText } from './data';
import { button, empty, h } from './dom';
import { blankTarget, buildFindResult, emptyFindDraft, findTally, MISS_ALLOWANCE, parseFindDraft, targetHas, targetMet, type Residue } from './report';
import { bar, citeWords, complete, endControls, KIND_LABEL, LEVEL, MODULE_LONG, paragraphs, rememberDone, type RunDeps } from './shell';
import { draftKey } from './store';
import type { FindActivity, FindDraft, Target } from './types';
import { createStructureView, type StructureView } from './viewer';

const THREE: Record<string, string> = { ALA: 'Ala', ARG: 'Arg', ASN: 'Asn', ASP: 'Asp', CYS: 'Cys', GLN: 'Gln', GLU: 'Glu', GLY: 'Gly', HIS: 'His', ILE: 'Ile', LEU: 'Leu', LYS: 'Lys', MET: 'Met', PHE: 'Phe', PRO: 'Pro', SER: 'Ser', THR: 'Thr', TRP: 'Trp', TYR: 'Tyr', VAL: 'Val' };
export const residueName = (r: Residue) => `${THREE[r.resn] ?? r.resn} ${r.resi} (chain ${r.chain})`;

export async function openFind(root: HTMLElement, deps: RunDeps, activity: FindActivity): Promise<void> {
  const { host, store } = deps;
  empty(root);
  const stored = parseFindDraft(await store.get(draftKey(activity.id)), activity);
  const draft: FindDraft = stored ?? emptyFindDraft();
  const resumed = stored !== null && (stored.clicks > 0 || stored.phase === 'review');
  const clockwork = new Clock(draft.elapsed);
  clockwork.start();
  let finished = false;
  let saveTimer: number | undefined;
  let view: StructureView | null = null;
  const targets = activity.targets;
  const stateOf = (t: Target) => (draft.targets[t.id] ??= blankTarget());
  const hintsUsed = () => targets.reduce((n, t) => n + (draft.targets[t.id]?.hint ? 1 : 0) + (draft.targets[t.id]?.status === 'shown' ? 1 : 0), 0);

  const shell = h('div', { class: 'sl-root sl-find', 'data-view': 'activity', 'data-kind': 'find' });
  root.append(shell);

  const save = async () => {
    if (finished) return;
    draft.elapsed = clockwork.seconds();
    draft.savedAt = Date.now();
    await store.set(draftKey(activity.id), JSON.stringify(draft));
  };
  const saveSoon = () => { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void save(), 500); };
  const onHide = () => { if (document.hidden) void save(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  const dispose = () => {
    window.clearTimeout(saveTimer); clockwork.dispose(); view?.destroy(); view = null;
    document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide);
    host.onTheme?.(null);
  };
  const leave = async () => { await save(); dispose(); deps.onBack?.(); };

  // ── the viewer ─────────────────────────────────────────────────────────────
  const stage = h('div', { class: 'sl-viewer', 'data-role': 'viewer', role: 'application', 'aria-label': `3D view of ${activity.pdb}. Drag to turn it, scroll to zoom, click a feature to answer.` });
  const loading = h('p', { class: 'sl-loading sl-muted', role: 'status' }, `Loading ${activity.pdb}…`);
  const chips = h('div', { class: 'sl-chips', role: 'group', 'aria-label': 'Chains', hidden: true });
  const readout = h('p', { class: 'sl-readout', role: 'status', 'data-role': 'readout' }, 'Drag to turn the structure. Scroll to zoom. Click to answer.');
  const viewTools = h('div', { class: 'sl-tools' },
    button('Reset view', 'secondary', () => view?.reset(), { small: true, 'data-action': 'reset-view' }),
    button('Zoom in', 'secondary', () => view?.zoom(1.5), { small: true, 'data-action': 'zoom-in' }),
    button('Zoom out', 'secondary', () => view?.zoom(1 / 1.5), { small: true, 'data-action': 'zoom-out' }));

  // ── the task ───────────────────────────────────────────────────────────────
  const taskBox = h('div', { class: 'sl-task', 'data-role': 'task' });
  const trail = h('ol', { class: 'sl-trail', 'data-role': 'trail' });
  const feedback = h('p', { class: 'mnx-feedback', role: 'status', 'data-role': 'feedback' });
  const footer = h('div', { class: 'sl-footer' });
  const ender = endControls(() => { void finish(false); });

  const current = (): Target => targets[Math.min(draft.index, targets.length - 1)];
  const allResolved = () => targets.every((t) => stateOf(t).status !== 'open');

  function paintTrail() {
    empty(trail);
    targets.forEach((t, i) => {
      const s = stateOf(t);
      const word = s.status === 'found' ? (targetMet(s) ? 'found' : 'found, with many tries') : s.status === 'shown' ? 'shown' : i === draft.index && draft.phase === 'find' ? 'now' : 'to do';
      trail.append(h('li', { class: 'sl-step', 'data-state': s.status === 'open' ? (i === draft.index ? 'current' : 'todo') : 'done' },
        h('span', { class: 'sl-step__n' }, String(i + 1)), h('span', null, draft.phase === 'review' || s.status !== 'open' ? t.name : `Feature ${i + 1}`), h('span', { class: 'sl-muted' }, ` ${word}`)));
    });
  }

  function paintTarget() {
    paintTrail();
    empty(taskBox); empty(footer);
    const t = current();
    const s = stateOf(t);
    if (draft.phase === 'review') { renderReview(); return; }
    taskBox.append(
      h('p', { class: 'sl-eyebrow' }, `Feature ${draft.index + 1} of ${targets.length}`),
      h('p', { class: 'sl-ask', 'data-role': 'ask' }, t.ask));
    const hintLine = h('p', { class: 'mnx-feedback mnx-feedback--hint', 'data-role': 'hint', hidden: !s.hint }, s.hint ? `Look for this: ${t.hint}` : '');
    taskBox.append(hintLine);
    if (s.status === 'open') {
      if (deps.settings().showHints) {
        footer.append(button('Hint', 'secondary', () => {
          s.hint = true; hintLine.textContent = `Look for this: ${t.hint}`; hintLine.hidden = false; saveSoon();
        }, { 'data-action': 'hint' }));
      }
      footer.append(button('Show me', 'ghost', () => showMe(t), { 'data-action': 'show-me' }));
    } else {
      taskBox.append(h('div', { class: 'sl-why', 'data-role': 'why' },
        h('p', null, h('strong', null, t.name), s.status === 'shown' ? ' (shown to you)' : ''),
        h('p', null, t.why)));
      const last = draft.index >= targets.length - 1;
      footer.append(last || allResolved()
        ? button('See the summary', 'primary', () => { draft.phase = 'review'; void save(); paintTarget(); }, { 'data-action': 'summary' })
        : button('Next feature', 'primary', () => { draft.index = targets.findIndex((x, i) => i > draft.index && stateOf(x).status === 'open'); if (draft.index < 0) draft.index = 0; view?.clearMarks('click'); readout.textContent = 'Drag to turn the structure. Scroll to zoom. Click to answer.'; feedback.textContent = ''; feedback.className = 'mnx-feedback'; paintTarget(); saveSoon(); }, { 'data-action': 'next' }));
    }
    footer.append(ender.node);
  }

  function renderReview() {
    const { met, total } = findTally(activity, draft);
    taskBox.append(h('p', { class: 'sl-eyebrow' }, 'Summary'),
      h('p', { class: 'mnx-text', 'data-role': 'tally' }, `${met} of ${total} features found by clicking (your own tally, not a grade).`));
    const list = h('ul', { class: 'sl-review' });
    for (const t of targets) {
      const s = stateOf(t);
      list.append(h('li', { class: 'sl-review__item', 'data-state': targetMet(s) ? 'met' : 'missed' },
        h('p', null, h('strong', null, `${t.name}: `), targetMet(s) ? 'found.' : s.status === 'shown' ? 'shown to you.' : 'found, but after more than three wrong clicks.'),
        h('p', { class: 'sl-why' }, t.why),
        h('details', { class: 'sl-details' }, h('summary', null, 'How we know'), h('p', { class: 'sl-ref' }, t.ref), h('p', { class: 'sl-cite' }, `Course: ${citeWords(t.cite)}.`))));
    }
    taskBox.append(list,
      h('details', { class: 'sl-details' }, h('summary', null, `About ${activity.pdb}`),
        h('p', { class: 'sl-ref' }, [activity.entry.title, activity.entry.organism, activity.entry.method].filter(Boolean).join(' · ')),
        activity.entry.citation ? h('p', { class: 'sl-ref' }, activity.entry.citation) : null,
        h('p', { class: 'sl-ref' }, activity.entry.source ?? '')));
    footer.append(button('Done', 'primary', () => { void finish(true); }, { 'data-action': 'finish' }), ender.node);
  }

  function markFound(t: Target, kind: 'found' | 'shown') {
    const residues = view?.residuesOf(t.select) ?? [];
    view?.clearMarks('click');
    view?.mark(kind, residues, t.name);
    view?.focus(t.select);
  }

  function showMe(t: Target) {
    const s = stateOf(t);
    s.status = 'shown';
    markFound(t, 'shown');
    feedback.className = 'mnx-feedback mnx-feedback--hint';
    feedback.textContent = `Here it is: ${t.name}. This one will not count as found.`;
    paintTarget(); void save();
  }

  function onClick(residue: Residue | null) {
    if (finished || !view) return;
    const t = current();
    const s = stateOf(t);
    if (!residue) {
      readout.textContent = 'That click was not on the structure. Try nearer the feature.';
      return;
    }
    view.clearMarks('click');
    view.mark('click', [residue]);
    readout.textContent = `You clicked ${residueName(residue)}.`;
    if (draft.phase !== 'find' || s.status !== 'open') return;
    draft.clicks++;
    if (targetHas(t, residue)) {
      s.status = 'found';
      markFound(t, 'found');
      feedback.className = 'mnx-feedback mnx-feedback--correct';
      feedback.textContent = s.misses <= MISS_ALLOWANCE ? `Yes, ${residueName(residue)} is part of ${t.name}.` : `Yes, that is ${t.name}, but it took more than ${MISS_ALLOWANCE} wrong clicks so it does not count as found.`;
      paintTarget();
    } else {
      s.misses++;
      feedback.className = 'mnx-feedback mnx-feedback--incorrect';
      feedback.textContent = `Not that one: ${residueName(residue)} is not what was asked. ${s.misses >= MISS_ALLOWANCE ? 'Try the hint, or choose Show me.' : 'Look again.'}`;
    }
    saveSoon();
  }

  async function finish(valid: boolean) {
    if (finished) return;
    finished = true;
    clockwork.stop();
    const result = buildFindResult({ activity, draft, hintsUsed: hintsUsed(), finished: valid && allResolved() });
    const { met, total } = findTally(activity, draft);
    dispose();
    await store.delete(draftKey(activity.id));
    if (valid) await rememberDone(store, activity.id, met, total, result.valid);
    complete(host, result, clockwork.seconds(), valid);
    empty(shell);
    shell.append(h('main', { class: 'sl-main sl-donepage' }, h('h1', { class: 'mnx-title' }, valid ? 'Saved' : 'Ended'), h('p', { class: 'mnx-text' }, valid ? 'Your run has been recorded.' : 'This run was not counted.')));
  }

  // ── building the page ──────────────────────────────────────────────────────
  shell.append(
    bar(KIND_LABEL.find, activity.title, deps, () => { void leave(); }),
    h('main', { class: 'sl-main' },
      deps.reason ? h('p', { class: 'mnx-feedback mnx-feedback--hint', 'data-role': 'reason' }, deps.reason) : null,
      h('p', { class: 'sl-muted' }, `${MODULE_LONG[activity.module]} · ${LEVEL[activity.level]} · about ${activity.minutes} min · PDB ${activity.pdb}`),
      resumed ? h('p', { class: 'sl-muted', 'data-role': 'resumed' }, 'Welcome back. You are where you left off.') : null,
      h('div', { class: 'sl-context' }, ...paragraphs(activity.context)),
      h('div', { class: 'sl-grid sl-grid--find' },
        h('div', { class: 'sl-viewcol' }, h('div', { class: 'sl-viewbox' }, stage, loading), viewTools, readout, chips),
        h('div', { class: 'sl-taskcol' }, trail, taskBox, feedback, footer))));
  paintTarget();

  void (async () => {
    try {
      const text = await structureText(host, activity.entry.file);
      await new Promise((r) => setTimeout(r, 30));
      view = createStructureView(stage, { text, hide: activity.view?.hide, show: activity.view?.show, lighter: deps.settings().lighter, reducedMotion: host.theme?.reducedMotion === true });
      loading.remove();
      (window as unknown as { __structureLens?: unknown }).__structureLens = { view, targets };
      view.onClick(onClick);
      host.onTheme?.(() => view?.restyle());
      for (const t of targets) {
        const s = draft.targets[t.id];
        if (s && s.status !== 'open') view.mark(s.status === 'shown' ? 'shown' : 'found', view.residuesOf(t.select));
      }
      if (view.chains.length > 1) {
        chips.hidden = false;
        for (const c of view.chains) {
          const names = activity.entry.chains?.[c.id];
          const chip = h('button', { type: 'button', class: 'mnx-chip sl-chip', 'aria-pressed': String(!view.isHidden(c.id)), 'data-chain': c.id, title: names ?? '' },
            h('span', { class: 'sl-dot', style: `background:${c.colour}` }), names ? `${c.id}: ${names}` : `Chain ${c.id}`);
          chip.addEventListener('click', () => {
            const hide = !view!.isHidden(c.id);
            view!.setChainHidden(c.id, hide);
            chip.setAttribute('aria-pressed', String(!hide));
          });
          chips.append(chip);
        }
      }
    } catch (error) {
      loading.remove();
      stage.append(h('div', { class: 'mnx-error', role: 'alert' }, h('p', { class: 'mnx-error__title' }, 'The 3D view could not start'),
        h('p', { class: 'mnx-error__text' }, `${String((error as Error)?.message ?? error)} This add-on needs WebGL. You can end this run; it will not count.`)));
    }
  })();
}
