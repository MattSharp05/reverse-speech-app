import { describe, expect, it } from 'vitest';
import { players, testCtx } from '../../test/fixtures';
import { packDrawing, unpackDrawing } from './pack';
import { chainFor, doodle, type DoodleState } from './rules';

const line = [{ c: 1, s: 2, p: [0, 1, 799, 599, 400, 300] }];

function setup(n = 4, steps = 4) {
  const ctx = testCtx(6);
  return { ctx, s: doodle.init(players(n), { ...doodle.defaults, steps }, ctx) };
}

function playStep(s: DoodleState, ctx: ReturnType<typeof testCtx>): DoodleState {
  for (const p of s.players) {
    const action =
      s.phase === 'write'
        ? { type: 'write', text: `start ${p.id}` }
        : s.phase === 'draw'
          ? { type: 'draw', drawing: line }
          : { type: 'guess', text: `guess ${p.id} ${s.step}` };
    s = doodle.act(s, p.id, action, ctx);
  }
  return s;
}

describe('telephone doodle', () => {
  it('packs drawings compactly and back', () => {
    expect(unpackDrawing(packDrawing(line))).toEqual(line);
    expect(packDrawing(line).length).toBeLessThan(JSON.stringify(line).length);
    expect(unpackDrawing('zz!')).toBeNull();
  });

  it('passes each chain to a different player every step: write, draw, guess, draw', () => {
    const { ctx, s: s0 } = setup(4, 4);
    let s = s0;
    const seen = new Map<number, Set<string>>();
    for (let step = 0; step < 4; step++) {
      expect(s.phase).toBe(['write', 'draw', 'guess', 'draw'][step]);
      for (const p of s.players) {
        const c = chainFor(s, p.id);
        const set = seen.get(c) ?? new Set();
        expect(set.has(p.id)).toBe(false);
        set.add(p.id);
        seen.set(c, set);
      }
      s = playStep(s, ctx);
    }
    expect(s.phase).toBe('show');
    expect(s.chains.every((c) => c.map((e) => e.kind).join() === 'text,drawing,text,drawing')).toBe(true);
  });

  it('you draw the phrase before you and guess the drawing before you', () => {
    const { ctx, s: s0 } = setup(3, 3);
    let s = playStep(s0, ctx);
    const p = s.players[0]!.id;
    const pv = doodle.privateView(s, p) as { text: string };
    expect(pv.text).toBe(s.chains[chainFor(s, p)]![0]!.text);
    s = playStep(s, ctx);
    const pv2 = doodle.privateView(s, p) as { drawing: string };
    expect(unpackDrawing(pv2.drawing)).toEqual(line);
  });

  it('fills in what’s missing when time runs out (the suggestion, an empty drawing, ???)', () => {
    const { ctx, s: s0 } = setup(3, 3);
    let s = doodle.advance(s0, ctx);
    expect(s.chains.map((c) => c[0]!.text)).toEqual(s.order.map((id) => s0.suggestions[id]));
    s = doodle.advance(s, ctx);
    expect(s.chains.every((c) => c[1]!.drawing!.length === 0)).toBe(true);
    s = doodle.advance(s, ctx);
    expect(s.chains.every((c) => c[2]!.text === '???')).toBe(true);
  });

  it('turns away oversized drawings and second entries', () => {
    const { ctx, s: s0 } = setup(3, 3);
    let s = playStep(s0, ctx);
    const big = [{ c: 0, s: 0, p: Array.from({ length: 7000 }, (_, i) => i % 500) }];
    expect(doodle.act(s, 'p0', { type: 'draw', drawing: big }, ctx)).toBe(s);
    s = doodle.act(s, 'p0', { type: 'draw', drawing: line }, ctx);
    expect(doodle.act(s, 'p0', { type: 'draw', drawing: line }, ctx)).toBe(s);
  });

  it('plays back each chain, then votes for a favourite entry (not your own)', () => {
    const { ctx, s: s0 } = setup(3, 3);
    let s = s0;
    for (let k = 0; k < 3; k++) s = playStep(s, ctx);
    expect(s.phase).toBe('show');
    while (s.phase === 'show') s = doodle.advance(s, ctx);
    expect(s.phase).toBe('vote');
    const chain = s.chains[s.chain]!;
    const voter = chain[1]!.author;
    const own = chain.findIndex((e) => e.author === voter);
    expect(doodle.act(s, voter, { type: 'vote', entry: own }, ctx)).toBe(s);
    expect(doodle.act(s, voter, { type: 'vote', entry: 0 }, ctx)).toBe(s); // the starting phrase isn't up
    const target = chain.findIndex((e, i) => i > 0 && e.author !== voter);
    s = doodle.act(s, voter, { type: 'vote', entry: target }, ctx);
    s = doodle.advance(s, ctx);
    expect(s.scores[chain[target]!.author]).toBe(500);
    while (!doodle.done(s)) s = doodle.advance(s, ctx);
  });
});
