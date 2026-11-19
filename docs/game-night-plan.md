# Game Night — architecture & implementation plan

Status: **reviewed 2026-11-19; milestones 1–8 built** (see "What was built" at the end). Decisions:

1. Where the game runs: the TV/laptop browser tab is the "brain" (no server to host).
2. Reverse supports any number of players: everyone records words, and each round every player gets a random word that belongs to someone else. Players aren't paired off head-to-head. Classic 2-player Esrever stays (one phone or two phones).
3. Content: import from the researched sources. This is a hobby game for friends: copyleft and non-commercial licenses are fine with attribution in `CREDITS.md`. Copyrighted sets with no license at all (the Jackbox Fibbage dump, Sucker Punchline) stay out of the public repo; instead the TV can load a private JSON/CSV pack from disk.
4. QR codes: `uqr` (MIT), as in kart-racer.

## 0. Reused from kart-racer (MattSharp05/kart-racer)

| Reused                  | From                                                                                        | How                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| QR codes                | `src/remote/qr.ts` + `uqr` 0.1.3 (ADR 0013)                                                 | Copied: SVG path from `encode()`, ECC M, lazy-loaded                                 |
| Room codes              | `src/net/room.ts` `ROOM_CODE_ALPHABET` (no look-alikes)                                     | 4 chars from `A–Z 2–9` minus `I O 0 1`                                               |
| Presence                | `src/net/roomBackendSupabase.ts` (Realtime presence keyed by member id, re-track on rejoin) | Who is connected comes from presence; heartbeat stays as a fallback for `?net=local` |
| Phone ↔ desktop pattern | `src/remote/hub.ts` (slots, drop after silence, rescan takes the slot back)                 | Same rules: a phone that comes back with its identity takes its seat back            |
| Haptics                 | `src/remote/haptics.ts`                                                                     | `navigator.vibrate` on "your turn" and "time almost up"                              |
| Synthesized audio       | ADR 0004 / `src/audio/synth.ts`                                                             | Effects made with WebAudio oscillators, so there are no audio files                  |

Not reused: WebRTC data channels and the TURN function. Party games send a few messages per second, which Supabase Broadcast handles well within quota; WebRTC would add NAT/TURN failure modes and a Vercel function with Cloudflare keys.

## 1. What exists today (Esrever / "Reverse")

| Area       | Today                                                                                                                                                                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend   | TypeScript (strict) + Vite, plain DOM via a tiny `h()` helper (`src/ui/dom.ts`), one CSS file, Fredoka font. No framework.                                                                                                                                                                                              |
| Backend    | **None.** Static site on Vercel (`vercel.json`: Vite, pnpm, `dist/`).                                                                                                                                                                                                                                                   |
| Realtime   | Supabase Realtime **Broadcast** only (no tables, nothing stored), lazy-loaded (`src/net/supabase.ts`). `?net=local` swaps in `BroadcastChannel` for tests/dev (`src/net/channel.ts`). Sends are queued and paced (70 ms) under Realtime rate limits; newer `state` replaces queued older ones.                          |
| Rooms      | 4-letter code → channel `esrever:CODE`. Exists only while someone is in it. Exactly 2 seats.                                                                                                                                                                                                                            |
| Authority  | **Host-authoritative**: the room creator (seat 0) runs the pure `reduce()` for every action and broadcasts the whole `GameState` every change + every 2 s heartbeat. The guest sends `act` messages with ids, resent every 1.5 s until the host's state lists them in `acked` (idempotent: host remembers last 40 ids). |
| Identity   | Random `clientId` in `sessionStorage`; name in `localStorage`. Host maps `clientId → seat`. Reload: host restores its game from `sessionStorage`; guest re-sends `hello` and is re-seated by `clientId`.                                                                                                                |
| Game rules | `src/game/state.ts`: phases `lobby → lockin → play → done`, 5 rounds, `reduce` returns the same object when an action doesn't apply (wrong phase/player/stale double-tap). `match.ts` fuzzy-matches guesses. Scoring is derived (`scores()` counts correct/counted guesses). **No timers.**                             |
| Media      | Mic recording → 16 kHz mono PCM clips, base64, chunked into 60 KB `clip` messages, re-requested via `need`.                                                                                                                                                                                                             |
| UI         | `App` holds a `View` + `Session`; re-renders only when a computed screen key changes (so typing isn't lost). All screens in `screens.ts`. Light theme.                                                                                                                                                                  |
| Tests      | Vitest (rules, matching, PCM, Room sync with a fake channel) + Playwright (full one-phone game; full online game in two tabs over `?net=local`). CI runs lint/typecheck/unit/e2e.                                                                                                                                       |

## 2. What is reused vs. what changes

**Reused as-is (or nearly):**

- Stack, build, Vercel deploy, Supabase env vars, `?net=local` test transport, CI.
- `Channel` abstraction + Supabase pacing/coalescing.
- The host-authoritative pattern: pure reducers, "same object = no-op", action ids + resend-until-acked, heartbeat, presence timeout, state persisted on the host for reloads.
- Clip chunking/assembly (generalised to any binary "blob", e.g. drawings).
- `h()`/`toast()`, the screen-key re-render approach, audio engine + record/play widgets.
- Reverse's `reduce`, `match`, PCM pipeline and screens — **rules untouched**.

**Must change:**

1. **Room ≠ game.** Today the room _is_ a 2-seat Reverse game. It becomes a `RoomState` (players, host settings, selected game, session wins) that _contains_ the current game's state.
2. **N players + a non-playing host display.** Seats become `playerId`s. The TV creates the room and is the authority but is not a player.
3. **Private information.** Broadcast means every client hears every message, so "send the whole state" leaks secrets. Public state must contain nothing secret; per-player secrets travel encrypted (below).
4. **Timers** (new): host-owned deadlines.
5. **Two UIs per game**: a TV "display" renderer and a phone "controller" renderer.
6. **Visual design**: dark Game Night theme with per-game accents.

## 3. Why no new server

"Server-authoritative" is achieved by making the **TV/laptop browser the authority**. It's the one trusted device in a Jackbox setup, it's always on, and it already plays the room-creator role in today's code. Phones are untrusted thin controllers: they send _intents_; the host validates every one against the current phase and computes all outcomes and scores.

A Node/Socket.IO server would add hosting outside Vercel (Vercel functions can't hold WebSockets), a new deploy, and cost — for no gain in a game where the authority is the party's own TV. Trade-off accepted: if the TV tab closes, the room pauses; on reopen it restores from `localStorage` and phones reconnect automatically.

## 4. Proposed architecture

```
src/
  platform/            pure, no DOM/net (lint-enforced like src/game/)
    room.ts            RoomState, RoomAction, reduceRoom (join/rename/kick/select/settings/start/pause/skip/end/lobby)
    module.ts          GameModule interface + registry
    timer.ts           Deadline helpers (start, pause/resume, remaining, expired)
    vote.ts            Voting helpers (eligibility, tally, unanimous/percent)
    scores.ts          Score ledger, rankings with ties, round deltas
    rng.ts             Seeded RNG (deterministic tests, shuffles)
    text.ts            Answer normalisation (case/punct/articles/whitespace), duplicate detection
  games/
    reverse/           adapter over src/game/* (rules unchanged) + display.ts + controller.ts
    quip/              rules.ts (+test), display.ts, controller.ts
    bluff/             rules.ts (+test), display.ts, controller.ts
    sketch/            rules.ts (+test), display.ts, controller.ts, canvas.ts
  content/
    schema.ts          GamePrompt / TriviaQuestion / DrawingPrompt types + validation
    packs/*.json       Imported + original packs with source/license metadata
    loader.ts          Filter (category, maturity), dedupe, recent-history avoidance
  net/
    channel.ts, supabase.ts   (kept)
    protocol.ts        v2 messages (below) + generic blob chunking
    crypto.ts          ECDH P-256 + AES-GCM via WebCrypto
    host.ts            HostRoom: runs reduceRoom + module.reduce, ticks timers, builds views, persists
    player.ts          PlayerClient: identity, encrypted acts, resend-until-acked, reconnect
  ui/
    display/           TV: home (game cards), lobby (code + QR + players), game frame, scoreboard, results
    controller/        Phone: join, lobby, per-game controller, waiting, connection status
    shared/            avatars/colours, timer ring, sounds (WebAudio synth + mute), dom.ts
```

### GameModule contract

```ts
interface GameModule<S, A, Settings> {
  id: 'reverse' | 'quip' | 'bluff' | 'sketch';
  meta: { title; tagline; players: [min, max]; minutes; accent };
  defaultSettings: Settings;
  init(players: PlayerId[], settings: Settings, ctx: { rng; content; now }): S;
  reduce(state: S, from: PlayerId, action: A, ctx): S; // same object = rejected
  onTimer(state: S, ctx): S; // deadline expired → lock, fill gaps, advance
  publicView(state: S): unknown; // safe for everyone (TV + phones)
  privateView(state: S, player: PlayerId): unknown; // only that player's secrets
  results(state: S): { scores: Record<PlayerId, number>; winners: PlayerId[] } | null;
}
```

The platform owns: who may act (joined, not kicked, in this game), phase deadlines, pause/skip, scores → leaderboard → session wins, and returning to game selection. Games own only their rules. Each game's rules get Vitest coverage (phase gating, eligibility, duplicates, scoring, timer expiry).

### Network protocol v2 (channel `gn:CODE`)

- `hello { playerId, pubKey, name }` — phone announces/reconnects.
- `state { rev, hostNow, public, private: { [playerId]: ciphertext }, acked }` — one message per change (+ heartbeat). `hostNow` lets phones correct clock skew for timers.
- `act { playerId, id, ciphertext }` — encrypted + authenticated with the player's shared key, so nobody can act as someone else or read their answers.
- `blob` parts (Reverse clips, as today).

**Privacy:** each phone generates an ECDH key pair (kept in `localStorage` per room → refresh keeps identity). The host derives a per-player AES-GCM key. Prompts assigned to you, your drafts/submissions, and anything only you should see go in your encrypted slot. Correct trivia answers and Sketch prompts never leave the host until their reveal phase. The TV renders only `publicView`.

**Reconnect:** same `playerId` + key → host re-sends current views; submitted answers live on the host, so nothing is lost. Phone drafts are also kept in `sessionStorage`. Players unseen for >7 s show as "away"; timers keep running, so nobody blocks the game.

### Host display vs. controllers

- One URL. `/` on a big screen offers **Host Game Night**; on phones it offers **Join** (code + nickname). QR encodes `/?join=CODE`.
- TV flow: create room → lobby (code, QR, players with colour avatars) → game cards → settings sheet (defaults pre-filled) → game → results → back to cards. Host controls: pause/resume, skip phase, restart, end game, kick player, mute.
- Phone flow: join → lobby → automatically switches to the active game's controller for the current phase → back to lobby on game end. Always shows a status line ("Waiting for others… 3/5 in") and a connection dot.
- 16:9 TV layout with clamp()-scaled type (prompts ≥ 4vw); portrait phone layout with big targets.

### Reverse in Game Night

**Party Reverse (any number of players, 2+):** everyone records K secret words at once (default 3). Each round, every player is dealt a random word that belongs to someone else, and every word is used once. On their own phone, a player hears it reversed, records a copy, hears the copy reversed, and types a guess, all against the round timer. Reveal on the TV: for each player, it plays the reversed copy, shows the guess and the real word, and the word's owner can tap "Count it" for a near miss. +1 point per correct guess. Guessing reuses `match.ts`, and the audio reuses `pcm.ts`/`engine.ts`/widgets, with clips sent as chunked blobs as today.

**Classic Esrever stays unchanged:** one-phone pass-and-play and the 2-phone online mode keep their current code and tests.

## 5. Game rules summary

- **Quip Battle** — 3 rounds. N players → N prompts per round, each given to 2 players, each player gets 2 (a cyclic pairing; with 3 players it still works). Voting: everyone except the two authors; if there are no eligible voters (e.g. 2 players), the TV audience isn't counted and the matchup scores as a tie (no points awarded); we'll require 3+ players. Points = round multiplier × 1000 × vote share; +250 "QUIPLASH"-style unanimous bonus (named differently); unanswered = auto "no answer" and loses. Final round: one shared prompt, everyone answers, everyone gets 3 votes, not on their own.
- **Bluff It** — N questions. Submit lie → host normalises (case, punctuation, leading articles, whitespace) and **rejects answers matching the truth or its accepted variants** ("That's the real answer! Try another lie") and merges equivalent lies (both authors credited). Missing lies are just omitted (optionally filled with a house lie from the question's decoy list). Choose: cannot pick own lie. +1000 for truth, +500 per player fooled (doubling in the last round).
- **Sketch It** — each player gets a unique prompt, draws (60–90 s) on a canvas with pen, 3 sizes, undo, clear. Strokes are simplified and quantised on the phone, sent once on submit (cap ~40 KB), rendered on the TV only. Then for each drawing: captions from non-artists → vote among truth + lies (no own caption; artist doesn't vote) → reveal. Points: guesser +1000 for truth, liar +500 per fooled, artist +500 per correct guesser. Drawings are discarded when the game ends.

All phases have default timers (instructions, answer, draw, vote, reveal) that the host can edit before starting; expiry locks submissions, fills gaps, and advances.

## 6. Implementation milestones

1. **Platform core**: `src/platform/*`, protocol v2, crypto, HostRoom/PlayerClient, unit tests (fake channel, multiple players, reconnect, kicks, privacy: public state contains no secrets).
2. **Shells**: TV home/lobby/QR/game cards/settings/results + phone join/lobby/waiting, dark theme, sounds/mute. A trivial dummy module proves the loop end to end (e2e: host + 3 phones via `?net=local`).
3. **Reverse port** onto the platform; keep one-phone mode; existing tests green.
4. **Content system** (schema, validator, dedupe, packs, recent-history) + imports permitted by the research below + original packs.
5. **Quip Battle** (rules + tests, TV, controller, e2e).
6. **Bluff It** (rules + tests, verified trivia pack, e2e).
7. **Sketch It** (canvas, rules + tests, e2e).
8. **Polish + full-session e2e**: switch games without reconnecting, refresh mid-game, timer expiry, duplicate submissions, kicked player; manual pass on iOS Safari/Chrome + a TV-sized viewport.

Each milestone ends with `pnpm check` green and a commit on the working branch.

## 7. Content research findings

Inspected 2026-11-19 by cloning each repo and reading the files and pages listed. Counts come from parsing those files. Jackbox's Terms of Service were **not** inspected.

| Source                                                                                                                             | Content                                                                                           | License (covers data?)                                                  | Found                               | Import      | Why                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [rodwilco/rumpus](https://github.com/rodwilco/rumpus)                                                                              | Quiplash prompts, Fibbage `{q, answer}`, multiple-choice trivia                                   | AGPL-3.0; each data file's header says so, so it covers the data        | 14 quip, 36 fibbage, 50 trivia      | 0           | Network copyleft would force the whole app under AGPL. Sets are tiny and some answers are wrong. Format reference only.                |
| [argosautomation/digual-games](https://github.com/argosautomation/digual-games)                                                    | Quiplash clone (Node + Socket.IO, TV + phones); prompts generated by an LLM, plus fallback arrays | README says "MIT", but there is no LICENSE file and no copyright holder | 94 fallback                         | 0           | Grant is too weak to rely on; prompts are generic. Its TV+phones architecture matches our plan.                                        |
| [suckerpunchline.tv/prompts](https://suckerpunchline.tv/prompts)                                                                   | 54 of 274 prompts visible                                                                         | None; site claims the prompts as its own original work                  | 54                                  | 0           | All rights reserved.                                                                                                                   |
| [Jackbox custom episodes](https://support.jackboxgames.com/hc/en-us/articles/15794763590167-Using-custom-or-user-created-episodes) | In-game "Make Your Own" episodes (≤64 prompts, shared by code)                                    | Not addressed; publishing needs Jackbox ToS acceptance                  | 0 public packs with a reuse license | 0           | No documented reuse path outside Jackbox.                                                                                              |
| [Quick, Draw! categories](https://github.com/googlecreativelab/quickdraw-dataset)                                                  | Drawing nouns                                                                                     | **CC BY 4.0** (data)                                                    | 345                                 | ✓           | Attribution to Google / Quick, Draw!. Used as _ingredients_ (subjects) for combinatorial Sketch It prompts, not as standalone prompts. |
| [nick-aschenbach/game-words](https://github.com/nick-aschenbach/game-words)                                                        | Pictionary/charades word lists                                                                    | MIT with named holder; word origin unstated                             | 1,252 pictionary                    | optional    | Keep MIT notice. Lower priority; plain words are not absurd enough on their own.                                                       |
| [Open Trivia DB](https://opentdb.com/api_config.php)                                                                               | Multiple-choice trivia                                                                            | **CC BY-SA 4.0**                                                        | 5,299 verified                      | not planned | No blanks; rewrites would stay BY-SA, and the questions aren't "surprising" style. Possible later "classic trivia" pack.               |
| uberspot/OpenTriviaQA                                                                                                              | MC trivia                                                                                         | CC BY-SA 4.0, but questions were "gathered" from unnamed sources        | 49,716                              | 0           | Provenance doubtful.                                                                                                                   |
| crhallberg/json-against-humanity                                                                                                   | CAH cards                                                                                         | CC BY-NC-SA 4.0                                                         | 22k / 6k                            | 0           | NonCommercial + ShareAlike; also many fan packs.                                                                                       |
| joebandenburg/fibbage-questions                                                                                                    | Fibbage questions                                                                                 | None (Jackbox text)                                                     | 331                                 | 0           | Copyrighted game content.                                                                                                              |
| hyperdriveguy/quiplibre                                                                                                            | Quiplash prompts                                                                                  | Conflicting AGPL/MIT                                                    | 75                                  | 0           | Ambiguous + copyleft.                                                                                                                  |
| codewithkyle/We-Suck-at-Drawing                                                                                                    | Drawful-clone prompts                                                                             | MIT (code only)                                                         | 117 SFW / 227 NSFW                  | 0           | 53–60% match CAH cards exactly, so the content is CAH-derived.                                                                         |
| Beherith/fakeage, francois-roseberry/question-game-websocket, engichang1467/word-pictionary-list                                   | Small Fibbage/pictionary sets                                                                     | None / GPL / third-party origin                                         | 18 / 33 / 424                       | 0           | Unlicensed, copyleft or too small.                                                                                                     |

**Conclusion:** no openly licensed comedy-prompt or Fibbage-style (blank + real answer) dataset exists among the sources checked. So:

- **Quip Battle:** original prompts, written in themed packs (general, friends & relationships, tech/engineers, pop culture, adult, dark). Target ~500 at launch, tagged `family`/`teen`/`adult`. The format supports custom JSON/CSV packs for friend-group prompts.
- **Bluff It:** original questions written from facts I can source. Each has a source URL (Wikipedia or a primary source), accepted variants, a few house decoys, category and difficulty. Each fact is fetched and checked against its source before it's included; anything unconfirmed is dropped. Target 150 at launch.
- **Sketch It:** ~250 hand-written absurd scenes, plus combinations of a subject (Quick, Draw! nouns, CC BY 4.0) with situation templates. Generated combinations are filtered for duplicates.
- A `CREDITS.md` and in-app credits screen list every imported source and its license.

## What was built

- Platform: `src/platform/` (room rules, module contract, scores, answer matching), `src/net/host.ts`
  - `player.ts` + `crypto.ts` (TV authority, sealed per-player messages, reconnects, TV reload).
- Games: `src/games/{reverse,quip,bluff,sketch}/rules.ts` with unit tests; UI in `src/ui/gn/games/`.
- Content: `scripts/import-content.mjs`, `content/original/`, `src/content/packs/`, CREDITS.md.
- Tests: 84 unit tests; Playwright covers classic Esrever and Game Night (TV + 3 phones, all
  four games, reconnect, pause, kick, TV reload).

Not done / known limits:

- Checked in Chromium only (desktop and Pixel emulation), not on a real iPhone/Safari or a TV.
- Real Supabase wasn't exercised (no credentials here); the same messages run over
  BroadcastChannel in tests.
- No original Bluff It questions yet: trivia comes from Open Trivia DB and Rumpus.
- Game Night standings count wins per player for the session (shown in the lobby and results);
  there's no per-game breakdown.
