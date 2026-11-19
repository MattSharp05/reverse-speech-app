import type { Rng } from '../platform/rng';

/**
 * Stock material for bots (players the TV plays itself, for testing or a small group).
 * Bots aren't clever: they answer from these lists and vote at random, sometimes for the truth.
 */

export const BOT_NAMES = [
  'Robo Rita',
  'Beep Boop',
  'Captain Cog',
  'Sir Bytes',
  'Gizmo',
  'Clanky',
  'Dot Matrix',
  'Rusty',
];

export const BOT_ANSWERS = [
  'A suspiciously large goose',
  'My uncle’s podcast',
  'Three raccoons in a trench coat',
  'Interpretive dance',
  'Wet socks',
  'A strongly worded letter',
  'Grandma’s secret casserole',
  'Unlimited breadsticks',
  'The Wi-Fi password',
  'A haunted toaster',
  'Tax fraud, but cute',
  'Crying in the car',
  'An emotional support lizard',
  'Whatever is in the fridge',
  'Jazz hands',
  'A motivational poster',
  'Spaghetti, somehow',
  'My ex',
  'Glitter. So much glitter.',
  'A tiny, angry horse',
  'Beep boop, I am human',
  'The cheese drawer',
  'Napping professionally',
  'A very confident pigeon',
];

export const BOT_WORDS = [
  'banana',
  'robot',
  'pickle',
  'rocket',
  'teapot',
  'wizard',
  'noodle',
  'pirate',
  'cactus',
  'waffle',
];

export const pick = <T>(items: readonly T[], rng: Rng): T => items[Math.floor(rng() * items.length)]!;

/** A random scribble: a few wobbly strokes inside the canvas (`w` × `h`). */
export function scribble(rng: Rng, w: number, h: number): { c: number; s: number; p: number[] }[] {
  const strokes = [];
  const count = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < count; i++) {
    let x = 100 + Math.floor(rng() * (w - 200));
    let y = 100 + Math.floor(rng() * (h - 200));
    const p = [x, y];
    for (let k = 0; k < 12; k++) {
      x = Math.max(0, Math.min(w, x + Math.floor((rng() - 0.5) * 120)));
      y = Math.max(0, Math.min(h, y + Math.floor((rng() - 0.5) * 120)));
      p.push(x, y);
    }
    strokes.push({ c: Math.floor(rng() * 5), s: Math.floor(rng() * 3), p });
  }
  return strokes;
}
