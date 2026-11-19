import { distance } from '../game/match';

/** Tidies what a player typed: trims, collapses whitespace, caps the length. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * An answer reduced to what matters when comparing two: lower case, no accents or punctuation,
 * no leading "a / an / the", single spaces.
 */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(a|an|the) /, '');
}

/** Two answers that mean the same (same words, or one typo apart on longer answers). */
export function sameAnswer(a: string, b: string): boolean {
  const x = normalizeAnswer(a);
  const y = normalizeAnswer(b);
  if (!x || !y) return false;
  if (x === y || x.replace(/ /g, '') === y.replace(/ /g, '')) return true;
  // One typo is the same answer, except in numbers (1985 isn't 1986).
  if (/\d/.test(x) || /\d/.test(y)) return false;
  return Math.min(x.length, y.length) >= 6 && distance(x, y) <= 1;
}
