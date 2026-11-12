import { describe, expect, it } from 'vitest';
import { cleanUp, decode, encode, normalize, reversed, SAMPLE_RATE, trimSilence } from './pcm';

const tone = (seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, i) => amp * Math.sin(i / 5));

function withSilence(before: number, word: Float32Array, after: number): Float32Array {
  const out = new Float32Array(Math.round((before + after) * SAMPLE_RATE) + word.length);
  out.set(word, Math.round(before * SAMPLE_RATE));
  return out;
}

describe('pcm', () => {
  it('reverses without touching the original', () => {
    const a = Float32Array.from([1, 2, 3]);
    expect([...reversed(a)]).toEqual([3, 2, 1]);
    expect([...a]).toEqual([1, 2, 3]);
  });

  it('trims silence around the word, keeping a little padding', () => {
    const word = tone(0.5);
    const trimmed = trimSilence(withSilence(1, word, 1.5));
    expect(trimmed.length).toBeGreaterThanOrEqual(word.length);
    expect(trimmed.length).toBeLessThan(word.length + 0.3 * SAMPLE_RATE);
  });

  it('leaves pure silence as it is', () => {
    expect(trimSilence(new Float32Array(1000)).length).toBe(1000);
  });

  it('normalizes the peak and fades the ends', () => {
    const out = normalize(tone(0.2, 0.1));
    const peak = Math.max(...out.map(Math.abs));
    expect(peak).toBeCloseTo(0.9, 1);
    expect(out[0]).toBe(0);
    expect(cleanUp(tone(0.2)).length).toBeGreaterThan(0);
  });

  it('round-trips through base64 16-bit PCM', () => {
    const a = tone(0.25);
    const b = decode(encode(a));
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i += 97) expect(b[i]).toBeCloseTo(a[i]!, 3);
    expect(encode(a).length).toBeLessThan(a.length * 2 * 1.4);
  });
});
