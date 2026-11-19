import type { ContentLibrary } from '../content/schema';
import type { Rng } from './rng';

export type PlayerId = string;
export type GameId = 'reverse' | 'quip' | 'bluff' | 'sketch' | 'oddone' | 'hottakes' | 'doodle';

export interface Player {
  id: PlayerId;
  name: string;
  /** Index into the player colour palette. */
  color: number;
  /** Played by the TV itself. */
  bot?: boolean;
}

/** What rules get from the room besides the state: the host's clock, randomness, content. */
export interface Ctx {
  now: number;
  rng: Rng;
  content: ContentLibrary;
}

/** Every game state carries the deadline of its current phase (host clock, ms), or null. */
export interface Timed {
  deadline: number | null;
}

export interface SettingDef {
  key: string;
  label: string;
  options: { value: string | number; label: string }[];
}

/**
 * One game's rules. Everything is pure and runs on the host only: `act` gets untrusted input
 * from phones and must return the same state object when the action doesn't apply.
 * `view` is what everyone may see (the TV and every phone); `privateView` is one player's own
 * secrets (sent to them alone, encrypted). Neither may reveal an answer before its reveal.
 */
export interface GameModule<S extends Timed = Timed, Settings = Record<string, string | number>> {
  id: GameId;
  minPlayers: number;
  maxPlayers: number;
  settings: SettingDef[];
  defaults: Settings;
  init(players: Player[], settings: Settings, ctx: Ctx): S;
  act(state: S, from: PlayerId, action: unknown, ctx: Ctx): S;
  /** The phase's time is up (or the host skipped it): lock it, fill gaps, move on. */
  advance(state: S, ctx: Ctx): S;
  view(state: S): unknown;
  privateView(state: S, player: PlayerId): unknown;
  scores(state: S): Record<PlayerId, number>;
  done(state: S): boolean;
  /** Content ids this game used, remembered so the next games avoid them. */
  used(state: S): string[];
  /** Audio clip ids the game refers to (Reverse): the TV fetches any it lacks. */
  clips?(state: S): string[];
  /**
   * What a bot does now, or null when it has nothing to do in this phase. Must return an action
   * `act` accepts. The TV calls it after a short, random "thinking" delay.
   */
  botAction?(state: S, bot: PlayerId, rng: Rng): unknown;
  /** Audio clips one player's phone needs right now (Reverse). */
  playerClips?(state: S, player: PlayerId): string[];
}

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

export const asInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

export const secs = (s: number): number => s * 1000;
