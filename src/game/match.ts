/**
 * How forgiving the auto-check is. Case, spaces, punctuation and accents never count;
 * words this long or longer may be one typo off.
 */
export const TYPO_MIN_LENGTH = 5;

/** Letters and digits only, lower case, accents removed ("Café!" → "cafe"). */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Edit distance (insertions, deletions, substitutions; a swap of neighbours counts as one). */
export function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * correct: counts automatically. close: a near miss the word's owner may want to count
 * (the UI offers "Count it" for any miss, but says "so close!" for these). wrong: not close.
 */
export function judge(guess: string, answer: string): 'correct' | 'close' | 'wrong' {
  const g = normalize(guess);
  const a = normalize(answer);
  if (!g || !a) return 'wrong';
  if (g === a) return 'correct';
  const d = distance(g, a);
  if (d <= 1 && a.length >= TYPO_MIN_LENGTH) return 'correct';
  // Plurals, a missed letter on a short word, "cot" for "cat".
  if (d <= Math.min(2, Math.floor(a.length / 2))) return 'close';
  return 'wrong';
}
