/**
 * Label the figure: a real lecture figure with its labels hidden behind numbered boxes. Name each one, check, ask for a
 * hint if stuck, then finish to see every label and why it matters. Phases: answer -> review. The draft is saved as you go.
 */
import { Clock } from './clock';
import { figureUrl } from './data';
import { button, empty, h } from './dom';
import { buildLabelResult, emptyLabelDraft, labelCorrect, labelMatches, labelTally, parseLabelDraft } from './report';
import { bar, citeWords, complete, endControls, KIND_LABEL, LEVEL, MODULE_LONG, paragraphs, rememberDone, type RunDeps } from './shell';
import { draftKey } from './store';
import type { LabelActivity, LabelBox, LabelDraft } from './types';

const ZOOMS = [1, 1.6, 2.5, 4];

/** The same shuffle every time for one activity, so a resumed run shows the bank in the same order. */
function shuffled<T>(items: T[], seed: string): T[] {
  let s = 2166136261;
  for (const ch of seed) s = Math.imul(s ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0; s = (s + 0x6d2b79f5) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function openLabel(root: HTMLElement, deps: RunDeps, activity: LabelActivity): Promise<void> {
  const { host, store } = deps;
  empty(root);
  const stored = parseLabelDraft(await store.get(draftKey(activity.id)), activity);
  const draft: LabelDraft = stored ?? emptyLabelDraft();
  const resumed = stored !== null && (Object.values(stored.answers).some((a) => a.trim()) || stored.phase === 'review');
  const clockwork = new Clock(draft.elapsed);
  clockwork.start();
  let finished = false;
  let saveTimer: number | undefined;
  let activeId: string | null = null;
  let zoom = 0;
  /** Rows that were checked and the verdict, until the learner edits that row again. */
  const verdict = new Map<string, boolean>();
  const hintsOpen = new Set(Object.keys(draft.hints));
  const pickMode = () => deps.settings().labelAnswers === 'pick';
  const bankVisible = () => draft.phase === 'answer' && (pickMode() || draft.bank);
  const hintsUsed = () => hintsOpen.size + (draft.bank && !pickMode() ? 1 : 0);

  const shell = h('div', { class: 'sl-root sl-label', 'data-view': 'activity', 'data-kind': 'label' });
  root.append(shell);

  const save = async () => {
    if (finished) return;
    draft.elapsed = clockwork.seconds();
    draft.hints = Object.fromEntries([...hintsOpen].map((k) => [k, true]));
    draft.savedAt = Date.now();
    await store.set(draftKey(activity.id), JSON.stringify(draft));
  };
  const saveSoon = () => { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void save(), 600); };
  const onHide = () => { if (document.hidden) void save(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  const dispose = () => {
    window.clearTimeout(saveTimer); clockwork.dispose();
    document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide);
  };
  const leave = async () => { await save(); dispose(); deps.onBack?.(); };

  // ── the figure ─────────────────────────────────────────────────────────────
  const n = activity.labels.length;
  const boxes = new Map<string, HTMLButtonElement>();
  const canvas = h('div', { class: 'sl-canvas' });
  const plate = h('div', { class: 'sl-plate', tabindex: 0, role: 'group', 'aria-label': 'The figure. Scroll to move around it.' }, canvas);
  const img = h('img', { class: 'sl-figure__img', alt: activity.figure.alt, width: activity.figure.width, height: activity.figure.height, draggable: false }) as HTMLImageElement;
  canvas.append(img);
  const { width, height } = activity.figure;
  activity.labels.forEach((label, i) => {
    const [x, y, w, bh] = label.box;
    const box = h('button', {
      type: 'button', class: 'sl-box', 'data-box': label.id, 'aria-label': `Box ${i + 1}`,
      style: `left:${(((x + w / 2) / width) * 100).toFixed(3)}%;top:${(((y + bh / 2) / height) * 100).toFixed(3)}%;--w:${((w / width) * 100).toFixed(3)}%;--h:${((bh / height) * 100).toFixed(3)}%`,
      onclick: () => activate(label.id, true),
    }, String(i + 1)) as HTMLButtonElement;
    boxes.set(label.id, box);
    canvas.append(box);
  });
  const urls: { blank?: string; full?: string } = {};
  const showImage = async (which: 'blank' | 'full') => {
    try {
      urls[which] ??= await figureUrl(host, which === 'blank' ? activity.figure.src : activity.figure.full);
      img.src = urls[which] as string;
    } catch { plate.append(h('p', { class: 'mnx-feedback mnx-feedback--error', role: 'alert' }, 'The figure could not be loaded. The pack may need reinstalling.')); }
  };

  const zoomLabel = h('span', { class: 'sl-muted', 'data-role': 'zoom' }, '100%');
  const setZoom = (index: number) => {
    zoom = Math.max(0, Math.min(ZOOMS.length - 1, index));
    canvas.style.width = `${ZOOMS[zoom] * 100}%`;
    zoomLabel.textContent = `${Math.round(ZOOMS[zoom] * 100)}%`;
    zoomOut.disabled = zoom === 0; zoomIn.disabled = zoom === ZOOMS.length - 1;
  };
  const zoomOut = button('Smaller', 'secondary', () => setZoom(zoom - 1), { small: true, 'data-action': 'zoom-out', 'aria-label': 'Make the figure smaller' });
  const zoomIn = button('Larger', 'secondary', () => setZoom(zoom + 1), { small: true, 'data-action': 'zoom-in', 'aria-label': 'Make the figure larger' });
  const tools = h('div', { class: 'sl-tools' }, zoomOut, zoomIn, zoomLabel);

  // ── the rows ───────────────────────────────────────────────────────────────
  const rows = new Map<string, { row: HTMLElement; input: HTMLInputElement; state: HTMLElement; hint: HTMLElement; hintButton: HTMLButtonElement; extra: HTMLElement }>();
  const list = h('ol', { class: 'sl-rows', 'data-role': 'rows' });
  const feedback = h('p', { class: 'mnx-feedback', role: 'status', 'data-role': 'feedback' });
  const progress = h('p', { class: 'sl-muted', 'data-role': 'progress' });

  function activate(id: string, focus: boolean) {
    activeId = id;
    for (const [key, box] of boxes) box.dataset.active = String(key === id);
    for (const [key, r] of rows) r.row.dataset.active = String(key === id);
    const r = rows.get(id);
    if (focus && r && draft.phase === 'answer' && !r.input.readOnly) r.input.focus();
    boxes.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function paintRow(label: LabelBox) {
    const r = rows.get(label.id);
    const box = boxes.get(label.id);
    if (!r || !box) return;
    const typed = (draft.answers[label.id] ?? '').trim();
    const known = verdict.get(label.id);
    const state = draft.phase === 'review' ? (labelCorrect(activity, draft, label) ? 'correct' : 'incorrect') : known === undefined ? (typed ? 'filled' : 'empty') : known ? 'correct' : 'incorrect';
    r.row.dataset.state = state;
    box.dataset.state = state;
    const mark = state === 'correct' ? ' ✓' : state === 'incorrect' ? ' ✗' : '';
    box.textContent = `${activity.labels.indexOf(label) + 1}${mark}`;
    r.state.textContent = state === 'correct' ? 'Right' : state === 'incorrect' ? (draft.phase === 'review' ? 'Not matched' : 'Not yet') : '';
    r.state.hidden = !r.state.textContent;
    r.input.setAttribute('aria-invalid', String(state === 'incorrect'));
    box.setAttribute('aria-label', `Box ${activity.labels.indexOf(label) + 1}${typed ? `: ${typed}` : ', empty'}${mark ? (state === 'correct' ? ', right' : ', not yet') : ''}`);
  }
  const paintAll = () => {
    activity.labels.forEach(paintRow);
    const { answered } = labelTally(activity, draft);
    progress.textContent = draft.phase === 'review' ? '' : `${answered} of ${n} boxes filled in.`;
  };

  function setAnswer(id: string, value: string) {
    draft.answers[id] = value;
    verdict.delete(id);
    paintRow(activity.labels.find((l) => l.id === id) as LabelBox);
    const { answered } = labelTally(activity, draft);
    progress.textContent = `${answered} of ${n} boxes filled in.`;
    saveSoon();
  }

  activity.labels.forEach((label, i) => {
    const input = h('input', {
      type: 'text', class: 'mnx-input sl-input', 'data-answer': label.id, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      'aria-label': `Label for box ${i + 1}`, placeholder: pickMode() ? 'Pick from the word bank' : 'Type the label', value: draft.answers[label.id] ?? '',
    }) as HTMLInputElement;
    input.readOnly = pickMode();
    input.addEventListener('focus', () => activate(label.id, false));
    input.addEventListener('input', () => setAnswer(label.id, input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = activity.labels[i + 1];
      if (next) rows.get(next.id)?.input.focus(); else check();
    });
    const state = h('span', { class: 'sl-state', 'data-role': 'state', hidden: true });
    const hint = h('p', { class: 'mnx-feedback mnx-feedback--hint sl-hint', 'data-role': 'hint', hidden: true });
    const hintButton = button('Hint', 'ghost', () => showHint(label), { small: true, 'data-action': 'hint', 'data-for': label.id, 'aria-label': `Hint for box ${i + 1}` });
    const extra = h('div', { class: 'sl-extra', 'data-role': 'extra', hidden: true });
    const row = h('li', { class: 'sl-row', 'data-row': label.id, 'data-state': 'empty' },
      h('span', { class: 'sl-num', 'aria-hidden': 'true' }, String(i + 1)),
      h('div', { class: 'sl-row__main' },
        h('div', { class: 'sl-row__line' }, input, state, hintButton),
        hint, extra));
    list.append(row);
    rows.set(label.id, { row, input, state, hint, hintButton, extra });
    if (hintsOpen.has(label.id)) { hint.textContent = `Look for this: ${label.hint}`; hint.hidden = false; }
  });

  function showHint(label: LabelBox) {
    const r = rows.get(label.id);
    if (!r) return;
    hintsOpen.add(label.id);
    r.hint.textContent = `Look for this: ${label.hint}`;
    r.hint.hidden = false;
    saveSoon();
  }

  // ── the word bank ──────────────────────────────────────────────────────────
  const bank = h('div', { class: 'sl-bank', role: 'group', 'aria-label': 'Word bank', 'data-role': 'bank', hidden: true });
  const bankItems = shuffled([...new Set([...activity.labels.map((l) => l.answer), ...activity.bank])], activity.id);
  function paintBank() {
    empty(bank);
    bank.hidden = !bankVisible();
    if (bank.hidden) return;
    for (const item of bankItems) {
      const used = activity.labels.some((l) => draft.answers[l.id] === item);
      bank.append(h('button', {
        type: 'button', class: 'mnx-chip sl-chip', 'aria-pressed': String(used), 'data-chip': item,
        onclick: () => {
          const id = activeId ?? activity.labels.find((l) => !(draft.answers[l.id] ?? '').trim())?.id ?? activity.labels[0].id;
          for (const l of activity.labels) if (draft.answers[l.id] === item && l.id !== id) { draft.answers[l.id] = ''; const r = rows.get(l.id); if (r) r.input.value = ''; verdict.delete(l.id); }
          const target = rows.get(id);
          if (target) target.input.value = item;
          setAnswer(id, item);
          activate(id, false);
          paintAll(); paintBank();
        },
      }, item));
    }
  }
  const bankButton = button('Show the word bank', 'ghost', () => {
    draft.bank = true; paintBank(); bankButton.hidden = true; saveSoon();
    feedback.className = 'mnx-feedback mnx-feedback--hint';
    feedback.textContent = 'The word bank is open. Pick a box on the figure or a row, then pick a word. Using it is counted as a hint.';
  }, { small: true, 'data-action': 'bank' });

  // ── checking and finishing ─────────────────────────────────────────────────
  function check() {
    if (draft.phase !== 'answer') return;
    draft.checks++;
    let right = 0; let wrong = 0; let empty = 0;
    for (const label of activity.labels) {
      const typed = (draft.answers[label.id] ?? '').trim();
      if (!typed) { empty++; verdict.delete(label.id); continue; }
      const ok = labelMatches(typed, label);
      verdict.set(label.id, ok);
      if (ok) right++; else wrong++;
    }
    paintAll();
    feedback.className = `mnx-feedback ${wrong ? 'mnx-feedback--incorrect' : 'mnx-feedback--correct'}`;
    feedback.textContent = wrong
      ? `${right} right, ${wrong} not yet. Change the ones marked ✗ and check again, or ask for a hint.${empty ? ` ${empty} still empty.` : ''}`
      : right === n ? 'Every box is right. Finish to see why each one matters.' : `${right} right so far. ${empty} still empty.`;
    saveSoon();
  }

  function toReview() {
    clockwork.stop();
    draft.phase = 'review';
    paintAll();
    void save();
    renderPhase();
  }

  async function finish(valid: boolean) {
    if (finished) return;
    finished = true;
    clockwork.stop();
    dispose();
    const result = buildLabelResult({ activity, draft, hintsUsed: hintsUsed(), finished: valid });
    const { met, total } = labelTally(activity, draft);
    await store.delete(draftKey(activity.id));
    if (valid) await rememberDone(store, activity.id, met, total, result.valid);
    complete(host, result, clockwork.seconds(), valid);
    empty(shell);
    shell.append(h('main', { class: 'sl-main sl-donepage' }, h('h1', { class: 'mnx-title' }, valid ? 'Saved' : 'Ended'), h('p', { class: 'mnx-text' }, valid ? 'Your run has been recorded.' : 'This run was not counted.')));
  }

  // ── layout, per phase ──────────────────────────────────────────────────────
  const footer = h('div', { class: 'sl-footer' });
  const ender = endControls(() => { void finish(false); });
  const ctxBlock = h('div', { class: 'sl-context' }, ...paragraphs(activity.context));
  const fig = h('figure', { class: 'sl-figure' }, tools, plate);

  function renderPhase() {
    empty(footer);
    if (draft.phase === 'answer') {
      void showImage('blank');
      footer.append(
        button('Check', 'primary', check, { 'data-action': 'check' }),
        button('Finish and see the answers', 'secondary', toReview, { 'data-action': 'finish-answering' }),
        ender.node);
      bankButton.hidden = pickMode() || draft.bank || !deps.settings().showHints;
      for (const r of rows.values()) r.hintButton.hidden = !deps.settings().showHints;
      paintBank();
    } else {
      void showImage('full');
      boxes.forEach((b) => { b.hidden = true; });
      bank.hidden = true; bankButton.hidden = true;
      feedback.className = 'mnx-feedback';
      const { met, total } = labelTally(activity, draft);
      feedback.textContent = `${met} of ${total} named right (your own tally, not a grade). Anything marked wrong that you meant correctly, you can count as yours.`;
      for (const label of activity.labels) {
        const r = rows.get(label.id) as NonNullable<ReturnType<typeof rows.get>>;
        r.input.readOnly = true; r.hintButton.hidden = true; r.hint.hidden = true;
        empty(r.extra); r.extra.hidden = false;
        const ok = labelMatches(draft.answers[label.id] ?? '', label);
        r.extra.append(
          h('p', { class: 'sl-answer' }, h('strong', null, label.answer), ok ? '' : (draft.answers[label.id] ?? '').trim() ? `  (you wrote: ${draft.answers[label.id]})` : '  (left empty)'),
          h('p', { class: 'sl-why' }, label.why),
          h('p', { class: 'sl-cite' }, `From ${citeWords(label.cite)}.`));
        if (!ok && (draft.answers[label.id] ?? '').trim()) {
          const own = h('input', { type: 'checkbox', class: 'sl-own', 'data-own': label.id, checked: draft.own[label.id] === true }) as HTMLInputElement;
          own.addEventListener('change', () => { draft.own[label.id] = own.checked; paintAll(); saveSoon(); });
          r.extra.append(h('label', { class: 'sl-ownlabel' }, own, ' My answer means the same thing'));
        }
      }
      paintAll();
      footer.append(button('Done', 'primary', () => { void finish(true); }, { 'data-action': 'finish' }), ender.node);
    }
  }

  const sourceLine = h('p', { class: 'sl-muted sl-source' }, `Figure: ${activity.figure.cite}.`);
  shell.append(
    bar(KIND_LABEL.label, activity.title, deps, () => { void leave(); }),
    h('main', { class: 'sl-main' },
      deps.reason ? h('p', { class: 'mnx-feedback mnx-feedback--hint', 'data-role': 'reason' }, deps.reason) : null,
      h('p', { class: 'sl-muted' }, `${MODULE_LONG[activity.module]} · ${LEVEL[activity.level]} · about ${activity.minutes} min`),
      resumed ? h('p', { class: 'sl-muted', 'data-role': 'resumed' }, 'Welcome back. You are where you left off.') : null,
      ctxBlock,
      h('div', { class: 'sl-grid' },
        h('div', { class: 'sl-figcol' }, fig, sourceLine),
        h('div', { class: 'sl-answers' },
          h('div', { class: 'sl-answers__head' }, h('h2', { class: 'sl-subhead' }, 'Name each hidden label'), bankButton),
          bank, list, progress, feedback, footer))));
  setZoom(0);
  paintAll();
  renderPhase();
  const first = activity.labels.find((l) => !(draft.answers[l.id] ?? '').trim()) ?? activity.labels[0];
  activate(first.id, false);
  (shell as HTMLElement & { settingsChanged?: () => void }).settingsChanged = () => {
    if (draft.phase !== 'answer') return;
    for (const r of rows.values()) { r.input.readOnly = pickMode(); r.input.placeholder = pickMode() ? 'Pick from the word bank' : 'Type the label'; r.hintButton.hidden = !deps.settings().showHints; }
    bankButton.hidden = pickMode() || draft.bank || !deps.settings().showHints;
    paintBank();
  };
}
