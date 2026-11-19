import { describe, expect, it } from 'vitest';
import type { GameModule, Timed } from '../platform/module';
import { players, testCtx } from '../test/fixtures';
import { modules, GAME_IDS } from './registry';

describe('bots', () => {
  for (const id of GAME_IDS) {
    it(`play ${id} to the end with moves the rules accept`, () => {
      const module = modules[id] as GameModule<Timed>;
      const ctx = testCtx(11);
      const bots = players(4).map((p) => ({ ...p, bot: true }));
      let state = module.init(bots, module.defaults as Record<string, string | number>, ctx);
      let moves = 0;
      for (let step = 0; step < 500 && !module.done(state); step++) {
        let acted = false;
        for (const bot of bots) {
          const action = module.botAction!(state, bot.id, ctx.rng);
          if (action === null) continue;
          const next = module.act(state, bot.id, action, ctx);
          expect(next, `${id}: ${JSON.stringify(action)}`).not.toBe(state);
          state = next;
          moves++;
          acted = true;
        }
        if (!acted) state = module.advance(state, ctx);
      }
      expect(module.done(state)).toBe(true);
      expect(moves).toBeGreaterThan(4);
    });
  }
});
