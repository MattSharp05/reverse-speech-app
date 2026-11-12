import { getClip, hasClip, onClip, putClip } from '../audio/clips';
import { decode, encode } from '../audio/pcm';
import { clipIds, newGame, reduce, type Action, type GameState, type Seat } from '../game/state';
import type { Channel } from './channel';
import { ClipAssembler, splitClip, type Message } from './protocol';

/** How often the host repeats the state, and the guest says hello (so either sees a drop), ms. */
export const HEARTBEAT_MS = 2000;
/** The friend counts as gone after this long without a message, ms. */
export const PEER_TIMEOUT_MS = 7000;
/** A guest's action not yet confirmed by the host is sent again after this, ms. */
const RESEND_MS = 1500;
/** Missing clips are asked for again after this, ms. */
const NEED_RETRY_MS = 2500;
/** Action ids the host remembers, so a resent action isn't applied twice. */
const ACKED_KEPT = 40;

export type RoomStatus = 'connecting' | 'playing' | 'full';

export interface RoomOptions {
  code: string;
  clientId: string;
  host: boolean;
  name: string;
  /** Where the host keeps its game so a page reload doesn't lose it (sessionStorage in the app). */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
}

interface HostSave {
  state: GameState;
  seats: Record<string, Seat>;
}

/**
 * One player's end of an online game. The host applies every action (its own and the
 * guest's) with the game rules and sends out the result; the guest only ever shows what the
 * host sent. Clips are sent when recorded, and asked for again by whoever lacks one.
 */
export class Room {
  state: GameState | null = null;
  seat: Seat | null = null;
  status: RoomStatus = 'connecting';

  private seats: Record<string, Seat> = {};
  private acked: string[] = [];
  private readonly pending = new Map<string, Action>();
  private readonly assembler = new ClipAssembler();
  private readonly asked = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly now: () => number;
  private lastPeer = 0;
  private lastResend = 0;
  private actionCount = 0;
  private readonly stopClipListener: () => void;

  constructor(
    private readonly channel: Channel,
    private readonly options: RoomOptions,
  ) {
    this.now = options.now ?? Date.now;
    channel.onMessage((message) => this.receive(message));
    if (options.host) {
      const saved = this.load();
      this.state = saved?.state ?? newGame('online', [options.name, 'Player 2']);
      this.seats = saved?.seats ?? { [options.clientId]: 0 };
      this.seat = 0;
      this.status = 'playing';
      this.broadcastState();
    } else {
      this.hello();
    }
    this.timers.push(setInterval(() => this.tick(), HEARTBEAT_MS / 2));
    // Our own recordings go out as soon as they're made.
    this.stopClipListener = onClip((id) => {
      if (id.startsWith(`${options.clientId}-`)) this.sendClip(id);
    });
  }

  get code(): string {
    return this.options.code;
  }

  /** Someone holds seat 1 (the guest always does, once it has a seat). */
  guestJoined(): boolean {
    return Object.values(this.seats).includes(1) || (!this.options.host && this.seat === 1);
  }

  /** The friend has been heard from recently. */
  peerOnline(): boolean {
    return this.now() - this.lastPeer < PEER_TIMEOUT_MS;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(action: Action): void {
    if (this.options.host) {
      this.apply(action, 0);
      return;
    }
    const id = `${this.options.clientId}:${this.actionCount++}`;
    this.pending.set(id, action);
    this.channel.send({ t: 'act', from: this.options.clientId, id, action });
  }

  close(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.stopClipListener();
    this.channel.close();
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private tick(): void {
    if (this.options.host) {
      this.broadcastState();
    } else {
      this.hello();
      if (this.now() - this.lastResend >= RESEND_MS) {
        this.lastResend = this.now();
        this.resendPending();
      }
    }
    this.askForClips();
    this.emit(); // peerOnline() may have changed.
  }

  private hello(): void {
    this.channel.send({ t: 'hello', from: this.options.clientId, name: this.options.name });
  }

  private resendPending(): void {
    for (const [id, action] of this.pending) {
      this.channel.send({ t: 'act', from: this.options.clientId, id, action });
    }
  }

  private receive(message: Message): void {
    if (message.from === this.options.clientId) return;
    this.lastPeer = this.now();
    switch (message.t) {
      case 'hello':
        if (this.options.host) this.welcome(message.from, message.name);
        break;
      case 'act': {
        if (!this.options.host) break;
        const seat = this.seats[message.from];
        if (seat === undefined) break;
        if (!this.acked.includes(message.id)) {
          this.acked = [...this.acked, message.id].slice(-ACKED_KEPT);
          this.apply(message.action, seat);
        }
        this.broadcastState();
        break;
      }
      case 'state':
        if (this.options.host) break;
        this.state = message.state;
        this.seat = message.seats[this.options.clientId] ?? null;
        this.status = this.seat === null ? 'full' : 'playing';
        for (const id of message.acked) this.pending.delete(id);
        this.askForClips();
        this.emit();
        break;
      case 'need':
        for (const id of message.ids) if (hasClip(id)) this.sendClip(id);
        break;
      case 'clip': {
        if (hasClip(message.id)) break;
        const data = this.assembler.add(message);
        if (data !== null) {
          putClip(message.id, decode(data));
          this.emit();
        }
        break;
      }
    }
  }

  private welcome(clientId: string, name: string): void {
    if (!this.state) return;
    if (this.seats[clientId] === undefined && !Object.values(this.seats).includes(1)) {
      this.seats = { ...this.seats, [clientId]: 1 };
      this.setState(reduce(this.state, { type: 'join', name }));
      return;
    }
    // Seated already (or the room is full): just let them catch up.
    this.broadcastState();
  }

  /** Host only: runs an action as `seat` (a guest can never act for the host). */
  private apply(action: Action, seat: Seat): void {
    if (!this.state) return;
    if (seat !== 0 && (action.type === 'start' || action.type === 'join')) return;
    const seated = 'seat' in action ? ({ ...action, seat } as Action) : action;
    const next = reduce(this.state, seated);
    if (next !== this.state) this.setState(next);
  }

  private setState(state: GameState): void {
    this.state = state;
    this.save();
    this.broadcastState();
    this.emit();
  }

  private broadcastState(): void {
    if (!this.state) return;
    this.channel.send({
      t: 'state',
      from: this.options.clientId,
      state: this.state,
      seats: this.seats,
      acked: this.acked,
    });
  }

  private sendClip(id: string): void {
    const samples = getClip(id);
    if (!samples) return;
    for (const part of splitClip(this.options.clientId, id, encode(samples))) this.channel.send(part);
  }

  private askForClips(): void {
    if (!this.state) return;
    const now = this.now();
    const ids = clipIds(this.state).filter(
      (id) => !hasClip(id) && now - (this.asked.get(id) ?? -Infinity) > NEED_RETRY_MS,
    );
    if (!ids.length) return;
    for (const id of ids) this.asked.set(id, now);
    this.channel.send({ t: 'need', from: this.options.clientId, ids });
  }

  private storageKey(): string {
    return `esrever:host:${this.options.code}`;
  }

  private load(): HostSave | null {
    try {
      const raw = this.options.storage?.getItem(this.storageKey());
      return raw ? (JSON.parse(raw) as HostSave) : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      this.options.storage?.setItem(
        this.storageKey(),
        JSON.stringify({ state: this.state, seats: this.seats }),
      );
    } catch {
      // Storage full or blocked: a reload just starts over.
    }
  }
}
