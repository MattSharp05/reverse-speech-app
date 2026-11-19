# Game Night (reverse-speech-app)

Jackbox-style party games: one TV/laptop hosts, phones are controllers. Four games: Reverse
(party version of Esrever), Quip Battle, Bluff It, Sketch It. Classic two-player Esrever stays at
`?mode=classic`. Static site on Vercel; online uses Supabase Realtime Broadcast (no database).

## Stack

TypeScript (strict) · Vite · plain DOM/CSS (Game Night: Bricolage Grotesque, dark; classic:
Fredoka) · Web Audio + MediaRecorder · WebCrypto · Supabase Realtime · `uqr` · pnpm · Vitest ·
Playwright · ESLint + Prettier.

## Commands

`pnpm dev` · `pnpm build` / `pnpm preview` · `pnpm lint` · `pnpm typecheck` · `pnpm test` ·
`pnpm test:e2e` · `pnpm check` (all) · `node scripts/import-content.mjs <dir>` (rebuild packs)

## Structure

- `src/platform/` pure: `room.ts` (`RoomState`, `reduceRoom`: join/kick/select/settings/start/
  pause/skip/lobby/tick; same object when an action doesn't apply), `module.ts` (`GameModule`:
  init/act/advance/view/privateView/scores/done), `scores.ts`, `rng.ts`, `text.ts` (answer matching).
- `src/games/<id>/rules.ts` pure rules per game (+ tests); `registry.ts` lists them.
  `view` is public (TV + phones), `privateView` is one player's secrets; neither reveals an
  answer before its reveal phase. Untrusted input: validate everything in `act`.
- `src/content/` `schema.ts`, `library.ts` (load packs on the TV, custom packs, recent history),
  `deal.ts`, `packs/*.json` (generated; sources in CREDITS.md and `content/original/`).
- `src/net/` `host.ts` (TV: authority, timers, sealed per-player slots, persists to
  localStorage), `player.ts` (phone: identity per tab in sessionStorage, sealed actions resent
  until acked), `crypto.ts`, `gnProtocol.ts`, `channel.ts` (Supabase or BroadcastChannel with
  `?net=local`). Classic: `room.ts`, `protocol.ts`.
- `src/ui/gn/` Game Night UI: `app.ts` (home, TV lobby/game/results, phone screens; re-render
  by key), `games/*.ts` (each game's TV + phone screens), `core.ts` (timers, drafts, avatars),
  `sound.ts`, `qr.ts`, `gn.css`. Classic UI: `src/ui/app.ts`, `screens.ts`, `widgets.ts`.
- `src/game/`, `src/audio/` classic Esrever rules and audio (reused by Reverse).

## Conventions

- Rules change → unit test next to the rules. New screen flow → cover it in `tests/e2e/`.
- E2E never needs Supabase: `?net=local` with pages of one context (`tests/e2e/gamenight.ts`).
- Supabase URL/key come only from `VITE_SUPABASE_*` env vars; never commit keys.
- Content: only import sources whose license allows it; record them in CREDITS.md.
