import { describe, expect, it } from 'vitest';
import { players, testCtx } from '../../test/fixtures';
import {
  ARTIST_POINTS,
  FOOL_POINTS,
  MAX_STROKES,
  sketchIt,
  TRUTH_POINTS,
  validDrawing,
  type SketchState,
} from './rules';

const line = [{ c: 0, s: 1, p: [10, 10, 200, 300] }];

function setup(n = 3) {
  const ctx = testCtx(7);
  return { ctx, s: sketchIt.init(players(n), sketchIt.defaults, ctx) };
}
function drawAll(s: SketchState, ctx: ReturnType<typeof testCtx>) {
  for (const p of s.players) s = sketchIt.act(s, p.id, { type: 'draw', drawing: line }, ctx);
  return s;
}

describe('sketch it', () => {
  it('validates drawings', () => {
    expect(validDrawing(line)).toEqual(line);
    expect(validDrawing([])).toBeNull();
    expect(validDrawing([{ c: 0, s: 0, p: [1] }])).toBeNull();
    expect(validDrawing([{ c: 99, s: 0, p: [1, 1] }])).toBeNull();
    expect(validDrawing([{ c: 0, s: 0, p: [1, 9999] }])).toBeNull();
    expect(validDrawing([{ c: 0, s: 0, p: [1.5, 2] }])).toBeNull();
    expect(validDrawing(Array.from({ length: MAX_STROKES + 1 }, () => line[0]))).toBeNull();
    expect(validDrawing('nope')).toBeNull();
  });

  it('gives everyone a different prompt, privately', () => {
    const { s } = setup(4);
    const prompts = s.players.map((p) => (sketchIt.privateView(s, p.id) as { prompt: string }).prompt);
    expect(new Set(prompts).size).toBe(4);
    const view = JSON.stringify(sketchIt.view(s));
    for (const prompt of prompts) expect(view).not.toContain(prompt);
  });

  it('takes one drawing each, then shows them one at a time', () => {
    const { ctx, s: s0 } = setup(3);
    const once = sketchIt.act(s0, 'p0', { type: 'draw', drawing: line }, ctx);
    expect(sketchIt.act(once, 'p0', { type: 'draw', drawing: line }, ctx)).toBe(once);
    const s = drawAll(s0, ctx);
    expect(s.phase).toBe('caption');
    expect(s.order).toHaveLength(3);
    const v = sketchIt.view(s) as { drawing: unknown; prompt: unknown };
    expect(v.drawing).toEqual(line);
    expect(v.prompt).toBeNull();
  });

  it('skips players who drew nothing', () => {
    const { ctx, s: s0 } = setup(3);
    let s = sketchIt.act(s0, 'p1', { type: 'draw', drawing: line }, ctx);
    s = sketchIt.advance(s, ctx);
    expect(s.order).toHaveLength(1);
    expect(s.sketches[s.order[0]!]!.artist).toBe('p1');
  });

  it('artists do not caption or vote; the real prompt is turned away as a caption', () => {
    const { ctx, s: s0 } = setup(3);
    const s = drawAll(s0, ctx);
    const artist = s.sketches[s.order[0]!]!.artist;
    const truth = s.sketches[s.order[0]!]!.prompt.text;
    expect(sketchIt.act(s, artist, { type: 'caption', text: 'mine' }, ctx)).toBe(s);
    const other = s.players.find((p) => p.id !== artist)!.id;
    expect(sketchIt.act(s, other, { type: 'caption', text: truth.toLowerCase() }, ctx).rejected[other]).toBe(
      'truth',
    );
  });

  it('scores guessers, the artist and fooling captions', () => {
    const { ctx, s: s0 } = setup(3);
    let s = drawAll(s0, ctx);
    const artist = s.sketches[s.order[0]!]!.artist;
    const [a, b] = s.players.map((p) => p.id).filter((id) => id !== artist) as [string, string];
    s = sketchIt.act(s, a, { type: 'caption', text: 'a wild guess' }, ctx);
    s = sketchIt.act(s, b, { type: 'caption', text: 'another fib' }, ctx);
    expect(s.phase).toBe('vote');
    const truth = s.options.findIndex((o) => o.truth);
    const fibA = s.options.findIndex((o) => o.text === 'a wild guess');
    expect(sketchIt.act(s, artist, { type: 'vote', option: truth }, ctx)).toBe(s);
    expect(sketchIt.act(s, a, { type: 'vote', option: fibA }, ctx)).toBe(s);
    s = sketchIt.act(s, a, { type: 'vote', option: truth }, ctx);
    s = sketchIt.act(s, b, { type: 'vote', option: fibA }, ctx);
    expect(s.phase).toBe('reveal');
    expect(s.scores[a]).toBe(TRUTH_POINTS + FOOL_POINTS);
    expect(s.scores[artist]).toBe(ARTIST_POINTS);
    expect(s.scores[b]).toBe(0);
  });

  it('shows every drawing, then ends', () => {
    const { ctx, s: s0 } = setup(3);
    let s = drawAll(s0, ctx);
    let shown = 0;
    while (!sketchIt.done(s)) {
      if (s.phase === 'reveal') shown++;
      s = sketchIt.advance(s, ctx);
    }
    expect(shown).toBe(3);
  });
});
