import type { GameId, GameModule } from '../platform/module';
import type { Modules } from '../platform/room';
import { bluff } from './bluff/rules';
import { quip } from './quip/rules';
import { reverse } from './reverse/rules';
import { sketchIt } from './sketch/rules';

export const modules: Modules = {
  reverse: reverse as unknown as GameModule,
  quip: quip as unknown as GameModule,
  bluff: bluff as unknown as GameModule,
  sketch: sketchIt as unknown as GameModule,
};

export const GAME_IDS: GameId[] = ['reverse', 'quip', 'bluff', 'sketch'];
