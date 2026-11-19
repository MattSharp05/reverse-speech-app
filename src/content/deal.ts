import { shuffle, type Rng } from '../platform/rng';
import type { ContentLibrary, Maturity } from './schema';

/**
 * `count` items for a game: matching the filter, ones not used recently first (shuffled), then
 * recent ones if the pack runs short. Fewer come back only when the whole pack is smaller.
 */
export function deal<T extends { id: string }>(
  items: readonly T[],
  count: number,
  rng: Rng,
  recent: ReadonlySet<string>,
  filter: (item: T) => boolean = () => true,
): T[] {
  const pool = items.filter(filter);
  const fresh = shuffle(
    pool.filter((i) => !recent.has(i.id)),
    rng,
  );
  const stale = shuffle(
    pool.filter((i) => recent.has(i.id)),
    rng,
  );
  return [...fresh, ...stale].slice(0, count);
}

export const maturityOk = (setting: string | number, item: { maturity: Maturity }): boolean =>
  setting === 'adult' || item.maturity === 'family';

export const categoryOk = (setting: string | number, item: { category: string }): boolean =>
  setting === 'any' || item.category === setting;

export function categories(library: ContentLibrary, kind: 'quip' | 'bluff' | 'sketch'): string[] {
  return [...new Set(library[kind].map((i) => i.category))].sort();
}
