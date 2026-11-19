# Content credits and source inventory

Game Night's prompts and questions come from the sources below. The packs are built by
`node scripts/import-content.mjs <sources dir>` into `src/content/packs/*.json`; every item
keeps a `source` (and the pack its `license`). Inspected 2026-11-19.

This is a hobby project played among friends. Some sources are share-alike or non-commercial:
keep the game non-commercial, keep this file with the code, and keep derived packs under the
same terms.

## Imported

| Source                                                                                                | Content                                                         | License                                          | Found                               | Imported             | Notes                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Game Night originals (`content/original/`)                                                            | Quip prompts, Sketch scenes, Sketch situations                  | This project                                     | 209 quip, 166 scenes, 40 situations | all                  | Written for Game Night                                                                                                                                                                             |
| [Rumpus](https://github.com/rodwilco/rumpus) (`games/quiplash.js`, `games/data/fibbage-questions.js`) | Quiplash prompts, Fibbage-style facts                           | AGPL-3.0 (data files say so)                     | 14 prompts, 36 facts                | 13 prompts, 28 facts | 8 facts dropped as wrong or unverifiable (e.g. "Venus is the only planet that spins clockwise": Uranus does too). House decoys for the kept facts are ours (`content/original/rumpus-decoys.json`) |
| [Quiplibre](https://github.com/hyperdriveguy/quiplibre) (`prompts.json`)                              | Quiplash prompts                                                | AGPL-3.0 per LICENSE.txt (package.json says MIT) | 75                                  | 75                   |                                                                                                                                                                                                    |
| [Digual Games](https://github.com/argosautomation/digual-games) (`server.js` fallback prompts)        | Quiplash prompts                                                | "MIT" in the README; no LICENSE file             | 94                                  | 93                   | Kids/teens/mixed/derby are family; "adults" are 18+                                                                                                                                                |
| [JSON Against Humanity](https://github.com/crhallberg/json-against-humanity)                          | Cards Against Humanity black cards (official packs, pick 1)     | CC BY-NC-SA 4.0                                  | 859                                 | 838                  | Cards Against Humanity LLC. Non-commercial, share-alike. All 18+                                                                                                                                   |
| [Open Trivia Database](https://opentdb.com) (API)                                                     | Multiple-choice trivia, with wrong answers used as house decoys | CC BY-SA 4.0                                     | ~4,500 multiple-choice questions    | 3,677                | Dropped questions that only work as multiple choice ("Which of these…", "not", "following") and long answers                                                                                       |
| [Quick, Draw! dataset](https://github.com/googlecreativelab/quickdraw-dataset) (`categories.txt`)     | Drawing subjects                                                | CC BY 4.0, © Google                              | 345                                 | 337                  | Combined with our situations: "A cactus at the dentist"                                                                                                                                            |
| [game-words](https://github.com/nick-aschenbach/game-words) (pictionary idioms)                       | Idioms to draw                                                  | MIT, © 2014 Nick Aschenbach                      | 210 idioms (1,252 pictionary words) | 210                  | Only the idioms                                                                                                                                                                                    |

Built-in totals: 1,228 Quip Battle prompts (343 family-friendly), 3,705 Bluff It questions,
713 Sketch It prompts.

## Not imported

| Source                                                                                                                                | Why                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Sucker Punchline](https://suckerpunchline.tv/prompts)                                                                                | No license; the site claims the prompts as its own. All rights reserved                                                                             |
| [Jackbox community episodes](https://support.jackboxgames.com/hc/en-us/articles/15794763590167-Using-custom-or-user-created-episodes) | Episodes live inside Jackbox games; no public pack with a reuse license found                                                                       |
| [fibbage-questions](https://github.com/joebandenburg/fibbage-questions)                                                               | Jackbox's game text, no license. `scripts/fibbage-to-pack.mjs` turns it into a private custom pack you load on your own TV; it isn't committed here |
| [OpenTriviaQA](https://github.com/uberspot/OpenTriviaQA)                                                                              | CC BY-SA, but the questions were "gathered" from unnamed sources                                                                                    |
| [We Suck at Drawing](https://github.com/codewithkyle/We-Suck-at-Drawing)                                                              | Most prompts are Cards Against Humanity cards (already imported from the source)                                                                    |
| fakeage, question-game-websocket, word-pictionary-list                                                                                | No license, copyleft and tiny, or a third-party list                                                                                                |

## Custom packs

The TV's lobby has **Content packs**: load a JSON pack (`{ "quip": [...], "bluff": [...],
"sketch": [...] }`, see `src/content/library.ts`) or a CSV (`game,text,answer,decoys,category,maturity`).
Custom packs are kept in that browser only.

## Code

QR codes: [`uqr`](https://github.com/unjs/uqr) (MIT). The QR drawing and room-code alphabet
come from MattSharp05/kart-racer.
