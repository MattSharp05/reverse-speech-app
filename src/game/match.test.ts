import { describe, expect, it } from 'vitest';
import { distance, judge, normalize } from './match';

describe('normalize', () => {
  it('drops case, spaces, punctuation and accents', () => {
    expect(normalize('  Café! ')).toBe('cafe');
    expect(normalize('Ice-Cream')).toBe('icecream');
  });
});

describe('distance', () => {
  it('counts edits', () => {
    expect(distance('cat', 'cat')).toBe(0);
    expect(distance('cat', 'cut')).toBe(1);
    expect(distance('cat', 'cats')).toBe(1);
    expect(distance('banana', 'bananna')).toBe(1);
    expect(distance('', 'abc')).toBe(3);
  });
  it('counts a swap of neighbours as one', () => {
    expect(distance('pickle', 'pikcle')).toBe(1);
  });
});

describe('judge', () => {
  it('accepts exact matches whatever the case or spacing', () => {
    expect(judge('CAT', 'cat')).toBe('correct');
    expect(judge(' cat. ', 'Cat')).toBe('correct');
  });
  it('allows one typo on longer words only', () => {
    expect(judge('elefant', 'elephant')).toBe('close');
    expect(judge('pickel', 'pickle')).toBe('correct');
    expect(judge('banan', 'banana')).toBe('correct');
    expect(judge('cot', 'cat')).toBe('close');
  });
  it('calls plurals close', () => {
    expect(judge('cats', 'cat')).toBe('close');
  });
  it('rejects different words and empty guesses', () => {
    expect(judge('dog', 'cat')).toBe('wrong');
    expect(judge('', 'cat')).toBe('wrong');
    expect(judge('???', 'cat')).toBe('wrong');
  });
});
