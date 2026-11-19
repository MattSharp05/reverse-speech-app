import { getClip, hasClip, putClip } from '../audio/clips';
import { decode, encode } from '../audio/pcm';
import type { ContentLibrary } from '../content/schema';
import { modules as allModules } from '../games/registry';
import type { Ctx, PlayerId } from '../platform/module';
import {
  newRoom,
  PLAYER_ACTIONS,
  reduceRoom,
  type Modules,
  type RoomAction,
  type RoomState,
} from '../platform/room';
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
import type { Box, GnMessage, PrivateSlot, PublicRoom } from './gnProtocol';
import { ClipAssembler, splitClip } from './protocol';

/** Timers are checked this often, ms. */
export const TICK_MS = 250;
/** The TV repeats its state this often, so phones that missed one catch up, ms. */
export const HEARTBEAT_MS = 2000;
/** A phone counts as away after this long without a word, ms. */
export const AWAY_MS = 7000;
/** Action ids remembered per player, so a resent action isn't applied twice. */
const ACKED_KEPT = 30;
const NEED_RETRY_MS = 2500;

export interface HostOptions {
  code: string;
  channel: Channel<GnMessage>;
  content: ContentLibrary;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
  rng?: () => number;
  modules?: Modules;
  /** A game ended: its content ids, to avoid next time. */
  onGameOver?: (used: string[]) => void;
}

interface Member {
  pub: string | null;
  key: CryptoKey | null;
  lastSeen: number;
  acked: string[];
  /** Messages from this phone are handled one after another. */
  queue: Promise<void>;
}

interface HostSave {
  room: RoomState;
  identity: SavedIdentity | null;
  members: Record<PlayerId, { pub: string | null; acked: string[] }>;
}

/**
 * The TV's end of a Game Night room: the authority. It applies every action with the room's
 * and games' rules (phones only ever send requests), runs the timers, and sends everyone the
 * public room plus each player's sealed private view.
 */
export class HostRoom {
  room: RoomState;
  private identity: Identity | null = null;
  private readonly members = new Map<PlayerId, Member>();
  private readonly listeners = new Set<() => void>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly assembler = new ClipAssembler();
  private readonly asked = new Map<string, number>();
  private readonly now: () => number;
  private readonly modules: Modules;
  private rev = 0;
  private sending = false;
  private sendAgain = false;
  private lastSent = 0;
  private closed = false;

  private constructor(private readonly options: HostOptions) {
    this.now = options.now ?? Date.now;
    this.modules = options.modules ?? allModules;
    this.room = newRoom(options.code);
  }

  static async open(options: HostOptions): Promise<HostRoom> {
    const host = new HostRoom(options);
    await host.restore();
    options.channel.onMessage((message) => host.receive(message));
    host.timers.push(setInterval(() => host.tick(), TICK_MS));
    host.broadcast();
    return host;
  }

  get code(): string {
    return this.options.code;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The TV's own actions (host controls). */
  dispatch(action: RoomAction): void {
    this.apply(action);
  }

  online(id: PlayerId): boolean {
    const m = this.members.get(id);
    return m !== undefined && this.now() - m.lastSeen < AWAY_MS;
  }

  publicRoom(): PublicRoom {
    const r = this.room;
    const game = r.game;
    return {
      code: r.code,
      players: r.players.map((p) => ({ ...p, online: this.online(p.id) })),
      kicked: r.kicked,
      selected: r.selected,
      game: game
        ? {
            id: game.id,
            players: game.players,
            over: game.over,
            paused: r.paused !== null,
            view: this.modules[game.id].view(game.state),
          }
        : null,
      result: r.result,
      wins: r.wins,
    };
  }

  /** What one player sees privately (also used by tests). */
  privateSlot(id: PlayerId): PrivateSlot {
    const game = this.room.game;
    const module = game ? this.modules[game.id] : null;
    const playing = game && module && game.players.includes(id) && !game.over;
    return {
      acked: this.members.get(id)?.acked ?? [],
      view: playing ? module.privateView(game.state, id) : null,
      clips: playing ? (module.playerClips?.(game.state, id) ?? []) : [],
    };
  }

  close(): void {
    this.closed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.listeners.clear();
    this.options.channel.close();
  }

  private ctx(): Ctx {
    return { now: this.now(), rng: this.options.rng ?? Math.random, content: this.options.content };
  }

  private apply(action: RoomAction): void {
    const before = this.room;
    const next = reduceRoom(before, action, this.modules, this.ctx());
    if (next === before) return;
    this.room = next;
    if (next.result && next.result !== before.result && next.game) {
      this.options.onGameOver?.(this.modules[next.game.id].used(next.game.state));
    }
    this.changed();
  }

  private changed(): void {
    this.save();
    this.broadcast();
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private tick(): void {
    if (this.closed) return;
    this.apply({ type: 'tick' });
    if (this.now() - this.lastSent >= HEARTBEAT_MS) this.broadcast();
    this.askForClips();
    this.emit(); // online dots and countdowns
  }

  private member(id: PlayerId): Member | undefined {
    return this.members.get(id);
  }

  private receive(message: GnMessage): void {
    if (this.closed) return;
    switch (message.t) {
      case 'hello':
        return this.enqueue(message.from, () =>
          this.hello(message.from, message.pub, message.name, message.sync === true),
        );
      case 'act':
        return this.enqueue(message.from, () => this.act(message.from, message.box));
      case 'need':
        for (const id of message.ids) if (hasClip(id)) this.sendClip(id);
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
      case 'state':
        return;
    }
  }

  private enqueue(id: PlayerId, work: () => Promise<void>): void {
    if (typeof id !== 'string' || id.length > 40) return;
    const member = this.members.get(id);
    if (member) member.queue = member.queue.then(work, work);
    else void work();
  }

  private async hello(id: PlayerId, pub: string | null, name: string, sync: boolean): Promise<void> {
    let member = this.member(id);
    if (!member) {
      if (this.room.kicked.includes(id)) return;
      // Sealed rooms only take sealed phones (no one can join as another player in the clear).
      if (this.identity && !pub) return;
      let key: CryptoKey | null = null;
      if (this.identity && pub) {
        try {
          key = await sharedKey(this.identity, pub);
        } catch {
          return;
        }
      }
      if (this.members.has(id)) return; // another hello got there first
      member = { pub, key, lastSeen: this.now(), acked: [], queue: Promise.resolve() };
      this.members.set(id, member);
    } else if (member.pub !== pub) {
      // Someone else using this player's id: ignore them.
      return;
    }
    const wasAway = !this.online(id);
    member.lastSeen = this.now();
    const before = this.room;
    this.apply({ type: 'join', id, name: String(name ?? '') });
    // Someone (re)joining needs the state now, not at the next heartbeat.
    if (this.room === before && (wasAway || sync)) this.broadcast();
    if (this.room === before) this.emit();
  }

  private async act(id: PlayerId, box: Box): Promise<void> {
    const member = this.member(id);
    if (!member) return;
    let content: unknown;
    if (member.key) {
      if (!('iv' in box)) return;
      content = await unseal(member.key, box);
    } else {
      if (!('plain' in box)) return;
      content = box.plain;
    }
    if (typeof content !== 'object' || content === null) return;
    const { id: actionId, action } = content as { id?: unknown; action?: unknown };
    if (typeof actionId !== 'string' || typeof action !== 'object' || action === null) return;
    member.lastSeen = this.now();
    if (member.acked.includes(actionId)) return this.broadcast();
    member.acked = [...member.acked, actionId].slice(-ACKED_KEPT);
    const a = action as { type?: unknown; name?: unknown; action?: unknown };
    if (typeof a.type === 'string' && PLAYER_ACTIONS.has(a.type as RoomAction['type'])) {
      if (a.type === 'rename') this.apply({ type: 'rename', id, name: String(a.name ?? '') });
      if (a.type === 'play') this.apply({ type: 'play', from: id, action: a.action });
    }
    // Acked whether or not it applied, so the phone stops resending.
    this.save();
    this.broadcast();
  }

  /** Sends the state soon (several changes in a row go out as one message). */
  private broadcast(): void {
    if (this.sending) {
      this.sendAgain = true;
      return;
    }
    this.sending = true;
    void this.send().finally(() => {
      this.sending = false;
      if (this.sendAgain && !this.closed) {
        this.sendAgain = false;
        this.broadcast();
      }
    });
  }

  private async send(): Promise<void> {
    if (this.closed) return;
    const priv: Record<PlayerId, Box> = {};
    for (const p of this.room.players) {
      const member = this.member(p.id);
      if (!member) continue;
      const slot = this.privateSlot(p.id);
      priv[p.id] = member.key ? await seal(member.key, slot) : { plain: slot };
    }
    this.lastSent = this.now();
    this.options.channel.send({
      t: 'state',
      from: 'host',
      host: this.identity?.pub ?? null,
      now: this.now(),
      rev: ++this.rev,
      room: this.publicRoom(),
      priv,
    });
  }

  private sendClip(id: string): void {
    const samples = getClip(id);
    if (!samples) return;
    for (const part of splitClip('host', id, encode(samples))) this.options.channel.send(part);
  }

  private askForClips(): void {
    const game = this.room.game;
    const clips = game ? (this.modules[game.id].clips?.(game.state) ?? []) : [];
    const now = this.now();
    const ids = clips.filter((id) => !hasClip(id) && now - (this.asked.get(id) ?? -Infinity) > NEED_RETRY_MS);
    if (!ids.length) return;
    for (const id of ids) this.asked.set(id, now);
    this.options.channel.send({ t: 'need', from: 'host', ids });
  }

  private storageKey(): string {
    return `gn:host:${this.options.code}`;
  }

  private async restore(): Promise<void> {
    let saved: HostSave | null;
    try {
      const raw = this.options.storage?.getItem(this.storageKey());
      saved = raw ? (JSON.parse(raw) as HostSave) : null;
    } catch {
      saved = null;
    }
    if (cryptoAvailable()) {
      if (saved?.identity) {
        try {
          this.identity = await loadIdentity(saved.identity);
          this.savedIdentity = saved.identity;
        } catch {
          saved = null;
        }
      }
      if (!this.identity) {
        const fresh = await newIdentity();
        this.identity = fresh.identity;
        this.savedIdentity = fresh.saved;
        saved = null; // old phones' keys don't match a new identity
      }
    }
    if (!saved) return;
    this.room = saved.room;
    for (const [id, m] of Object.entries(saved.members)) {
      let key: CryptoKey | null = null;
      if (this.identity && m.pub) {
        try {
          key = await sharedKey(this.identity, m.pub);
        } catch {
          continue;
        }
      }
      this.members.set(id, { pub: m.pub, key, lastSeen: 0, acked: m.acked, queue: Promise.resolve() });
    }
  }

  private savedIdentity: SavedIdentity | null = null;

  private save(): void {
    try {
      const members: HostSave['members'] = {};
      for (const [id, m] of this.members) members[id] = { pub: m.pub, acked: m.acked };
      const save: HostSave = { room: this.room, identity: this.savedIdentity, members };
      this.options.storage?.setItem(this.storageKey(), JSON.stringify(save));
    } catch {
      // Storage full or blocked: a reload starts the room over.
    }
  }
}
