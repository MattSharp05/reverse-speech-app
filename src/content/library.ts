import { cleanText } from '../platform/text';
import type { BluffQuestion, ContentLibrary, Maturity, Pack, QuipPrompt, SketchPrompt } from './schema';

/** How many used content ids the TV remembers, so the next games deal fresh ones. */
const RECENT_KEPT = 3000;
const RECENT_KEY = 'gn:recent';
const CUSTOM_KEY = 'gn:custom-packs';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storageGet(store: Store | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(store: Store | undefined, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Full or blocked: nothing remembered.
  }
}

/** Every built-in pack (loaded on the TV only, as its own chunk) plus the host's custom packs. */
export async function loadLibrary(store?: Store): Promise<ContentLibrary> {
  const [quip, bluff, sketch, party] = await Promise.all([
    import('./packs/quip.json').then((m) => m.default as unknown as Pack[]),
    import('./packs/bluff.json').then((m) => m.default as unknown as Pack[]),
    import('./packs/sketch.json').then((m) => m.default as unknown as Pack[]),
    import('./packs/party.json').then((m) => m.default as unknown as Pack[]),
  ]);
  return buildLibrary([...quip, ...bluff, ...sketch, ...party, ...customPacks(store)], recentIds(store));
}

export function buildLibrary(packs: Pack[], recent: Set<string> = new Set()): ContentLibrary {
  return {
    quip: packs.flatMap((p) => p.quip ?? []),
    bluff: packs.flatMap((p) => p.bluff ?? []),
    sketch: packs.flatMap((p) => p.sketch ?? []),
    oddone: packs.flatMap((p) => p.oddone ?? []),
    hottakes: packs.flatMap((p) => p.hottakes ?? []),
    recent,
  };
}

export function recentIds(store?: Store): Set<string> {
  try {
    return new Set(JSON.parse(storageGet(store, RECENT_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function rememberUsed(store: Store | undefined, library: ContentLibrary, used: string[]): void {
  const all = [...[...library.recent].filter((id) => !used.includes(id)), ...used].slice(-RECENT_KEPT);
  library.recent = new Set(all);
  storageSet(store, RECENT_KEY, JSON.stringify(all));
}

export function customPacks(store?: Store): Pack[] {
  try {
    const packs = JSON.parse(storageGet(store, CUSTOM_KEY) ?? '[]') as unknown[];
    return packs.map((p) => parsePack(p, 'custom')).filter((p): p is Pack => p !== null);
  } catch {
    return [];
  }
}

export function saveCustomPacks(store: Store | undefined, packs: Pack[]): void {
  storageSet(store, CUSTOM_KEY, JSON.stringify(packs));
}

const hash = (text: string): string => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

const maturity = (v: unknown): Maturity => (v === 'adult' ? 'adult' : 'family');
const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => cleanText(x, 60)).filter(Boolean)
    : typeof v === 'string'
      ? v
          .split(/[;|]/)
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/**
 * A pack from the host's file. Accepts Game Night's own format (`quip` / `bluff` / `sketch`
 * arrays of objects) or plain strings for prompts. Invalid entries are dropped; null when
 * nothing usable is left.
 */
export function parsePack(raw: unknown, fallbackId: string): Pack | null {
  const p = obj(raw);
  const packId = cleanText(p.id, 40) || fallbackId;
  const source = `custom:${packId}`;
  const prompt = (prefix: string, x: unknown): QuipPrompt | null => {
    const o = typeof x === 'string' ? { text: x } : obj(x);
    const text = cleanText(o.text, 160);
    if (!text) return null;
    return {
      id: `${prefix}-${packId}-${hash(text)}`,
      text,
      category: cleanText(o.category, 40) || packId,
      maturity: maturity(o.maturity),
      source,
    };
  };
  const quip = (Array.isArray(p.quip) ? p.quip : [])
    .map((x) => prompt('q', x))
    .filter((x): x is QuipPrompt => x !== null);
  const sketch = (Array.isArray(p.sketch) ? p.sketch : [])
    .map((x) => prompt('s', x))
    .filter((x): x is SketchPrompt => x !== null);
  const bluff = (Array.isArray(p.bluff) ? p.bluff : [])
    .map((x): BluffQuestion | null => {
      const o = obj(x);
      const text = cleanText(o.text ?? o.question, 200);
      const answer = cleanText(o.answer, 60);
      if (!text || !answer) return null;
      const difficulty = o.difficulty === 'easy' || o.difficulty === 'hard' ? o.difficulty : 'medium';
      return {
        id: `b-${packId}-${hash(text)}`,
        text,
        answer,
        alternates: list(o.alternates),
        decoys: list(o.decoys),
        category: cleanText(o.category, 40) || packId,
        difficulty,
        maturity: maturity(o.maturity),
        source,
        ...(o.explanation ? { explanation: cleanText(o.explanation, 300) } : {}),
        ...(o.reference ? { reference: cleanText(o.reference, 300) } : {}),
      };
    })
    .filter((x): x is BluffQuestion => x !== null);
  if (!quip.length && !bluff.length && !sketch.length) return null;
  return {
    id: packId,
    title: cleanText(p.title, 60) || packId,
    source: cleanText(p.source, 200) || 'custom',
    license: cleanText(p.license, 60) || 'private',
    ...(quip.length ? { quip } : {}),
    ...(bluff.length ? { bluff } : {}),
    ...(sketch.length ? { sketch } : {}),
  };
}

/** Splits one CSV line (quotes and doubled quotes allowed). */
function csvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      cells.push(cell);
      cell = '';
    } else cell += c;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/**
 * A CSV pack: a header row naming columns, one of them `game` (quip, bluff or sketch) and
 * `text`; bluff rows also need `answer`, and may have `decoys` / `alternates` (split by `;`),
 * `category`, `difficulty`, `maturity`, `reference`.
 */
export function parseCsvPack(text: string, packId: string): Pack | null {
  const rows = text.split(/\r?\n/).filter((l) => l.trim());
  const header = rows.shift();
  if (!header) return null;
  const cols = csvRow(header).map((c) => c.toLowerCase());
  const raw: Record<string, unknown[]> = { quip: [], bluff: [], sketch: [] };
  for (const line of rows) {
    const cells = csvRow(line);
    const row = Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
    const game = String(row.game ?? '').toLowerCase();
    if (game in raw) raw[game]!.push(row);
  }
  return parsePack({ id: packId, title: packId, ...raw }, packId);
}
