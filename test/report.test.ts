import { describe, expect, test } from 'bun:test';
import { validatePracticeResult } from '../../mnx-addon-kit-release/sdk/src/practice.mjs';
import { blankTarget, buildFindResult, buildLabelResult, emptyFindDraft, emptyLabelDraft, labelMatches, matches, normalise, parseFindDraft, parseLabelDraft, selectorHas, targetHas } from '../src/report';
import type { FindActivity, LabelActivity } from '../src/types';

const label: LabelActivity = {
  id: 'sl-l-test', kind: 'label', module: 'gem', title: 't', summary: 's', level: 2, minutes: 4, skills: ['transcription'], context: 'c', cite: [],
  figure: { src: 'a', full: 'b', width: 100, height: 100, alt: 'x', cite: 'x' },
  bank: [],
  labels: [
    { id: 'b1', answer: 'Sigma factor', accept: ['σ factor', 'sigma'], box: [0, 0, 10, 10], hint: 'h', why: 'w', cite: [] },
    { id: 'b2', answer: 'Beta prime clamp', accept: ["β' clamp", 'beta prime'], box: [0, 20, 10, 10], hint: 'h', why: 'w', cite: [] },
    { id: 'b3', answer: 'Rudder', accept: [], box: [0, 40, 10, 10], hint: 'h', why: 'w', cite: [] },
  ],
};

describe('matching typed labels', () => {
  test('ignores case, punctuation, Greek letters and a leading article', () => {
    expect(normalise("The  β′-Clamp!")).toBe('beta prime clamp');
    expect(matches('SIGMA   factor', ['Sigma factor'])).toBe(true);
    expect(matches('σ factor', ['sigma factor'])).toBe(true);
    expect(matches('the rudder', ['Rudder'])).toBe(true);
  });
  test('allows one slip in a long word, none in a short one', () => {
    expect(matches('Sigma facter', ['Sigma factor'])).toBe(true);
    expect(matches('Rudde', ['Rudder'])).toBe(false);
    expect(matches('TFIIB', ['TFIIE'])).toBe(false);
  });
  test('a different thing is not a match', () => {
    expect(matches('lid', ['Rudder'])).toBe(false);
    expect(matches('', ['Rudder'])).toBe(false);
    expect(labelMatches("beta' clamp", label.labels[1])).toBe(true);
  });
});

describe('a label run', () => {
  test('one criterion per label, no grade, valid result shape', () => {
    const draft = { ...emptyLabelDraft(), answers: { b1: 'sigma', b2: 'lid', b3: 'Rudder' }, checks: 2 };
    const result = buildLabelResult({ activity: label, draft, hintsUsed: 1, finished: true });
    expect(() => validatePracticeResult(result)).not.toThrow();
    expect(result.valid).toBe(true);
    expect(result.criteria.map((c) => c.met)).toEqual([true, false, true]);
    expect(result.criteria).toHaveLength(3);
    expect(result.hintsUsed).toBe(1);
    expect(result.attempts).toBe(2);
    expect(Object.keys(result)).not.toContain('grade');
  });
  test('a confusion between two labels is recorded', () => {
    const draft = { ...emptyLabelDraft(), answers: { b1: 'Rudder', b2: 'Beta prime clamp', b3: 'sigma factor' } };
    const result = buildLabelResult({ activity: label, draft, hintsUsed: 0, finished: true });
    expect(result.misconceptions?.length).toBe(2);
  });
  test('ended early or nearly empty does not count', () => {
    const ended = buildLabelResult({ activity: label, draft: { ...emptyLabelDraft(), answers: { b1: 'sigma' } }, hintsUsed: 0, finished: false });
    expect(ended.valid).toBe(false);
    expect(ended.criteria).toEqual([]);
    expect(() => validatePracticeResult(ended)).not.toThrow();
    const empty = buildLabelResult({ activity: label, draft: emptyLabelDraft(), hintsUsed: 0, finished: true });
    expect(empty.valid).toBe(false);
    expect(empty.criteria).toHaveLength(3);
  });
  test('counting your own answer as right is said so', () => {
    const draft = { ...emptyLabelDraft(), answers: { b1: 'the sigma subunit', b2: 'x', b3: 'y' }, own: { b1: true } };
    const result = buildLabelResult({ activity: label, draft, hintsUsed: 0, finished: true });
    expect(result.criteria[0].met).toBe(true);
    expect(result.criteria[0].label).toContain('counted by the learner');
  });
  test('a damaged draft is ignored and unknown rows are dropped', () => {
    expect(parseLabelDraft('{not json', label)).toBeNull();
    expect(parseLabelDraft(JSON.stringify({ v: 2 }), label)).toBeNull();
    const d = parseLabelDraft(JSON.stringify({ v: 1, phase: 'answer', answers: { b1: 'x', zz: 'y' }, checks: 3, elapsed: 5 }), label);
    expect(d?.answers).toEqual({ b1: 'x' });
  });
});

const find: FindActivity = {
  id: 'sl-s-test', kind: 'find', module: 'bri', title: 't', summary: 's', level: 2, minutes: 4, skills: ['serine-protease'], context: 'c', cite: [], pdb: '5CHA',
  entry: { title: 'x', file: 'assets/structures/5cha.cif' },
  targets: [
    { id: 't1', ask: 'Click the catalytic serine.', name: 'Ser195', select: [{ chain: 'B', resi: 195, resn: 'SER' }], hint: 'h', why: 'w', ref: 'r', cite: [] },
    { id: 't2', ask: 'Click the loop.', name: 'Loop', select: [{ chain: 'A', from: 10, to: 20 }], hint: 'h', why: 'w', ref: 'r', cite: [] },
  ],
};

describe('a find run', () => {
  test('selectors hit residues, runs and chains', () => {
    expect(selectorHas(find.targets[0].select[0], { chain: 'B', resi: 195, resn: 'SER' })).toBe(true);
    expect(selectorHas(find.targets[0].select[0], { chain: 'B', resi: 195, resn: 'ALA' })).toBe(false);
    expect(selectorHas(find.targets[0].select[0], { chain: 'A', resi: 195, resn: 'SER' })).toBe(false);
    expect(targetHas(find.targets[1], { chain: 'A', resi: 15, resn: 'GLY' })).toBe(true);
    expect(targetHas(find.targets[1], { chain: 'A', resi: 21, resn: 'GLY' })).toBe(false);
    expect(selectorHas({ chain: 'E' }, { chain: 'E', resi: 3, resn: 'LYS' })).toBe(true);
  });
  test('found within the allowance counts, shown or too many misses does not', () => {
    const draft = { ...emptyFindDraft(), clicks: 5, targets: { t1: { ...blankTarget(), status: 'found' as const, misses: 1 }, t2: { ...blankTarget(), status: 'shown' as const, misses: 0 } } };
    const result = buildFindResult({ activity: find, draft, hintsUsed: 1, finished: true });
    expect(() => validatePracticeResult(result)).not.toThrow();
    expect(result.criteria.map((c) => c.met)).toEqual([true, false]);
    expect(result.valid).toBe(true);
    expect(result.hintsUsed).toBe(1);
    const slow = { ...draft, targets: { ...draft.targets, t1: { ...blankTarget(), status: 'found' as const, misses: 9 } } };
    expect(buildFindResult({ activity: find, draft: slow, hintsUsed: 0, finished: true }).criteria[0].met).toBe(false);
  });
  test('ended early does not count', () => {
    const result = buildFindResult({ activity: find, draft: emptyFindDraft(), hintsUsed: 0, finished: false });
    expect(result.valid).toBe(false);
    expect(result.criteria).toEqual([]);
    expect(() => validatePracticeResult(result)).not.toThrow();
  });
  test('a saved draft keeps only what this version writes', () => {
    expect(parseFindDraft('nonsense', find)).toBeNull();
    const d = parseFindDraft(JSON.stringify({ v: 1, phase: 'find', index: 9, targets: { t1: { status: 'found', misses: 2, hint: true }, tx: { status: 'found' } }, clicks: 4 }), find);
    expect(d?.index).toBe(1);
    expect(Object.keys(d?.targets ?? {})).toEqual(['t1']);
  });
});
