import type { Drawing } from '../sketch/rules';

/**
 * A compact text form for drawings, so several fit in one message: each stroke is its colour
 * and size digits, then two characters per coordinate (5 bits each, so 0–1023), strokes
 * separated by `|`. About half the size of JSON.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuv';

export function packDrawing(strokes: Drawing): string {
  return strokes
    .map((s) => `${s.c}${s.s}` + s.p.map((v) => ALPHABET[(v >> 5) & 31]! + ALPHABET[v & 31]!).join(''))
    .join('|');
}

/** The strokes back, or null for text that isn't a packed drawing. */
export function unpackDrawing(text: string): Drawing | null {
  if (typeof text !== 'string') return null;
  if (!text) return [];
  const strokes: Drawing = [];
  for (const part of text.split('|')) {
    if (part.length < 6 || (part.length - 2) % 4 !== 0) return null;
    const c = Number(part[0]);
    const s = Number(part[1]);
    const p: number[] = [];
    for (let i = 2; i < part.length; i += 2) {
      const hi = ALPHABET.indexOf(part[i]!);
      const lo = ALPHABET.indexOf(part[i + 1]!);
      if (hi < 0 || lo < 0) return null;
      p.push(hi * 32 + lo);
    }
    strokes.push({ c, s, p });
  }
  return strokes;
}
