# Game Night

Party games on one big screen, played with your phones, in the spirit of Jackbox. Open it on a
laptop plugged into the TV, create a room, and everyone joins from their phone's browser with
the room code or QR code. No app and no accounts. Players stay in the room between games.

| Game                 | What happens                                                                                                                                                   | Players |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Reverse**          | Everyone records secret words. Each round you get someone else's word played backwards, copy the sound, flip your copy, and guess.                             | 2–10    |
| **Quip Battle**      | Two players answer each ridiculous prompt; everyone else votes for the funnier one. Final round: everyone answers one prompt.                                  | 3–10    |
| **Bluff It**         | Write a believable fake answer to strange trivia, then find the real answer among everyone's lies.                                                             | 2–10    |
| **Sketch It**        | Draw a secret absurd prompt on your phone, write fake titles for each other's drawings, then spot the real one.                                                | 3–10    |
| **Odd One Out**      | Everyone gets the same secret word except one player. Give a clue, vote out the faker; if caught, they can still steal points by guessing the word.            | 3–10    |
| **Hot Takes**        | "Who's most likely to…?" (score for picking who the group picks) and 0–10 opinion questions (rate it, guess the group average).                                | 3–10    |
| **Telephone Doodle** | Write a phrase; the next phone draws it, the next guesses the drawing, and so on. The TV plays every chain back and everyone votes for their favourite moment. | 3–10    |

**Classic Esrever**, the original two-player Reverse on one phone or two, is still there:
"Play classic Reverse" on the home page (`/?mode=classic`). Old `?room=` links still open it.

## Playing

1. On the laptop/TV: open the site and click **Host on this screen**.
2. Friends scan the QR code (or open the site and tap **Join on my phone**) and enter the code.
3. Pick a game, adjust its settings if you like, and **Start**. Phases run on timers; the
   host can **Pause**, **Skip**, **End game**, remove players (✕ in the lobby), and after a
   game **Play again** or go **Back to Game Night** for another game.
4. Short of players? **🤖 Add a bot** in the lobby: the laptop plays it, answering, lying,
   scribbling and voting after a few seconds' "thinking". Remove one with its ✕. (In Reverse a
   bot's "recording" is a beep, so you can't really decode its words.)
5. Refreshing a phone keeps the player and their answers.
6. Music plays on the laptop/TV throughout: a lobby track, then writing, drawing and voting
   tracks that crossfade with each phase, a ticking clock in the last 10 seconds, and stings
   for reveals and winners. Adjust it with the 🎵 slider (🔊 mutes everything). If the TV's tab reloads, the room
   picks up where it was.

Phones need **HTTPS** for the microphone (Reverse) and for sealed messages, so play on the
Vercel deployment. Locally, open `/?net=local` in several tabs of one browser: one hosts, the
others join (no server needed).

## Run it

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

## Online (Supabase)

Rooms use Supabase Realtime **Broadcast** only: no tables, nothing stored. Set two env vars
(in Vercel → Settings → Environment Variables, and `.env.local` for `pnpm dev`):

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
```

## How it works

- The **TV is the authority**: it runs every game's rules, the timers and the scores; phones
  only send requests, which the TV validates (right phase, right player, once).
- Everything on a broadcast channel is heard by everyone, so each phone and the TV agree an
  AES-GCM key (ECDH, WebCrypto) and private things travel sealed: your prompts, your answers,
  your drawing prompt. Correct answers never leave the TV before their reveal.
- See [docs/game-night-plan.md](docs/game-night-plan.md) for the architecture and
  [CREDITS.md](CREDITS.md) for where the prompts and trivia come from (and their licenses).

## Content

1,228 Quip prompts, 3,705 trivia questions and 713 drawing prompts are built in. The TV's
**Content packs** button loads your own JSON or CSV packs (kept in that browser). To rebuild
the built-in packs from the sources: `node scripts/import-content.mjs <sources dir>`.

## Checks

- `pnpm test`: unit tests (room and game rules, scoring, content, networking with sealed
  messages, audio processing)
- `pnpm test:e2e`: Playwright: classic Esrever on one and two phones, and Game Night with a TV
  and three phones (every game, reconnects, pause, kicks, TV reload)
- `pnpm check`: everything

## Deploy

Import the repo in Vercel (framework: Vite; `vercel.json` sets pnpm), add the two Supabase env
vars, deploy.
