# Esrever

The say-it-backwards word game for two. A mobile web app: play on one phone, or on two
phones online.

1. Each player types 5 secret words and records themselves saying them (the other player
   covers their ears).
2. Each round, a player hears the other's word **reversed**, records themselves copying that
   backwards sound, then hears their copy reversed again, which sounds close to the real word.
3. They type a guess. Right answers score (case, spaces and one typo on longer words don't
   matter; the word's owner can "Count it" for a near miss). 5 rounds each; most points wins.

## Run it

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

Phones need **HTTPS** to use the microphone, so test on a phone with the Vercel deployment
(or `localhost` on a desktop). On an iPhone, Share → Add to Home Screen gives it an app icon.

Online play locally, no server: open `/?net=local` in two tabs of the same browser.

## Online play (Supabase)

Online rooms use Supabase Realtime **Broadcast** only: no tables, no SQL, nothing stored. Set
two env vars (in Vercel → Settings → Environment Variables, and `.env.local` for `pnpm dev`):

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
```

Without them the app works one-phone only and the online button says it isn't set up.

## Checks

- `pnpm test`: unit tests (rules, word matching, audio processing, room sync)
- `pnpm test:e2e`: Playwright, a full one-phone game and a full online game (Chromium's fake mic)
- `pnpm check`: everything

## Deploy

Import the repo in Vercel (framework: Vite; `vercel.json` sets pnpm), add the two Supabase env
vars, deploy.
