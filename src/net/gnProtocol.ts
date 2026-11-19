import type { GameId, Player, PlayerId } from '../platform/module';
import type { GameResult } from '../platform/room';
import type { Sealed } from './crypto';
import type { ClipMessage } from './protocol';

/** A sealed value, or (dev without WebCrypto only) a plain one. */
export type Box = Sealed | { plain: unknown };

/**
 * Game Night messages on channel `gn:CODE`. The TV (host) owns the room: phones say hello and
 * send sealed actions; the TV sends one `state` per change (and a heartbeat) with the public
 * room and a sealed slot per player.
 */
export type GnMessage =
  /** A phone: "I'm here" (every couple of seconds). `pub` is null without WebCrypto (dev). */
  | { t: 'hello'; from: PlayerId; pub: string | null; name: string; /** Has no state yet: send it now. */ sync?: boolean }
  | {
      t: 'state';
      from: 'host';
      /** The TV's public key (null without WebCrypto). */
      host: string | null;
      /** The TV's clock, so phones show the same countdown. */
      now: number;
      rev: number;
      room: PublicRoom;
      /** Each player's private view, sealed for them (or plain, dev only). */
      priv: Record<PlayerId, Box>;
    }
  /** A phone's action: sealed `{ id, action }` (or plain, dev only). */
  | { t: 'act'; from: PlayerId; box: Box }
  | ClipMessage
  | { t: 'need'; from: string; ids: string[] };

export interface PublicPlayer extends Player {
  online: boolean;
}

/** What everyone may see: the TV renders this, and so does every phone. */
export interface PublicRoom {
  code: string;
  players: PublicPlayer[];
  kicked: PlayerId[];
  selected: GameId;
  game: {
    id: GameId;
    players: PlayerId[];
    over: boolean;
    paused: boolean;
    view: unknown;
  } | null;
  result: GameResult | null;
  wins: Record<PlayerId, number>;
}

/** One player's sealed slot. */
export interface PrivateSlot {
  /** Action ids the TV has applied (or turned away): stop resending them. */
  acked: string[];
  /** The game's private view for this player (null outside a game they play). */
  view: unknown;
  /** Audio clips this phone should fetch (Reverse). */
  clips: string[];
}

/** What a phone may ask for: room actions a player may take. */
export type PlayerAction = { type: 'rename'; name: string } | { type: 'play'; action: unknown };
