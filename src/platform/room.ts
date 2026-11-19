import type { Ctx, GameId, GameModule, Player, PlayerId, Timed } from './module';
import { standings, winners, type Standing } from './scores';

/** Players a room takes (one colour each). */
export const MAX_PLAYERS = 10;
export const NAME_MAX = 14;

export interface GameSession {
  id: GameId;
  /** Who plays this game (the room's players when it started). */
  players: PlayerId[];
  state: Timed;
  /** Set when the rules say the game is over: the results screen shows. */
  over: boolean;
}

export interface GameResult {
  game: GameId;
  standings: Standing[];
  winners: PlayerId[];
}

/**
 * A Game Night room: lives on the TV (the host), outlasts any one game. Players keep their
 * identity across games; the host picks, configures, starts, pauses, skips and ends games.
 */
export interface RoomState {
  code: string;
  players: Player[];
  kicked: PlayerId[];
  selected: GameId;
  settings: Partial<Record<GameId, Record<string, string | number>>>;
  game: GameSession | null;
  /** The last finished game, for the results screen. */
  result: GameResult | null;
  /** Game Night standings: games won per player (ties count for everyone tied). */
  wins: Record<PlayerId, number>;
  /** Paused since (host ms), or null. */
  paused: number | null;
}

export type RoomAction =
  | { type: 'join'; id: PlayerId; name: string }
  | { type: 'rename'; id: PlayerId; name: string }
  | { type: 'kick'; id: PlayerId }
  | { type: 'addBot'; id: PlayerId; name: string }
  | { type: 'select'; game: GameId }
  | { type: 'setting'; game: GameId; key: string; value: string | number }
  | { type: 'start' }
  | { type: 'restart' }
  | { type: 'lobby' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'skip' }
  | { type: 'play'; from: PlayerId; action: unknown }
  | { type: 'tick' };

/** Room actions a phone may send; everything else is the TV's alone. */
export const PLAYER_ACTIONS: ReadonlySet<RoomAction['type']> = new Set(['rename', 'play']);

export type Modules = Readonly<Record<GameId, GameModule>>;

export function newRoom(code: string): RoomState {
  return {
    code,
    players: [],
    kicked: [],
    selected: 'quip',
    settings: {},
    game: null,
    result: null,
    wins: {},
    paused: null,
  };
}

export function cleanName(name: unknown, taken: string[]): string {
  const base =
    (typeof name === 'string' ? name : '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || 'Player';
  const lower = taken.map((n) => n.toLowerCase());
  if (!lower.includes(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, NAME_MAX - 2)} ${n}`;
    if (!lower.includes(candidate.toLowerCase())) return candidate;
  }
}

function freeColor(players: Player[]): number {
  for (let c = 0; c < MAX_PLAYERS; c++) if (!players.some((p) => p.color === c)) return c;
  return players.length % MAX_PLAYERS;
}

export function settingsFor(room: RoomState, module: GameModule): Record<string, string | number> {
  return { ...(module.defaults as Record<string, string | number>), ...room.settings[module.id] };
}

/** The game's state, with the room's `Ctx`, through one of its rule functions. */
function withGame(room: RoomState, modules: Modules, update: (m: GameModule, s: Timed) => Timed): RoomState {
  const game = room.game;
  if (!game || game.over) return room;
  const module = modules[game.id];
  const state = update(module, game.state);
  if (state === game.state) return room;
  const over = module.done(state);
  const next: RoomState = { ...room, game: { ...game, state, over } };
  return over ? finish(next, modules) : next;
}

function finish(room: RoomState, modules: Modules): RoomState {
  const game = room.game!;
  const module = modules[game.id];
  const players = room.players.filter((p) => game.players.includes(p.id));
  const rows = standings(players, module.scores(game.state));
  const won = winners(rows);
  const wins = { ...room.wins };
  for (const id of won) wins[id] = (wins[id] ?? 0) + 1;
  return { ...room, wins, result: { game: game.id, standings: rows, winners: won } };
}

function start(room: RoomState, id: GameId, modules: Modules, ctx: Ctx): RoomState {
  const module = modules[id];
  if (room.players.length < module.minPlayers) return room;
  const players = room.players.slice(0, module.maxPlayers);
  const state = module.init(players, settingsFor(room, module), ctx);
  return {
    ...room,
    selected: id,
    paused: null,
    result: null,
    game: { id, players: players.map((p) => p.id), state, over: false },
  };
}

/**
 * The room's rules. Returns the same object when an action doesn't apply. Who may send what
 * is checked by the network layer (`PLAYER_ACTIONS`); ids in `join` come from it too.
 */
export function reduceRoom(room: RoomState, action: RoomAction, modules: Modules, ctx: Ctx): RoomState {
  switch (action.type) {
    case 'join': {
      if (room.kicked.includes(action.id)) return room;
      if (room.players.some((p) => p.id === action.id)) return room;
      if (room.players.length >= MAX_PLAYERS) return room;
      const player: Player = {
        id: action.id,
        name: cleanName(
          action.name,
          room.players.map((p) => p.name),
        ),
        color: freeColor(room.players),
      };
      return { ...room, players: [...room.players, player] };
    }

    case 'addBot': {
      if (room.players.length >= MAX_PLAYERS || room.players.some((p) => p.id === action.id)) return room;
      const player: Player = {
        id: action.id,
        name: cleanName(
          action.name,
          room.players.map((p) => p.name),
        ),
        color: freeColor(room.players),
        bot: true,
      };
      return { ...room, players: [...room.players, player] };
    }

    case 'rename': {
      const index = room.players.findIndex((p) => p.id === action.id);
      if (index < 0) return room;
      const others = room.players.filter((p) => p.id !== action.id).map((p) => p.name);
      const name = cleanName(action.name, others);
      if (name === room.players[index]!.name) return room;
      const players = room.players.map((p) => (p.id === action.id ? { ...p, name } : p));
      return { ...room, players };
    }

    case 'kick': {
      if (!room.players.some((p) => p.id === action.id)) return room;
      return {
        ...room,
        players: room.players.filter((p) => p.id !== action.id),
        kicked: [...room.kicked, action.id],
      };
    }

    case 'select':
      if (!(action.game in modules) || room.game) return room;
      return action.game === room.selected ? room : { ...room, selected: action.game };

    case 'setting': {
      const module = modules[action.game];
      const def = module?.settings.find((s) => s.key === action.key);
      if (!def) return room;
      const valid =
        def.options.some((o) => o.value === action.value) ||
        (action.key === 'category' && typeof action.value === 'string' && action.value.length <= 40);
      if (!valid) return room;
      const settings = {
        ...room.settings,
        [action.game]: { ...room.settings[action.game], [action.key]: action.value },
      };
      return { ...room, settings };
    }

    case 'start':
      if (room.game && !room.game.over) return room;
      return start(room, room.selected, modules, ctx);

    case 'restart':
      if (!room.game) return room;
      return start(room, room.game.id, modules, ctx);

    case 'lobby':
      if (!room.game) return room;
      return { ...room, game: null, paused: null };

    case 'pause':
      if (!room.game || room.game.over || room.paused !== null) return room;
      return { ...room, paused: ctx.now };

    case 'resume': {
      if (room.paused === null || !room.game) return { ...room, paused: null };
      const delay = ctx.now - room.paused;
      const state = room.game.state;
      const shifted = state.deadline === null ? state : { ...state, deadline: state.deadline + delay };
      return { ...room, paused: null, game: { ...room.game, state: shifted } };
    }

    case 'skip':
      return withGame(room, modules, (m, s) => m.advance(s, ctx));

    case 'play': {
      const game = room.game;
      if (!game || !game.players.includes(action.from) || room.kicked.includes(action.from)) return room;
      return withGame(room, modules, (m, s) => m.act(s, action.from, action.action, ctx));
    }

    case 'tick': {
      const deadline = room.game?.state.deadline;
      if (room.paused !== null || deadline === null || deadline === undefined || ctx.now < deadline)
        return room;
      return withGame(room, modules, (m, s) => m.advance(s, ctx));
    }
  }
}
