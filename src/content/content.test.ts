import { describe, expect, it } from 'vitest';
import bluffPacks from './packs/bluff.json';
import quipPacks from './packs/quip.json';
import sketchPacks from './packs/sketch.json';
import { buildLibrary, parseCsvPack, parsePack, rememberUsed } from './library';
import type { Pack } from './schema';

const packs = [...quipPacks, ...bluffPacks, ...sketchPacks] as unknown as Pack[];

describe('content packs', () => {
  const library = buildLibrary(packs);

  it('has plenty of each kind', () => {
    expect(library.quip.length).toBeGreaterThanOrEqual(500);
    expect(library.bluff.length).toBeGreaterThanOrEqual(100);
    expect(library.sketch.length).toBeGreaterThanOrEqual(150);
    expect(library.quip.filter((q) => q.maturity === 'family').length).toBeGreaterThanOrEqual(300);
  });

  it('has unique ids, a source and sensible text', () => {
    const all = [...library.quip, ...library.bluff, ...library.sketch];
    expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
    for (const item of all) {
      expect(item.source).toBeTruthy();
      expect(item.text.length).toBeGreaterThan(3);
      expect(item.text.length).toBeLessThanOrEqual(200);
    }
    for (const pack of packs) expect(pack.license).toBeTruthy();
  });

  it('bluff questions have an answer and decoys that differ from it', () => {
    for (const q of library.bluff) {
      expect(q.answer.trim()).not.toBe('');
      expect(q.decoys.length).toBeGreaterThanOrEqual(1);
      expect(q.decoys.map((d) => d.toLowerCase())).not.toContain(q.answer.toLowerCase());
    }
  });
});

describe('custom packs', () => {
  it('parses JSON packs, dropping bad entries', () => {
    const pack = parsePack(
      {
        id: 'friends',
        quip: ['What Dave really did in Vegas', { text: 'Name a ___', maturity: 'adult' }, '', 42],
        bluff: [{ text: 'Sam was born in ___', answer: 'Ohio', decoys: ['Texas'] }, { text: 'no answer' }],
        sketch: ['Dave as a pirate'],
      },
      'x',
    )!;
    expect(pack.quip).toHaveLength(2);
    expect(pack.quip![1]!.maturity).toBe('adult');
    expect(pack.bluff).toHaveLength(1);
    expect(pack.sketch).toHaveLength(1);
    expect(parsePack({ quip: [] }, 'x')).toBeNull();
  });

  it('parses CSV packs', () => {
    const pack = parseCsvPack(
      'game,text,answer,decoys\nquip,"A ""quoted"", prompt",,\nbluff,Our first trip was to ___,Rome,Paris;Oslo\nother,ignored,,\n',
      'trip',
    )!;
    expect(pack.quip![0]!.text).toBe('A "quoted", prompt');
    expect(pack.bluff![0]).toMatchObject({ answer: 'Rome', decoys: ['Paris', 'Oslo'] });
  });

  it('remembers used ids', () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const library = buildLibrary([]);
    rememberUsed(s, library, ['a', 'b']);
    rememberUsed(s, library, ['a']);
    expect([...library.recent]).toEqual(['b', 'a']);
  });
});
