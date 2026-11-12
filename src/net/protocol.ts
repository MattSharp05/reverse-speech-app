import type { Action, GameState, Seat } from '../game/state';

/**
 * Messages on a room's channel. Everyone hears everything; `from` is the sender's client id.
 * The host (whoever made the room, seat 0) owns the game state: the guest sends actions and
 * the host sends back the whole state, which is small. Clips travel separately, in parts.
 */
export type Message =
  | { t: 'hello'; from: string; name: string }
  | { t: 'state'; from: string; state: GameState; seats: Record<string, Seat>; acked: string[] }
  | { t: 'act'; from: string; id: string; action: Action }
  | { t: 'clip'; from: string; id: string; part: number; parts: number; data: string }
  | { t: 'need'; from: string; ids: string[] };

/** Base64 characters per clip message (Supabase allows 256 KB a broadcast on the free plan). */
export const CLIP_PART_CHARS = 60_000;

export type ClipMessage = Extract<Message, { t: 'clip' }>;

export function splitClip(from: string, id: string, data: string): ClipMessage[] {
  const parts = Math.max(1, Math.ceil(data.length / CLIP_PART_CHARS));
  return Array.from({ length: parts }, (_, part) => ({
    t: 'clip' as const,
    from,
    id,
    part,
    parts,
    data: data.slice(part * CLIP_PART_CHARS, (part + 1) * CLIP_PART_CHARS),
  }));
}

/** Puts clips back together from their parts, in any order, ignoring repeats. */
export class ClipAssembler {
  private readonly partial = new Map<string, (string | undefined)[]>();

  /** Returns the clip's whole base64 data once its last part arrives. */
  add(message: ClipMessage): string | null {
    const parts = this.partial.get(message.id) ?? Array.from<string | undefined>({ length: message.parts });
    parts[message.part] = message.data;
    this.partial.set(message.id, parts);
    if (parts.length !== message.parts || parts.includes(undefined)) return null;
    this.partial.delete(message.id);
    return parts.join('');
  }
}
