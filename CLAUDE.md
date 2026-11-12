# Esrever (reverse-speech-app)

Two-player "say it backwards" word game. Mobile web app (iPhone Safari first), one phone or two
phones online. Static site on Vercel; online uses Supabase Realtime Broadcast (no database).

## Stack

TypeScript (strict) · Vite · plain DOM/CSS (font: Fredoka) · Web Audio + MediaRecorder ·
Supabase Realtime · pnpm · Vitest · Playwright · ESLint + Prettier.

## Commands

`pnpm dev` · `pnpm build` / `pnpm preview` · `pnpm lint` · `pnpm typecheck` · `pnpm test` ·
`pnpm test:e2e` · `pnpm check` (all)

## Structure

- `src/game/` pure rules: `state.ts` (`GameState`, `Action`, `reduce`; returns the same object
  when an action doesn't apply), `match.ts` (guess checking). No DOM/audio/net (lint-enforced).
- `src/audio/` `pcm.ts` (16 kHz mono clips: trim, normalize, reverse, base64), `engine.ts`
  (mic recording, playback; `unlock()` on every tap for iOS), `clips.ts` (clip store by id).
- `src/net/` `room.ts`: host-authoritative online game (the room creator is seat 0 and runs
  `reduce`; the guest sends actions, resent until acked). `protocol.ts` messages + clip chunking.
  `channel.ts`: Supabase (`supabase.ts`, lazy-loaded) or BroadcastChannel with `?net=local`.
- `src/ui/` `app.ts` (views, sessions, re-render by screen key so typing isn't lost),
  `screens.ts` (every screen), `widgets.ts` (record / play buttons), `styles.css`.

## Conventions

- Rules change → unit test in `src/game/`. New screen flow → cover it in `tests/e2e/`.
- E2E never needs Supabase: online specs use `?net=local` with two pages of one context.
- Supabase URL/key come only from `VITE_SUPABASE_*` env vars; never commit keys.
