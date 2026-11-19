import { describe, expect, it } from 'vitest';
import { players, testCtx } from '../../test/fixtures';
import { bluff, FOOL_POINTS, TRUTH_POINTS, type BluffState } from './rules';

function setup(n = 3, settings = {}) {
  const ctx = testCtx(5);
  return { ctx, s: bluff.init(players(n), { ...bluff.defaults, ...settings }, ctx) };
}
const truthOf = (s: BluffState) => s.questions[s.index]!.answer;

describe('bluff it', () => {
  it('keeps the answer out of every view until the reveal', () => {
    const { s } = setup();
    expect(JSON.stringify(bluff.view(s))).not.toContain(truthOf(s));
    expect(JSON.stringify(bluff.privateView(s, 'p0'))).not.toContain(truthOf(s));
  });

  it('turns away the real answer (and its variants), empty lies and second lies', () => {
    const { ctx, s } = setup();
    const q = s.questions[0]!;
    const told = bluff.act(s, 'p0', { type: 'lie', text: q.answer.toUpperCase() }, ctx);
    expect(told.lies.p0).toBeUndefined();
    expect(told.rejected.p0).toBe('truth');
    expect(bluff.act(s, 'p0', { type: 'lie', text: q.alternates[0] }, ctx).lies.p0).toBeUndefined();
    expect(bluff.act(s, 'p0', { type: 'lie', text: '   ' }, ctx)).toBe(s);
    const lied = bluff.act(told, 'p0', { type: 'lie', text: 'a fib' }, ctx);
    expect(lied.lies.p0).toBe('a fib');
    expect(lied.rejected.p0).toBeNull();
    expect(bluff.act(lied, 'p0', { type: 'lie', text: 'another' }, ctx)).toBe(lied);
  });

  it('merges equivalent lies, pads with house decoys, and bars picking your own lie', () => {
    const { ctx, s: s0 } = setup(3);
    let s = bluff.act(s0, 'p0', { type: 'lie', text: 'The Moon' }, ctx);
    s = bluff.act(s, 'p1', { type: 'lie', text: 'moon!' }, ctx);
    s = bluff.act(s, 'p2', { type: 'lie', text: 'Mars' }, ctx);
    expect(s.phase).toBe('pick');
    const moon = s.options.findIndex((o) => o.authors.length === 2);
    expect(s.options[moon]!.authors.sort()).toEqual(['p0', 'p1']);
    expect(s.options).toHaveLength(3);
    expect(bluff.act(s, 'p0', { type: 'pick', option: moon }, ctx)).toBe(s);
    expect(bluff.act(s, 'p0', { type: 'pick', option: 99 }, ctx)).toBe(s);
  });

  it('adds decoys when there are too few lies', () => {
    const { ctx, s: s0 } = setup(2);
    const s = bluff.advance(s0, ctx);
    expect(s.options).toHaveLength(3);
    expect(s.options.filter((o) => o.house)).toHaveLength(2);
  });

  it('scores the truth and each player fooled', () => {
    const { ctx, s: s0 } = setup(3, { questions: 4 });
    let s = bluff.act(s0, 'p0', { type: 'lie', text: 'alpha' }, ctx);
    s = bluff.act(s, 'p1', { type: 'lie', text: 'beta' }, ctx);
    s = bluff.act(s, 'p2', { type: 'lie', text: 'gamma' }, ctx);
    const truth = s.options.findIndex((o) => o.truth);
    const alpha = s.options.findIndex((o) => o.text === 'alpha');
    s = bluff.act(s, 'p0', { type: 'pick', option: truth }, ctx);
    s = bluff.act(s, 'p1', { type: 'pick', option: alpha }, ctx);
    s = bluff.act(s, 'p2', { type: 'pick', option: alpha }, ctx);
    expect(s.phase).toBe('reveal');
    expect(s.scores).toEqual({ p0: TRUTH_POINTS + 2 * FOOL_POINTS, p1: 0, p2: 0 });
    const v = bluff.view(s) as { answer: string; options: { pickedBy: string[] }[] };
    expect(v.answer).toBe(truthOf(s));
    expect(v.options[alpha]!.pickedBy).toEqual(['p1', 'p2']);
  });

  it('missing lies and picks just time out', () => {
    const { ctx, s: s0 } = setup(3, { questions: 4 });
    let s = bluff.advance(s0, ctx);
    s = bluff.advance(s, ctx);
    expect(s.phase).toBe('reveal');
    expect(Object.values(s.scores).every((v) => v === 0)).toBe(true);
    while (!bluff.done(s)) s = bluff.advance(s, ctx);
    expect(s.used).toHaveLength(4);
  });

  it('doubles points on the last question', () => {
    const { ctx, s: s0 } = setup(2, { questions: 4 });
    let s = s0;
    while (s.index < 3) s = bluff.advance(s, ctx);
    s = bluff.advance(s, ctx);
    const truth = s.options.findIndex((o) => o.truth);
    s = bluff.act(s, 'p0', { type: 'pick', option: truth }, ctx);
    s = bluff.advance(s, ctx);
    expect(s.gained.p0).toBe(2 * TRUTH_POINTS);
  });
});
