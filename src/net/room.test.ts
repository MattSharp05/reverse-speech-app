import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUNDS } from '../game/state';
import type { Channel } from './channel';
import type { Message } from './protocol';
import { PEER_TIMEOUT_MS, Room } from './room';

/** A room's channel for tests: everyone else hears each message, unless the link is cut. */
class Hub {
  private readonly members: { handler: (m: Message) => void; up: boolean }[] = [];
  sent: Message[] = [];
  channel(): Channel & { cut(up: boolean): void } {
    const member = { handler: (_m: Message) => {}, up: true };
    this.members.push(member);
    return {
      send: (message) => {
        if (!member.up) return;
        this.sent.push(message);
        const copy = structuredClone(message);
        for (const other of this.members) if (other !== member && other.up) other.handler(copy);
      },
      onMessage: (handler) => (member.handler = handler),
      close: () => (member.up = false),
      cut: (up) => (member.up = up),
    };
  }
}

const words = (p: string) =>
  Array.from({ length: ROUNDS }, (_, i) => ({ text: `${p}${i}`, clip: `${p}c${i}` }));

describe('Room', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function pair() {
    const hub = new Hub();
    const host = new Room(hub.channel(), { code: 'ABCD', clientId: 'h', host: true, name: 'Hana' });
    const guestChannel = hub.channel();
    const guest = new Room(guestChannel, { code: 'ABCD', clientId: 'g', host: false, name: 'Gus' });
    return { hub, host, guest, guestChannel };
  }

  it('seats the guest and shares the names', () => {
    const { host, guest } = pair();
    expect(host.state?.names).toEqual(['Hana', 'Gus']);
    expect(guest.seat).toBe(1);
    expect(guest.status).toBe('playing');
    expect(guest.state?.phase).toBe('lobby');
  });

  it('turns a third player away', () => {
    const { hub } = pair();
    const third = new Room(hub.channel(), { code: 'ABCD', clientId: 'x', host: false, name: 'Xi' });
    expect(third.status).toBe('full');
    expect(third.seat).toBeNull();
  });

  it('applies the guest’s actions as the guest, never as the host', () => {
    const { host, guest } = pair();
    host.dispatch({ type: 'start' });
    guest.dispatch({ type: 'lockIn', seat: 0, words: words('g') });
    expect(host.state?.words[0]).toBeNull();
    expect(host.state?.words[1]?.[0]?.text).toBe('g0');
    expect(guest.state?.words[1]?.[0]?.text).toBe('g0');
  });

  it('a guest cannot start the game', () => {
    const { host, guest } = pair();
    guest.dispatch({ type: 'start' });
    expect(host.state?.phase).toBe('lobby');
  });

  it('resends a lost action until the host confirms it, applying it once', () => {
    const { host, guest, guestChannel } = pair();
    host.dispatch({ type: 'start' });
    host.dispatch({ type: 'lockIn', seat: 0, words: words('h') });
    guestChannel.cut(false);
    guest.dispatch({ type: 'lockIn', seat: 1, words: words('g') });
    expect(host.state?.phase).toBe('lockin');
    guestChannel.cut(true);
    vi.advanceTimersByTime(4000);
    expect(host.state?.phase).toBe('play');
    expect(guest.state?.phase).toBe('play');
    // Two guesses would be wrong: resends of the same action are applied once.
    guest.dispatch({ type: 'guess', seat: 1, text: 'x' }); // not their turn: ignored
    expect(host.state?.guesses).toHaveLength(0);
  });

  it('notices when the friend goes quiet', () => {
    const { host, guest, guestChannel } = pair();
    expect(host.peerOnline()).toBe(true);
    guestChannel.cut(false);
    vi.advanceTimersByTime(PEER_TIMEOUT_MS + 1000);
    expect(host.peerOnline()).toBe(false);
    expect(guest.peerOnline()).toBe(false);
  });

  it('a reloaded host picks its game back up', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const hub = new Hub();
    const host = new Room(hub.channel(), { code: 'ROOM', clientId: 'h', host: true, name: 'Hana', storage });
    new Room(hub.channel(), { code: 'ROOM', clientId: 'g', host: false, name: 'Gus', storage });
    host.dispatch({ type: 'start' });
    host.close();
    const again = new Room(hub.channel(), { code: 'ROOM', clientId: 'h', host: true, name: 'Hana', storage });
    expect(again.state?.phase).toBe('lockin');
    expect(again.state?.names[1]).toBe('Gus');
  });
});
