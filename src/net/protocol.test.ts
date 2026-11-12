import { describe, expect, it } from 'vitest';
import { ClipAssembler, CLIP_PART_CHARS, splitClip } from './protocol';

describe('clip parts', () => {
  it('splits a long clip and puts it back together in any order', () => {
    const data = 'x'.repeat(CLIP_PART_CHARS * 2) + 'tail';
    const parts = splitClip('me', 'c1', data);
    expect(parts).toHaveLength(3);
    const assembler = new ClipAssembler();
    expect(assembler.add(parts[2]!)).toBeNull();
    expect(assembler.add(parts[0]!)).toBeNull();
    expect(assembler.add(parts[0]!)).toBeNull();
    expect(assembler.add(parts[1]!)).toBe(data);
  });

  it('sends a short clip in one message', () => {
    const [only] = splitClip('me', 'c2', 'abc');
    expect(new ClipAssembler().add(only!)).toBe('abc');
  });
});
