import { describe, expect, it } from 'vitest';
import { players, testCtx } from '../../test/fixtures';
import { CATCH_POINTS, ESCAPE_POINTS, GUESS_POINTS, oddOne, wordFor, type OddState } from './rules';

function setup(settings = {}) {
  const ctx = testCtx(5);
  const s = oddOne.init(players(4), { ...oddOne.defaults, ...settings }, ctx);
  return { ctx, s };
}
const odd = (s: OddState) => s.odds[s.round]!;
function clueAll(s: OddState, ctx: ReturnType<typeof testCtx>) {
  for (const p of s.players) s = oddOne.act(s, p.id, { type: 'clue', text: `clue from ${p.id}` }, ctx);
  return s;
}

describe('odd one out', () => {
  it('gives everyone the word except the odd one, privately', () => {
    const { s } = setup();
    const o = odd(s);
    for (const p of s.players) {
      const pv = oddOne.privateView(s, p.id) as { word: string | null; odd: boolean };
      expect(pv.word).toBe(p.id === o ? null : s.pairs[0]!.word);
      expect(pv.odd).toBe(p.id === o);
    }
    const view = JSON.stringify(oddOne.view(s));
    expect(view).not.toContain(s.pairs[0]!.word);
    expect(view).not.toContain(`"odd":"${o}"`);
  });

  it('in similar-word mode the odd one gets the decoy and doesn’t know', () => {
    const { s } = setup({ mode: 'similar' });
    const pv = oddOne.privateView(s, odd(s)) as { word: string; odd: boolean };
    expect(pv).toMatchObject({ word: s.pairs[0]!.decoy, odd: false });
  });

  it('turns away clues that give the word away, and second clues', () => {
    const { ctx, s } = setup();
    const p = s.players.find((x) => x.id !== odd(s))!.id;
    const word = wordFor(s, p)!;
    expect(oddOne.act(s, p, { type: 'clue', text: `my ${word.toUpperCase()}` }, ctx).rejected[p]).toBe(
      'word',
    );
    expect(oddOne.act(s, p, { type: 'clue', text: `two ${word}s` }, ctx).rejected[p]).toBe('word');
    const once = oddOne.act(s, p, { type: 'clue', text: 'crunchy' }, ctx);
    expect(once.clues[p]).toBe('crunchy');
    expect(oddOne.act(once, p, { type: 'clue', text: 'again' }, ctx)).toBe(once);
  });

  it('no voting for yourself; catching the odd one scores, and they get a guess', () => {
    const { ctx, s: s0 } = setup();
    let s = clueAll(s0, ctx);
    expect(s.phase).toBe('vote');
    const o = odd(s);
    const others = s.players.map((p) => p.id).filter((id) => id !== o);
    expect(oddOne.act(s, others[0]!, { type: 'vote', player: others[0] }, ctx)).toBe(s);
    for (const v of others) s = oddOne.act(s, v, { type: 'vote', player: o }, ctx);
    s = oddOne.act(s, o, { type: 'vote', player: others[0] }, ctx);
    expect(s.phase).toBe('guess');
    expect(s.caught).toBe(true);
    for (const v of others) expect(s.scores[v]).toBe(CATCH_POINTS);
    expect(oddOne.act(s, others[0]!, { type: 'guess', text: 'x' }, ctx)).toBe(s);
    s = oddOne.act(s, o, { type: 'guess', text: s.pairs[0]!.word.toUpperCase() }, ctx);
    expect(s.phase).toBe('reveal');
    expect(s.guessed).toBe(true);
    expect(s.scores[o]).toBe(GUESS_POINTS);
  });

  it('an odd one who escapes scores big', () => {
    const { ctx, s: s0 } = setup();
    let s = clueAll(s0, ctx);
    const o = odd(s);
    const others = s.players.map((p) => p.id).filter((id) => id !== o);
    // Everyone suspects the same innocent player.
    for (const v of [o, ...others.slice(1)]) s = oddOne.act(s, v, { type: 'vote', player: others[0] }, ctx);
    s = oddOne.act(s, others[0]!, { type: 'vote', player: others[1] }, ctx);
    expect(s.phase).toBe('reveal');
    expect(s.caught).toBe(false);
    expect(s.scores[o]).toBe(ESCAPE_POINTS);
  });

  it('missing clues time out; every player is the odd one before anyone is twice', () => {
    const { ctx, s: s0 } = setup({ rounds: 4 });
    expect(new Set(s0.odds).size).toBe(4);
    let s = oddOne.advance(s0, ctx);
    expect(s.phase).toBe('vote');
    expect(Object.values(s.clues).every((c) => c === '…')).toBe(true);
    while (!oddOne.done(s)) s = oddOne.advance(s, ctx);
  });

  it('catches multi-word words inside a clue', () => {
    const ctx = testCtx(1);
    ctx.content.oddone = [
      {
        id: 'x',
        word: 'haunted house',
        decoy: 'escape room',
        category: 'places',
        maturity: 'family',
        source: 't',
      },
    ];
    const s = oddOne.init(players(3), oddOne.defaults, ctx);
    const p = s.players.find((x) => x.id !== odd(s))!.id;
    expect(oddOne.act(s, p, { type: 'clue', text: 'It is a Haunted House!' }, ctx).rejected[p]).toBe('word');
    expect(oddOne.act(s, p, { type: 'clue', text: 'haunted' }, ctx).clues[p]).toBe('haunted');
  });
});
