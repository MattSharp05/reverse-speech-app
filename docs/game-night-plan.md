# Game Night — architecture & implementation plan

Status: **proposal, awaiting review**. Nothing below is implemented yet.

## 1. What exists today (Esrever / "Reverse")

| Area | Today |
| --- | --- |
| Frontend | TypeScript (strict) + Vite, plain DOM via a tiny `h()` helper (`src/ui/dom.ts`), one CSS file, Fredoka font. No framework. |
| Backend | **None.** Static site on Vercel (`vercel.json`: Vite, pnpm, `dist/`). |
| Realtime | Supabase Realtime **Broadcast** only (no tables, nothing stored), lazy-loaded (`src/net/supabase.ts`). `?net=local` swaps in `BroadcastChannel` for tests/dev (`src/net/channel.ts`). Sends are queued and paced (70 ms) under Realtime rate limits; newer `state` replaces queued older ones. |
| Rooms | 4-letter code → channel `esrever:CODE`. Exists only while someone is in it. Exactly 2 seats. |
| Authority | **Host-authoritative**: the room creator (seat 0) runs the pure `reduce()` for every action and broadcasts the whole `GameState` every change + every 2 s heartbeat. The guest sends `act` messages with ids, resent every 1.5 s until the host's state lists them in `acked` (idempotent: host remembers last 40 ids). |
| Identity | Random `clientId` in `sessionStorage`; name in `localStorage`. Host maps `clientId → seat`. Reload: host restores its game from `sessionStorage`; guest re-sends `hello` and is re-seated by `clientId`. |
| Game rules | `src/game/state.ts`: phases `lobby → lockin → play → done`, 5 rounds, `reduce` returns the same object when an action doesn't apply (wrong phase/player/stale double-tap). `match.ts` fuzzy-matches guesses. Scoring is derived (`scores()` counts correct/counted guesses). **No timers.** |
| Media | Mic recording → 16 kHz mono PCM clips, base64, chunked into 60 KB `clip` messages, re-requested via `need`. |
| UI | `App` holds a `View` + `Session`; re-renders only when a computed screen key changes (so typing isn't lost). All screens in `screens.ts`. Light theme. |
| Tests | Vitest (rules, matching, PCM, Room sync with a fake channel) + Playwright (full one-phone game; full online game in two tabs over `?net=local`). CI runs lint/typecheck/unit/e2e. |

## 2. What is reused vs. what changes

**Reused as-is (or nearly):**
- Stack, build, Vercel deploy, Supabase env vars, `?net=local` test transport, CI.
- `Channel` abstraction + Supabase pacing/coalescing.
- The host-authoritative pattern: pure reducers, "same object = no-op", action ids + resend-until-acked, heartbeat, presence timeout, state persisted on the host for reloads.
- Clip chunking/assembly (generalised to any binary "blob", e.g. drawings).
- `h()`/`toast()`, the screen-key re-render approach, audio engine + record/play widgets.
- Reverse's `reduce`, `match`, PCM pipeline and screens — **rules untouched**.

**Must change:**
1. **Room ≠ game.** Today the room *is* a 2-seat Reverse game. It becomes a `RoomState` (players, host settings, selected game, session wins) that *contains* the current game's state.
2. **N players + a non-playing host display.** Seats become `playerId`s. The TV creates the room and is the authority but is not a player.
3. **Private information.** Broadcast means every client hears every message, so "send the whole state" leaks secrets. Public state must contain nothing secret; per-player secrets travel encrypted (below).
4. **Timers** (new): host-owned deadlines.
5. **Two UIs per game**: a TV "display" renderer and a phone "controller" renderer.
6. **Visual design**: dark Game Night theme with per-game accents.

## 3. Why no new server

"Server-authoritative" is achieved by making the **TV/laptop browser the authority**. It's the one trusted device in a Jackbox setup, it's always on, and it already plays the room-creator role in today's code. Phones are untrusted thin controllers: they send *intents*; the host validates every one against the current phase and computes all outcomes and scores.

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
  reduce(state: S, from: PlayerId, action: A, ctx): S;   // same object = rejected
  onTimer(state: S, ctx): S;                              // deadline expired → lock, fill gaps, advance
  publicView(state: S): unknown;                          // safe for everyone (TV + phones)
  privateView(state: S, player: PlayerId): unknown;       // only that player's secrets
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

Reverse is a 2-player voice game, so the host picks two players from the room (default: first two to opt in); everyone else watches the TV, which shows turns, plays the reversed clip and copies aloud for the room, and shows scores. The two players' phones run today's lock-in/record/guess screens unchanged. The existing **one-phone pass-and-play mode stays** on the phone home screen. Rules, matching, and clip transport are unchanged; existing unit and e2e tests keep passing (the online e2e gets updated to the new join flow).

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

See section in the chat summary / to be filled in from the source inventory.
