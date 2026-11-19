import type { PlayerId } from '../../../platform/module';
import type { PublicPlayer, PublicRoom } from '../../../net/gnProtocol';

export interface TvCtx<V = unknown> {
  room: PublicRoom;
  view: V;
  players: Map<PlayerId, PublicPlayer>;
  paused: boolean;
}

export interface PhoneCtx<V = unknown, P = unknown> {
  room: PublicRoom;
  view: V;
  /** This player's private view (null while it's on its way). */
  priv: P | null;
  me: PublicPlayer;
  players: Map<PlayerId, PublicPlayer>;
  paused: boolean;
  /** Sends a game action to the TV. */
  send(action: unknown): void;
  /** An action is still on its way to the TV. */
  sending: boolean;
}

export interface GameUi {
  tv(c: TvCtx): HTMLElement;
  phone(c: PhoneCtx): HTMLElement;
}
