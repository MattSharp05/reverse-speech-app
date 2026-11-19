import { describe, expect, it } from 'vitest';
import { players, testCtx } from '../../test/fixtures';
import { hotTakes, MAJORITY_POINTS, type HotState } from './rules';

function setup(mix: string) {
  const ctx = testCtx(8);
  return { ctx, s: hotTakes.init(players(3), { ...hotTakes.defaults, mix }, ctx) };
}

describe('hot takes', () => {
  it('deals only the kind of question asked for', () => {
    expect(setup('who').s.questions.every((q) => q.kind === 'who')).toBe(true);
    expect(setup('scale').s.questions.every((q) => q.kind === 'scale')).toBe(true);
  });

  it('“who” questions: points for picking who the group picked', () => {
    const { ctx, s: s0 } = setup('who');
    let s = hotTakes.act(s0, 'p0', { type: 'pick', player: 'p1' }, ctx);
    expect(hotTakes.act(s, 'p0', { type: 'pick', player: 'p2' }, ctx)).toBe(s); // once
    expect(hotTakes.act(s, 'p1', { type: 'pick', player: 'nobody' }, ctx)).toBe(s);
    expect(hotTakes.act(s, 'p1', { type: 'rate', own: 3, guess: 3 }, ctx)).toBe(s); // wrong kind
    s = hotTakes.act(s, 'p1', { type: 'pick', player: 'p1' }, ctx); // yourself is fine
    s = hotTakes.act(s, 'p2', { type: 'pick', player: 'p0' }, ctx);
    expect(s.phase).toBe('reveal');
    // p1 got two picks: p0 and p1 read the room, p2 didn't.
    expect(s.scores).toEqual({ p0: MAJORITY_POINTS, p1: MAJORITY_POINTS, p2: 0 });
  });

  it('scale questions: closer guesses at the average score more', () => {
    const { ctx, s: s0 } = setup('scale');
    let s: HotState = s0;
    expect(hotTakes.act(s, 'p0', { type: 'rate', own: 11, guess: 5 }, ctx)).toBe(s);
    s = hotTakes.act(s, 'p0', { type: 'rate', own: 2, guess: 5 }, ctx); // average will be 5: exact
    s = hotTakes.act(s, 'p1', { type: 'rate', own: 5, guess: 7 }, ctx); // 2 off
    s = hotTakes.act(s, 'p2', { type: 'rate', own: 8, guess: 10 }, ctx); // 5 off
    expect(s.phase).toBe('reveal');
    expect(s.scores).toEqual({ p0: 1000, p1: 500, p2: 0 });
    const view = hotTakes.view(s) as { average: number };
    expect(view.average).toBe(5);
  });

  it('keeps answers hidden until the reveal, and ends', () => {
    const { ctx, s: s0 } = setup('who');
    const s = hotTakes.act(s0, 'p0', { type: 'pick', player: 'p1' }, ctx);
    expect((hotTakes.view(s) as { picks: unknown }).picks).toBeNull();
    let t = s;
    while (!hotTakes.done(t)) t = hotTakes.advance(t, ctx);
  });
});
