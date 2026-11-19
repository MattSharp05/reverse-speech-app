import type { BluffQuestion, ContentLibrary } from '../content/schema';
import type { Ctx, Player } from '../platform/module';
import { seeded } from '../platform/rng';

export const players = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, color: i }));

const bluffQ = (i: number): BluffQuestion => ({
  id: `b${i}`,
  text: `Question ${i} is ___.`,
  answer: `truth ${i}`,
  alternates: [`real ${i}`],
  decoys: [`decoy ${i}a`, `decoy ${i}b`],
  category: i % 2 ? 'odd' : 'even',
  difficulty: 'easy',
  maturity: 'family',
  source: 'test',
});

export function library(): ContentLibrary {
  return {
    quip: Array.from({ length: 60 }, (_, i) => ({
      id: `q${i}`,
      text: `Prompt ${i}`,
      category: 'general',
      maturity: i % 3 === 0 ? 'adult' : 'family',
      source: 'test',
    })),
    bluff: Array.from({ length: 20 }, (_, i) => bluffQ(i)),
    sketch: Array.from({ length: 40 }, (_, i) => ({
      id: `s${i}`,
      text: `A drawing of thing ${i}`,
      category: 'general',
      maturity: 'family',
      source: 'test',
    })),
    oddone: Array.from({ length: 12 }, (_, i) => ({
      id: `o${i}`,
      word: `apple${i}`,
      decoy: `pear${i}`,
      category: 'food',
      maturity: 'family',
      source: 'test',
    })),
    hottakes: Array.from({ length: 16 }, (_, i) => ({
      id: `h${i}`,
      kind: i % 2 ? 'scale' : 'who',
      text: `Question ${i}`,
      ...(i % 2 ? { low: 'No', high: 'Yes' } : {}),
      category: 'test',
      maturity: 'family',
      source: 'test',
    })),
    recent: new Set(),
  };
}

/** A context whose clock the test moves. */
export function testCtx(seed = 1): Ctx & { at(ms: number): Ctx } {
  const ctx = { now: 1_000_000, rng: seeded(seed), content: library() };
  return {
    ...ctx,
    at(ms: number) {
      ctx.now = ms;
      return ctx;
    },
  };
}
