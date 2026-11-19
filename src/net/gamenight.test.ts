import { afterEach, describe, expect, it, vi } from 'vitest';
import { testCtx } from '../test/fixtures';
import type { Channel } from './channel';
import type { GnMessage } from './gnProtocol';
import { AWAY_MS, HostRoom } from './host';
import { PlayerClient } from './player';

/** Everyone else hears each message (structured-cloned), unless their link is cut. */
class Hub {
  readonly sent: GnMessage[] = [];
  private readonly members: { handler: (m: GnMessage) => void; up: boolean }[] = [];
  channel(): Channel<GnMessage> & { cut(up: boolean): void } {
    const member = { handler: (_m: GnMessage) => {}, up: true };
    this.members.push(member);
    return {
      send: (message) => {
        if (!member.up) return;
        this.sent.push(message);
        for (const other of this.members)
          if (other !== member && other.up) other.handler(structuredClone(message));
      },
      onMessage: (handler) => (member.handler = handler),
      close: () => (member.up = false),
      cut: (up) => (member.up = up),
    };
  }
}

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
}

/** Lets async crypto (real time: WebCrypto runs off the main thread) and queued messages settle. */
const settle = async () => {
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3));
    await vi.advanceTimersByTimeAsync(5);
  }
};

afterEach(() => vi.useRealTimers());

async function party(names: string[]) {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  const hub = new Hub();
  const ctx = testCtx(2);
  const host = await HostRoom.open({
    code: 'WXYZ',
    channel: hub.channel(),
    content: ctx.content,
    rng: ctx.rng,
    storage: new MemoryStorage(),
  });
  const phones: PlayerClient[] = [];
  const storages: MemoryStorage[] = [];
  for (const name of names) {
    const storage = new MemoryStorage();
    storages.push(storage);
    phones.push(await PlayerClient.open({ code: 'WXYZ', name, channel: hub.channel(), storage }));
  }
  await settle();
  return { hub, host, phones, storages };
}

describe('Game Night networking', () => {
  it('phones join and see the room', async () => {
    const { host, phones } = await party(['Ann', 'Bo', 'Cy']);
    expect(host.room.players.map((p) => p.name)).toEqual(['Ann', 'Bo', 'Cy']);
    for (const phone of phones) {
      expect(phone.status).toBe('joined');
      expect(phone.room?.players).toHaveLength(3);
    }
  });

  it('keeps private views sealed: only their owner can read them', async () => {
    const { hub, host, phones } = await party(['Ann', 'Bo', 'Cy']);
    host.dispatch({ type: 'select', game: 'sketch' });
    host.dispatch({ type: 'start' });
    await settle();
    const prompts = phones.map((p) => (p.slot?.view as { prompt: string }).prompt);
    expect(new Set(prompts).size).toBe(3);
    const wire = JSON.stringify(hub.sent);
    for (const prompt of prompts) expect(wire).not.toContain(prompt);
  });

  it('applies a phone’s action once, though it is resent', async () => {
    const { hub, host, phones } = await party(['Ann', 'Bo']);
    host.dispatch({ type: 'select', game: 'bluff' });
    host.dispatch({ type: 'start' });
    await settle();
    phones[0]!.dispatch({ type: 'play', action: { type: 'lie', text: 'a fib' } });
    await settle();
    // Replay every act the phone sent.
    const acts = hub.sent.filter((m) => m.t === 'act');
    const replay = hub.channel();
    for (const act of acts) replay.send(act);
    await settle();
    const state = host.room.game!.state as unknown as { lies: Record<string, string> };
    expect(state.lies[phones[0]!.id]).toBe('a fib');
    expect(phones[0]!.hasPending()).toBe(false);
  });

  it('ignores someone acting as another player', async () => {
    const { hub, host, phones } = await party(['Ann', 'Bo']);
    host.dispatch({ type: 'select', game: 'bluff' });
    host.dispatch({ type: 'start' });
    await settle();
    const victim = phones[0]!.id;
    const fake = hub.channel();
    fake.send({ t: 'hello', from: victim, pub: null, name: 'Mallory' });
    fake.send({
      t: 'act',
      from: victim,
      box: { plain: { id: 'x', action: { type: 'play', action: { type: 'lie', text: 'evil' } } } },
    });
    fake.send({ t: 'act', from: victim, box: { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' } });
    await settle();
    const state = host.room.game!.state as unknown as { lies: Record<string, string> };
    expect(state.lies[victim]).toBeUndefined();
    expect(host.room.players[0]!.name).toBe('Ann');
  });

  it('a refreshed phone is the same player; a kicked one stays out', async () => {
    const { hub, host, phones, storages } = await party(['Ann', 'Bo']);
    const id = phones[0]!.id;
    phones[0]!.close();
    const again = await PlayerClient.open({
      code: 'WXYZ',
      name: 'Ann',
      channel: hub.channel(),
      storage: storages[0]!,
    });
    await settle();
    expect(again.id).toBe(id);
    expect(again.status).toBe('joined');
    expect(host.room.players).toHaveLength(2);
    host.dispatch({ type: 'kick', id: phones[1]!.id });
    await settle();
    expect(phones[1]!.status).toBe('kicked');
    expect(host.room.players).toHaveLength(1);
  });

  it('shows who is away, and times out phases without them', async () => {
    const { host, phones } = await party(['Ann', 'Bo']);
    host.dispatch({ type: 'select', game: 'bluff' });
    host.dispatch({ type: 'start' });
    phones[1]!.close();
    await vi.advanceTimersByTimeAsync(AWAY_MS + 1000);
    expect(host.publicRoom().players.find((p) => p.name === 'Bo')!.online).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    const phase = (host.room.game!.state as unknown as { phase: string }).phase;
    expect(phase).not.toBe('lie');
  });

  it('the TV picks up its room after a reload', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const hub = new Hub();
    const storage = new MemoryStorage();
    const ctx = testCtx(2);
    const open = () => HostRoom.open({ code: 'WXYZ', channel: hub.channel(), content: ctx.content, storage });
    const host = await open();
    const phone = await PlayerClient.open({
      code: 'WXYZ',
      name: 'Ann',
      channel: hub.channel(),
      storage: new MemoryStorage(),
    });
    await PlayerClient.open({
      code: 'WXYZ',
      name: 'Bo',
      channel: hub.channel(),
      storage: new MemoryStorage(),
    });
    await settle();
    host.close();
    const again = await open();
    await settle();
    expect(again.room.players.map((p) => p.name)).toEqual(['Ann', 'Bo']);
    again.dispatch({ type: 'select', game: 'bluff' });
    again.dispatch({ type: 'start' });
    await settle();
    expect(phone.slot?.view).not.toBeNull();
  });

  it('bots join from the TV and play their moves', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const hub = new Hub();
    const ctx = testCtx(4);
    const host = await HostRoom.open({
      code: 'BOTS',
      channel: hub.channel(),
      content: ctx.content,
      rng: ctx.rng,
      botDelay: [100, 200],
    });
    const phone = await PlayerClient.open({
      code: 'BOTS',
      name: 'Ann',
      channel: hub.channel(),
      storage: new MemoryStorage(),
    });
    await settle();
    host.addBot();
    host.addBot();
    expect(host.room.players.map((p) => [p.name, Boolean(p.bot)])).toEqual([
      ['Ann', false],
      ['Robo Rita', true],
      ['Beep Boop', true],
    ]);
    expect(host.publicRoom().players.every((p) => p.online)).toBe(true);
    host.dispatch({ type: 'select', game: 'bluff' });
    host.dispatch({ type: 'start' });
    await vi.advanceTimersByTimeAsync(1000);
    const state = host.room.game!.state as unknown as { lies: Record<string, string>; phase: string };
    expect(Object.keys(state.lies)).toHaveLength(2);
    expect(state.phase).toBe('lie'); // still waiting for the human
    phone.dispatch({ type: 'play', action: { type: 'lie', text: 'my lie' } });
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect((host.room.game!.state as unknown as { phase: string }).phase).toBe('pick');
  });
});
