#!/usr/bin/env node
/**
 * Builds the game content packs (src/content/packs/*.json) from:
 *   - the original prompts in content/original/ (written for Game Night), and
 *   - the openly licensed sources listed in CREDITS.md, read from a folder of checkouts:
 *
 *     node scripts/import-content.mjs <sources dir>
 *
 * <sources dir> holds: repos/rumpus, repos/digual, repos/hyperdriveguy__quiplibre,
 * repos/crhallberg__json-against-humanity, import/quickdraw/categories.txt,
 * import/game-words/game_words.yaml, import/opentdb/pages/*.json (Open Trivia DB API pages).
 * Sources are only read as text (string literals are pulled out, nothing is run). Missing
 * sources are skipped with a warning, so the original packs always build.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const src = process.argv[2];
const out = join(root, 'src/content/packs');
const original = join(root, 'content/original');

const id = (prefix, text) =>
  `${prefix}-${createHash('sha1').update(text.toLowerCase()).digest('hex').slice(0, 10)}`;
const read = (path) => (src && existsSync(join(src, path)) ? readFileSync(join(src, path), 'utf8') : null);
const warn = (what) => console.warn(`skipped ${what} (not found under ${src ?? '<no sources dir>'})`);

/** Every quoted string literal in `code` (single, double or backtick, no interpolation). */
function strings(code) {
  const found = [];
  const re = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"/g;
  for (const m of code.matchAll(re)) {
    const raw = m[1] ?? m[2];
    found.push(raw.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, ' '));
  }
  return found;
}

/** The source text of `const NAME = [ … ];` (or `NAME = [ … ]`). */
function arrayBlock(code, name) {
  const start = code.search(new RegExp(`${name}\\s*=\\s*\\[`));
  if (start < 0) return '';
  let depth = 0;
  for (let i = code.indexOf('[', start); i < code.length; i++) {
    if (code[i] === '[') depth++;
    else if (code[i] === ']' && --depth === 0) return code.slice(start, i + 1);
  }
  return '';
}

function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&eacute;/g, 'é')
    .replace(/&ouml;/g, 'ö')
    .replace(/&uuml;/g, 'ü')
    .replace(/&aacute;/g, 'á')
    .replace(/&oacute;/g, 'ó')
    .replace(/&iacute;/g, 'í')
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&hellip;/g, '…')
    .replace(/&shy;/g, '')
    .replace(/&[a-z]+;/g, '');
}

const tidy = (text) => text.replace(/\s+/g, ' ').replace(/_{1,}/g, '___').trim();

/** Drops duplicates (same words, case and punctuation aside) across all packs of a kind. */
function dedupe(packs, key) {
  const seen = new Set();
  let dropped = 0;
  for (const pack of packs) {
    pack[key] = pack[key].filter((item) => {
      const norm = item.text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      if (!norm || seen.has(norm)) {
        dropped++;
        return false;
      }
      seen.add(norm);
      return true;
    });
  }
  return dropped;
}

function lines(file) {
  return readFileSync(join(original, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

// ---- Quip Battle ------------------------------------------------------------

const quipPacks = [];

quipPacks.push({
  id: 'original',
  title: 'Game Night originals',
  source: 'Written for Game Night',
  license: 'Same as this project',
  quip: lines('quip.txt').map((line) => {
    const [category, maturity, text] = line.split('|').map((s) => s.trim());
    return { id: id('q', text), text: tidy(text), category, maturity, source: 'original' };
  }),
});

const rumpusQuip = read('repos/rumpus/games/quiplash.js');
if (rumpusQuip) {
  quipPacks.push({
    id: 'rumpus',
    title: 'Rumpus',
    source: 'https://github.com/rodwilco/rumpus',
    license: 'AGPL-3.0',
    quip: strings(arrayBlock(rumpusQuip, 'PROMPTS')).map((text) => ({
      id: id('q', text),
      text: tidy(text),
      category: 'general',
      maturity: 'family',
      source: 'rumpus',
      license: 'AGPL-3.0',
    })),
  });
} else warn('rumpus quiplash prompts');

const digual = read('repos/digual/server.js');
if (digual) {
  const block = (name) => {
    const start = digual.indexOf(`const ${name} = {`);
    if (start < 0) return {};
    const end = digual.indexOf('\n};', start);
    const body = digual.slice(start, end);
    const groups = {};
    for (const m of body.matchAll(/(\w+):\s*\[([\s\S]*?)\]/g)) groups[m[1]] = strings(m[2]);
    return groups;
  };
  const groups = { ...block('FALLBACK'), ...block('THEME_FALLBACK') };
  const quip = [];
  for (const [group, texts] of Object.entries(groups)) {
    for (const text of texts) {
      quip.push({
        id: id('q', text),
        text: tidy(text),
        category: group === 'derby' ? 'sports' : 'general',
        maturity: group === 'adults' ? 'adult' : 'family',
        source: 'digual',
        license: 'MIT (per README)',
      });
    }
  }
  quipPacks.push({
    id: 'digual',
    title: 'Digual Games',
    source: 'https://github.com/argosautomation/digual-games',
    license: 'MIT (per README)',
    quip,
  });
} else warn('digual prompts');

const quiplibre = read('repos/hyperdriveguy__quiplibre/prompts.json');
if (quiplibre) {
  quipPacks.push({
    id: 'quiplibre',
    title: 'Quiplibre',
    source: 'https://github.com/hyperdriveguy/quiplibre',
    license: 'AGPL-3.0 (LICENSE.txt; package.json says MIT)',
    quip: strings(quiplibre).map((text) => ({
      id: id('q', text),
      text: tidy(text),
      category: 'general',
      maturity: 'family',
      source: 'quiplibre',
      license: 'AGPL-3.0',
    })),
  });
} else warn('quiplibre prompts');

const cah = read('repos/crhallberg__json-against-humanity/cah-all-compact.json');
if (cah) {
  const data = JSON.parse(cah);
  const official = new Set(data.packs.filter((p) => p.official).flatMap((p) => p.black));
  const quip = [...official]
    .map((i) => data.black[i])
    .filter((card) => card.pick === 1 && card.text.length <= 140)
    .map((card) => {
      const text = tidy(decodeEntities(card.text.replace(/<br>/g, ' ')));
      return {
        id: id('q', text),
        text,
        category: 'cards against humanity',
        maturity: 'adult',
        source: 'cah',
      };
    });
  quipPacks.push({
    id: 'cah',
    title: 'Cards Against Humanity (official black cards, pick 1)',
    source: 'https://github.com/crhallberg/json-against-humanity',
    license: 'CC BY-NC-SA 4.0',
    attribution: 'Cards Against Humanity LLC, via JSON Against Humanity (Chris Hallberg)',
    quip,
  });
} else warn('Cards Against Humanity');

// ---- Bluff It ----------------------------------------------------------------

const bluffPacks = [];

const rumpusFib = read('repos/rumpus/games/data/fibbage-questions.js');
if (rumpusFib) {
  const decoys = JSON.parse(readFileSync(join(original, 'rumpus-decoys.json'), 'utf8'));
  const bluff = [];
  for (const m of rumpusFib.matchAll(
    /\{\s*q:\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"),\s*answer:\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g,
  )) {
    const [q, answer] = [strings(m[1])[0], strings(m[2])[0]];
    // Only the facts we kept (a few in the source are wrong or unverifiable; see CREDITS.md).
    if (!decoys[answer]) continue;
    bluff.push({
      id: id('b', q),
      text: tidy(q),
      answer,
      alternates: [],
      decoys: decoys[answer],
      category: 'weird facts',
      difficulty: 'medium',
      maturity: 'family',
      source: 'rumpus',
      license: 'AGPL-3.0',
    });
  }
  bluffPacks.push({
    id: 'rumpus',
    title: 'Rumpus (weird facts)',
    source: 'https://github.com/rodwilco/rumpus',
    license: 'AGPL-3.0',
    bluff,
  });
} else warn('rumpus Fibbage questions');

const pagesDir = src && join(src, 'import/opentdb/pages');
if (pagesDir && existsSync(pagesDir)) {
  const bluff = [];
  const categoryName = (c) =>
    c
      .replace(/^Entertainment: /, '')
      .replace(/^Science: /, '')
      .replace(/ & /g, ' and ')
      .toLowerCase();
  for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.json'))) {
    let page;
    try {
      page = JSON.parse(readFileSync(join(pagesDir, file), 'utf8'));
    } catch {
      continue;
    }
    for (const r of page.results ?? []) {
      if (r.type !== 'multiple') continue;
      const question = decodeEntities(r.question);
      const answer = decodeEntities(r.correct_answer).trim();
      // Bluff It shows the answer among lies: skip questions that only work as multiple choice.
      if (
        /\b(which|what) (of|one of) (these|the following)\b|following|\bnot\b|\bnone\b|\ball of\b|\bthese\b/i.test(
          question,
        )
      )
        continue;
      if (answer.length > 32 || answer.split(' ').length > 5) continue;
      bluff.push({
        id: id('b', question),
        text: tidy(question),
        answer,
        alternates: [],
        decoys: r.incorrect_answers.map(decodeEntities),
        category: categoryName(decodeEntities(r.category)),
        difficulty: r.difficulty,
        maturity: 'family',
        source: 'opentdb',
        reference: 'Open Trivia Database (opentdb.com)',
      });
    }
  }
  bluffPacks.push({
    id: 'opentdb',
    title: 'Open Trivia Database',
    source: 'https://opentdb.com',
    license: 'CC BY-SA 4.0',
    attribution: 'Open Trivia Database contributors (opentdb.com)',
    bluff,
  });
} else warn('Open Trivia DB pages');

// ---- Sketch It --------------------------------------------------------------

const sketchPacks = [];

sketchPacks.push({
  id: 'original',
  title: 'Game Night originals',
  source: 'Written for Game Night',
  license: 'Same as this project',
  sketch: lines('sketch.txt').map((line) => {
    const [maturity, text] = line.split('|').map((s) => s.trim());
    return { id: id('s', text), text, category: 'scenes', maturity, source: 'original' };
  }),
});

const quickdraw = read('import/quickdraw/categories.txt');
if (quickdraw) {
  const nouns = quickdraw
    .split('\n')
    .map((l) => l.trim())
    .filter((n) => n && !/^(the |line|circle|square|triangle|hexagon|octagon|zigzag|squiggle)/.test(n));
  const situations = lines('situations.txt');
  // Deterministic pairing: each subject once, each situation spread evenly.
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const sketch = nouns.map((noun, i) => {
    const situation = situations[(i + Math.floor(rand() * situations.length)) % situations.length];
    const plural = /[^s]s$/.test(noun) && !/(bus|cactus|octopus|lips)$/.test(noun);
    const article = plural ? 'Some' : /^[aeiou]/.test(noun) ? 'An' : 'A';
    const text = `${article} ${noun} ${situation}`;
    return {
      id: id('s', text),
      text,
      category: 'mash-ups',
      maturity: 'family',
      source: 'quickdraw',
      license: 'CC BY 4.0',
    };
  });
  sketchPacks.push({
    id: 'quickdraw',
    title: 'Quick, Draw! subjects × Game Night situations',
    source: 'https://github.com/googlecreativelab/quickdraw-dataset',
    license: 'CC BY 4.0 (subjects)',
    attribution: 'Subjects: the Quick, Draw! dataset by Google, CC BY 4.0',
    sketch,
  });
} else warn('Quick, Draw! categories');

const gameWords = read('import/game-words/game_words.yaml');
if (gameWords) {
  // Only the idioms list: whole phrases that are fun to draw literally.
  const start = gameWords.search(/^\s+idioms:/m);
  const rest = start >= 0 ? gameWords.slice(start).split('\n').slice(1) : [];
  const idioms = [];
  for (const line of rest) {
    const m = line.match(/^\s+-\s+(.+)$/);
    if (!m) break;
    idioms.push(m[1].replace(/^['"]|['"]$/g, '').trim());
  }
  sketchPacks.push({
    id: 'game-words',
    title: 'Pictionary idioms (game-words)',
    source: 'https://github.com/nick-aschenbach/game-words',
    license: 'MIT',
    attribution: 'Copyright (c) 2014 Nick Aschenbach',
    sketch: idioms.map((text) => ({
      id: id('s', text),
      text: text[0].toUpperCase() + text.slice(1),
      category: 'idioms',
      maturity: 'family',
      source: 'game-words',
      license: 'MIT',
    })),
  });
} else warn('game-words');

// ---- Odd One Out and Hot Takes (originals) --------------------------------------

const party = {
  id: 'original-party',
  title: 'Game Night originals (Odd One Out, Hot Takes)',
  source: 'Written for Game Night',
  license: 'Same as this project',
  oddone: lines('oddone.txt').map((line) => {
    const [category, maturity, word, decoy] = line.split('|').map((s) => s.trim());
    return { id: id('o', `${word}/${decoy}`), category, maturity, word, decoy, source: 'original' };
  }),
  hottakes: lines('hottakes.txt').map((line) => {
    const [kind, maturity, text, low, high] = line.split('|').map((s) => s.trim());
    return {
      id: id('h', text),
      kind,
      text,
      ...(kind === 'scale' ? { low, high } : {}),
      category: kind === 'who' ? 'who' : 'opinions',
      maturity,
      source: 'original',
    };
  }),
};

// ---- Write ------------------------------------------------------------------

const drops = {
  quip: dedupe(quipPacks, 'quip'),
  bluff: dedupe(bluffPacks, 'bluff'),
  sketch: dedupe(sketchPacks, 'sketch'),
};
const write = (name, packs) =>
  writeFileSync(join(out, `${name}.json`), JSON.stringify(packs, null, 0) + '\n');
write('quip', quipPacks);
write('bluff', bluffPacks);
write('sketch', sketchPacks);
write('party', [party]);
const summary = (packs, key) => packs.map((p) => `${p.id} ${p[key].length}`).join(', ');
console.log(`quip: ${summary(quipPacks, 'quip')} (${drops.quip} duplicates dropped)`);
console.log(`bluff: ${summary(bluffPacks, 'bluff')} (${drops.bluff} duplicates dropped)`);
console.log(`sketch: ${summary(sketchPacks, 'sketch')} (${drops.sketch} duplicates dropped)`);
console.log(`odd one out: ${party.oddone.length} pairs; hot takes: ${party.hottakes.length} questions`);
