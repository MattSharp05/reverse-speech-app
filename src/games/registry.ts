import type { GameId, GameModule } from '../platform/module';
import type { Modules } from '../platform/room';
import { bluff } from './bluff/rules';
import { doodle } from './doodle/rules';
import { hotTakes } from './hottakes/rules';
import { oddOne } from './oddone/rules';
import { quip } from './quip/rules';
import { reverse } from './reverse/rules';
import { sketchIt } from './sketch/rules';

export const modules: Modules = {
  reverse: reverse as unknown as GameModule,
  quip: quip as unknown as GameModule,
  bluff: bluff as unknown as GameModule,
  sketch: sketchIt as unknown as GameModule,
  oddone: oddOne as unknown as GameModule,
  hottakes: hotTakes as unknown as GameModule,
  doodle: doodle as unknown as GameModule,
};

/** In the order the game cards show. */
export const GAME_IDS: GameId[] = ['quip', 'bluff', 'sketch', 'oddone', 'hottakes', 'doodle', 'reverse'];
