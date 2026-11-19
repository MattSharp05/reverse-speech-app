#!/usr/bin/env node
/**
 * Turns a fibbage-questions style file (github.com/joebandenburg/fibbage-questions:
 * { normal: [{ category, question, answer, alternateSpellings, suggestions }], final: [...] })
 * into a Game Night custom pack you load on the TV ("Content packs" in the lobby).
 *
 * That collection has no license (it's Jackbox's game text), so it isn't committed to this
 * repo: build the pack for your own games and keep it on your computer.
 *
 *   node scripts/fibbage-to-pack.mjs questions.json > my-bluff-pack.json
 */
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const bluff = [...(data.normal ?? []), ...(data.final ?? [])].map((q) => ({
  text: String(q.question).replace(/<BLANK>/g, '___'),
  answer: q.answer,
  alternates: q.alternateSpellings ?? [],
  decoys: (q.suggestions ?? []).slice(0, 6),
  category: q.category ?? 'fibbage',
}));
process.stdout.write(
  JSON.stringify({ id: 'fibbage-private', title: 'Private Fibbage pack', license: 'private use', bluff }) +
    '\n',
);
