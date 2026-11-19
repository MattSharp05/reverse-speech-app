import { getClip, hasClip, onClip, putClip } from '../audio/clips';
import { decode, encode } from '../audio/pcm';
import type { PlayerId } from '../platform/module';
import { MAX_PLAYERS } from '../platform/room';
import { randomId } from '../platform/rng';
import type { Channel } from './channel';
import {
  cryptoAvailable,
  loadIdentity,
  newIdentity,
  seal,
  sharedKey,
  unseal,
  type Identity,
  type SavedIdentity,
} from './crypto';
import type { GnMessage, PlayerAction, PrivateSlot, PublicRoom } from './gnProtocol';
import { ClipAssembler, splitClip } from './protocol';

export const HELLO_MS = 2000;
/** No word from the TV for this long: the connection looks lost, ms. */
export const HOST_LOST_MS = 7000;
const NEED_RETRY_MS = 2500;

export type PlayerStatus = 'connecting' | 'joined' | 'full' | 'kicked';

export interface SavedPlayer {
  id: PlayerId;
  identity: SavedIdentity | null;
}

export interface PlayerOptions {
  code: string;
  name: string;
  channel: Channel<GnMessage>;
  /** Where this phone keeps its identity, so a refresh is the same player. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
}

/**
 * A phone's end of a Game Night room. It shows what the TV sends and asks the TV to act:
 * actions are sealed with this phone's key and resent until the TV says it has them.
 */
export class PlayerClient {
  id: PlayerId = '';
  status: PlayerStatus = 'connecting';
  room: PublicRoom | null = null;
  slot: PrivateSlot | null = null;
  private identity: Identity | null = null;
  private hostPub: string | null = null;
  private hostKey: Promise<CryptoKey> | null = null;
  /** Host clock minus ours, ms. */
  private offset = 0;
  private lastHeard = 0;
  private count = 0;
  private name: string;
  private readonly pending = new Map<string, PlayerAction>();
  private readonly listeners = new Set<() => void>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly assembler = new ClipAssembler();
  private readonly asked = new Map<string, number>();
  private readonly now: () => number;
  private stopClips: () => void = () => undefined;
  private queue: Promise<void> = Promise.resolve();

  private constructor(private readonly options: PlayerOptions) {
    this.now = options.now ?? Date.now;
    this.name = options.name;
  }

  static async open(options: PlayerOptions): Promise<PlayerClient> {
    const client = new PlayerClient(options);
    await client.restore();
    options.channel.onMessage((m) => client.receive(m));
    client.hello();
    client.timers.push(setInterval(() => client.tick(), HELLO_MS / 2));
    client.stopClips = onClip((id) => {
      if (id.startsWith(`${client.id}-`)) client.sendClip(id);
    });
    return client;
  }

  get code(): string {
    return this.options.code;
  }

  /** The TV's clock, as best we know it. */
  hostNow(): number {
    return this.now() + this.offset;
  }

  connected(): boolean {
    return this.lastHeard > 0 && this.now() - this.lastHeard < HOST_LOST_MS;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(action: PlayerAction): void {
    const id = `${this.id}:${Date.now().toString(36)}:${this.count++}`;
    this.pending.set(id, action);
    if (action.type === 'rename') this.name = action.name;
    void this.sendAct(id, action);
  }

  /** Actions the TV hasn't confirmed yet (resent every second). */
  hasPending(): boolean {
    return this.pending.size > 0;
  }

  close(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.stopClips();
    this.listeners.clear();
    this.options.channel.close();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private storageKey(): string {
    return `gn:me:${this.options.code}`;
  }

  private async restore(): Promise<void> {
    let saved: SavedPlayer | null;
    try {
      const raw = this.options.storage?.getItem(this.storageKey());
      saved = raw ? (JSON.parse(raw) as SavedPlayer) : null;
    } catch {
      saved = null;
    }
    if (saved?.id) {
      this.id = saved.id;
      if (saved.identity && cryptoAvailable()) {
        try {
          this.identity = await loadIdentity(saved.identity);
          return;
        } catch {
          // Make a new identity below.
        }
      } else if (!cryptoAvailable()) {
        return;
      }
    }
    this.id = randomId();
    let identity: SavedIdentity | null = null;
    if (cryptoAvailable()) {
      const fresh = await newIdentity();
      this.identity = fresh.identity;
      identity = fresh.saved;
    }
    try {
      this.options.storage?.setItem(this.storageKey(), JSON.stringify({ id: this.id, identity }));
    } catch {
      // Private mode: a refresh makes a new player.
    }
  }

  private tick(): void {
    this.hello();
    for (const [id, action] of this.pending) void this.sendAct(id, action);
    this.askForClips();
    this.emit(); // connected() may have changed
  }

  private hello(): void {
    this.options.channel.send({
      t: 'hello',
      from: this.id,
      pub: this.identity?.pub ?? null,
      name: this.name,
      sync: this.room === null || this.status !== 'joined',
    });
  }

  private key(): Promise<CryptoKey> | null {
    if (!this.identity || !this.hostPub) return null;
    this.hostKey ??= sharedKey(this.identity, this.hostPub);
    return this.hostKey;
  }

  private async sendAct(id: string, action: PlayerAction): Promise<void> {
    const keyed = this.key();
    if (this.identity && !keyed) return; // no TV heard yet: sent on the next tick
    const content = { id, action };
    const box = keyed ? await seal(await keyed, content) : { plain: content };
    this.options.channel.send({ t: 'act', from: this.id, box });
  }

  private receive(message: GnMessage): void {
    switch (message.t) {
      case 'state':
        this.queue = this.queue.then(() => this.onState(message)).catch(() => undefined);
        return;
      case 'need':
        if (message.from === 'host') for (const id of message.ids) if (hasClip(id)) this.sendClip(id);
        return;
      case 'clip': {
        if (hasClip(message.id)) return;
        const data = this.assembler.add(message);
        if (data !== null) {
          putClip(message.id, decode(data));
          this.emit();
        }
        return;
      }
      default:
        return;
    }
  }

  private async onState(message: Extract<GnMessage, { t: 'state' }>): Promise<void> {
    if (message.host !== this.hostPub) {
      // A new TV identity (the room was made again): keys start over, and so does the order.
      this.hostPub = message.host;
      this.hostKey = null;
    }
    this.lastHeard = this.now();
    this.offset = message.now - this.now();
    this.room = message.room;
    const box = message.priv[this.id];
    let slot: PrivateSlot | null = null;
    if (box) {
      const keyed = this.key();
      if (keyed && 'iv' in box) slot = (await unseal(await keyed, box)) as PrivateSlot | null;
      else if (!keyed && 'plain' in box) slot = box.plain as PrivateSlot;
    }
    this.slot = slot;
    for (const id of slot?.acked ?? []) this.pending.delete(id);
    const inRoom = message.room.players.some((p) => p.id === this.id);
    this.status = message.room.kicked.includes(this.id)
      ? 'kicked'
      : inRoom
        ? 'joined'
        : message.room.players.length >= MAX_PLAYERS
          ? 'full'
          : 'connecting';
    if (this.status !== 'joined' && this.status !== 'kicked') this.hello();
    this.askForClips();
    this.emit();
  }

  private sendClip(id: string): void {
    const samples = getClip(id);
    if (!samples) return;
    for (const part of splitClip(this.id, id, encode(samples))) this.options.channel.send(part);
  }

  private askForClips(): void {
    const now = this.now();
    const ids = (this.slot?.clips ?? []).filter(
      (id) => !hasClip(id) && now - (this.asked.get(id) ?? -Infinity) > NEED_RETRY_MS,
    );
    if (!ids.length) return;
    for (const id of ids) this.asked.set(id, now);
    this.options.channel.send({ t: 'need', from: this.id, ids });
  }
}
