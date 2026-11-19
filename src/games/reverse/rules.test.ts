import { describe, expect, it } from 'vitest';
import { players, testCtx } from '../../test/fixtures';
import { reverse, type ReverseState } from './rules';

const words = (id: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ text: `${id}word${i}`, clip: `${id}-clip-${i}` }));

function setup(n = 4, settings = {}) {
  const ctx = testCtx(9);
  let s = reverse.init(players(n), { ...reverse.defaults, ...settings }, ctx);
  return {
    ctx,
    s,
    lockAll() {
      for (const p of s.players)
        s = reverse.act(s, p.id, { type: 'lockIn', words: words(p.id, s.rounds) }, ctx);
      return s;
    },
  };
}

describe('party reverse', () => {
  it('validates lock-ins', () => {
    const { ctx, s } = setup(3);
    expect(reverse.act(s, 'p0', { type: 'lockIn', words: words('p0', 2) }, ctx)).toBe(s);
    const dupes = [
      { text: 'same', clip: 'p0-a' },
      { text: 'Same', clip: 'p0-b' },
      { text: 'other', clip: 'p0-c' },
    ];
    expect(reverse.act(s, 'p0', { type: 'lockIn', words: dupes }, ctx)).toBe(s);
    expect(
      reverse.act(s, 'p0', { type: 'lockIn', words: [{ text: 'a', clip: '' }, ...words('p0', 2)] }, ctx),
    ).toBe(s);
    const locked = reverse.act(s, 'p0', { type: 'lockIn', words: words('p0', 3) }, ctx);
    expect(locked.locked).toEqual(['p0']);
    expect(reverse.act(locked, 'p0', { type: 'lockIn', words: words('p0', 3) }, ctx)).toBe(locked);
  });

  it('deals everyone someone else’s word, never twice', () => {
    const t = setup(4);
    let s = t.lockAll();
    expect(s.phase).toBe('guess');
    const seen = new Set<number>();
    for (let round = 0; round < 3; round++) {
      expect(s.attempts).toHaveLength(4);
      for (const a of s.attempts) {
        expect(s.words[a.word]!.owner).not.toBe(a.guesser);
        expect(seen.has(a.word)).toBe(false);
        seen.add(a.word);
      }
      s = reverse.advance(reverse.advance(s, t.ctx), t.ctx);
    }
    expect(s.phase).toBe('done');
  });

  it('keeps the word secret until the reveal', () => {
    const t = setup(3);
    const s = t.lockAll();
    const view = JSON.stringify(reverse.view(s));
    for (const w of s.words) expect(view).not.toContain(w.text);
    const pv = reverse.privateView(s, 'p0') as { attempt: { clip: string } };
    expect(JSON.stringify(pv)).not.toMatch(/p\dword/);
    expect(pv.attempt.clip).toMatch(/-clip-/);
  });

  it('judges guesses, lets the owner count a near miss once', () => {
    const t = setup(2, { words: 2 });
    let s: ReverseState = t.lockAll();
    const a0 = s.attempts.find((a) => a.guesser === 'p0')!;
    const a1 = s.attempts.find((a) => a.guesser === 'p1')!;
    s = reverse.act(s, 'p0', { type: 'mimic', clip: 'p0-mimic-1' }, t.ctx);
    s = reverse.act(s, 'p0', { type: 'guess', text: s.words[a0.word]!.text.toUpperCase() }, t.ctx);
    s = reverse.act(s, 'p1', { type: 'guess', text: 'nope' }, t.ctx);
    expect(s.phase).toBe('reveal');
    expect(s.scores).toEqual({ p0: 1, p1: 0 });
    const i1 = s.attempts.findIndex((a) => a.guesser === 'p1');
    expect(reverse.act(s, 'p1', { type: 'countIt', attempt: i1 }, t.ctx)).toBe(s);
    const owner = s.words[a1.word]!.owner;
    s = reverse.act(s, owner, { type: 'countIt', attempt: i1 }, t.ctx);
    expect(s.scores.p1).toBe(1);
    expect(reverse.act(s, owner, { type: 'countIt', attempt: i1 }, t.ctx)).toBe(s);
  });

  it('carries on without players who never locked in', () => {
    const { ctx, s: s0 } = setup(3, { words: 2 });
    let s = reverse.act(s0, 'p0', { type: 'lockIn', words: words('p0', 2) }, ctx);
    s = reverse.act(s, 'p1', { type: 'lockIn', words: words('p1', 2) }, ctx);
    s = reverse.advance(s, ctx); // record time up
    expect(s.phase).toBe('guess');
    expect(s.attempts.every((a) => s.words[a.word]!.owner !== 'p2')).toBe(true);
  });
});
