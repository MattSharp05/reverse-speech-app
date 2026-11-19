import { describe, expect, it } from 'vitest';
import { players, testCtx } from '../../test/fixtures';
import { quip, type QuipState } from './rules';

function setup(n = 4, settings = {}) {
  const ctx = testCtx(3);
  const s = quip.init(players(n), { ...quip.defaults, ...settings }, ctx);
  return { ctx, s };
}

function answerAll(s: QuipState, ctx: ReturnType<typeof testCtx>): QuipState {
  s = quip.advance(s, ctx); // intro → answer
  for (const [index, m] of s.matchups.entries())
    for (const author of m.authors) s = quip.act(s, author, { type: 'answer', matchup: index, text: `answer ${index}-${m.authors.indexOf(author)}` }, ctx);
  return s;
}

describe('quip battle', () => {
  it('gives every player two prompts against two different players', () => {
    const { s } = setup(5);
    expect(s.matchups).toHaveLength(5);
    for (const p of players(5)) {
      const mine = s.matchups.filter((m) => m.authors.includes(p.id));
      expect(mine).toHaveLength(2);
      expect(new Set(mine.flatMap((m) => m.authors)).size).toBe(3);
    }
    expect(new Set(s.matchups.map((m) => m.prompt.id)).size).toBe(5);
  });

  it('keeps adult prompts out of family games', () => {
    const { s } = setup(4);
    const adult = new Set(testCtx().content.quip.filter((p) => p.maturity === 'adult').map((p) => p.id));
    expect([...s.used, ...s.deck.map((d) => d.id)].some((id) => adult.has(id))).toBe(false);
  });

  it('only takes answers in the answer phase, once, for your own prompts', () => {
    const { ctx, s: s0 } = setup(3);
    expect(quip.act(s0, 'p0', { type: 'answer', matchup: 0, text: 'x' }, ctx)).toBe(s0);
    const s = quip.advance(s0, ctx);
    const m = s.matchups.findIndex((x) => !x.authors.includes('p0'));
    expect(quip.act(s, 'p0', { type: 'answer', matchup: m, text: 'x' }, ctx)).toBe(s);
    const own = s.matchups.findIndex((x) => x.authors.includes('p0'));
    const once = quip.act(s, 'p0', { type: 'answer', matchup: own, text: '  hi  ' }, ctx);
    expect(once.matchups[own]!.answers).toContain('hi');
    expect(quip.act(once, 'p0', { type: 'answer', matchup: own, text: 'again' }, ctx)).toBe(once);
    expect(quip.act(s, 'p0', { type: 'answer', matchup: own, text: '   ' }, ctx)).toBe(s);
  });

  it('moves to voting when everyone has answered, and authors cannot vote', () => {
    const { ctx, s: s0 } = setup(4);
    const s = answerAll(s0, ctx);
    expect(s.phase).toBe('vote');
    const m = s.matchups[0]!;
    expect(quip.act(s, m.authors[0]!, { type: 'vote', choice: 1 }, ctx)).toBe(s);
    const voter = players(4).find((p) => !m.authors.includes(p.id))!.id;
    const voted = quip.act(s, voter, { type: 'vote', choice: 0 }, ctx);
    expect(voted.matchups[0]!.votes[voter]).toEqual([0]);
    expect(quip.act(voted, voter, { type: 'vote', choice: 1 }, ctx)).toBe(voted);
    expect(quip.act(s, voter, { type: 'vote', choice: 5 }, ctx)).toBe(s);
  });

  it('scores votes, the winner bonus and a clean sweep', () => {
    const { ctx, s: s0 } = setup(4);
    let s = answerAll(s0, ctx);
    const m = s.matchups[0]!;
    const voters = players(4).map((p) => p.id).filter((id) => !m.authors.includes(id));
    for (const v of voters) s = quip.act(s, v, { type: 'vote', choice: 0 }, ctx);
    expect(s.phase).toBe('result');
    // 2 votes × 100 + win 100 + sweep 200.
    expect(s.matchups[0]!.points).toEqual({ [m.authors[0]!]: 500, [m.authors[1]!]: 0 });
    expect(s.matchups[0]!.sweep).toBe(0);
    const v = quip.view(s) as { answers: { author: string }[] };
    expect(v.answers[0]!.author).toBe(m.authors[0]);
  });

  it('hides authors while voting', () => {
    const { ctx, s: s0 } = setup(4);
    const s = answerAll(s0, ctx);
    const v = quip.view(s) as { answers: { author: string | null; votes: unknown }[] };
    expect(v.answers.every((a) => a.author === null && a.votes === null)).toBe(true);
    expect(JSON.stringify(quip.view(s))).not.toContain('"author":"');
  });

  it('a missing answer is a forfeit, with no vote', () => {
    const { ctx, s: s0 } = setup(3);
    let s = quip.advance(s0, ctx);
    const m = s.matchups[0]!;
    s = quip.act(s, m.authors[0]!, { type: 'answer', matchup: 0, text: 'only me' }, ctx);
    s = quip.advance(s, ctx); // time up
    expect(s.phase).toBe('result');
    expect(s.matchups[0]!.points[m.authors[0]!]).toBe(100);
  });

  it('plays rounds, then a final everyone answers with three votes each, then ends', () => {
    const { ctx, s: s0 } = setup(4, { rounds: 1 });
    let s = s0;
    for (let i = 0; i < 30 && !(s.hasFinal && s.round === 1 && s.phase === 'answer'); i++) s = quip.advance(s, ctx);
    expect(s.matchups).toHaveLength(1);
    expect(s.matchups[0]!.authors).toHaveLength(4);
    for (const p of players(4)) s = quip.act(s, p.id, { type: 'answer', matchup: 0, text: `${p.id}!` }, ctx);
    expect(s.phase).toBe('vote');
    expect(quip.act(s, 'p0', { type: 'vote', choices: [0, 1, 2, 3] }, ctx)).toBe(s);
    const own = s.matchups[0]!.authors.indexOf('p0');
    expect(quip.act(s, 'p0', { type: 'vote', choices: [own] }, ctx)).toBe(s);
    const others = [0, 1, 2, 3].filter((i) => i !== own);
    s = quip.act(s, 'p0', { type: 'vote', choices: others }, ctx);
    expect(s.matchups[0]!.votes.p0).toEqual(others);
    while (s.phase !== 'done') s = quip.advance(s, ctx);
    expect(quip.done(s)).toBe(true);
  });

  it('private views only show your own prompts', () => {
    const { ctx, s: s0 } = setup(4);
    const s = quip.advance(s0, ctx);
    const pv = quip.privateView(s, 'p1') as { prompts: { index: number }[] };
    expect(pv.prompts).toHaveLength(2);
    for (const p of pv.prompts) expect(s.matchups[p.index]!.authors).toContain('p1');
    expect((quip.view(s) as { prompt: unknown }).prompt).toBeNull();
  });
});
