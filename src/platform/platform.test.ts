import { describe, expect, it } from 'vitest';
import { deal } from '../content/deal';
import { modules } from '../games/registry';
import { players, testCtx } from '../test/fixtures';
import { newRoom, reduceRoom, type RoomAction, type RoomState } from './room';
import { seeded, shuffle } from './rng';
import { standings, winners } from './scores';
import { normalizeAnswer, sameAnswer } from './text';

const ctx = testCtx();
const run = (room: RoomState, ...actions: RoomAction[]) =>
  actions.reduce((r, a) => reduceRoom(r, a, modules, ctx), room);

function roomWith(n: number): RoomState {
  return run(newRoom('ABCD'), ...players(n).map((p) => ({ type: 'join' as const, id: p.id, name: p.name })));
}

describe('text', () => {
  it('normalizes answers', () => {
    expect(normalizeAnswer('  The  Eiffel-Tower! ')).toBe('eiffel tower');
    expect(normalizeAnswer('Café')).toBe('cafe');
    expect(sameAnswer('A unicorn', 'unicorn')).toBe(true);
    expect(sameAnswer('hot dog', 'hotdog')).toBe(true);
    expect(sameAnswer('elephant', 'elephent')).toBe(true);
    expect(sameAnswer('cat', 'car')).toBe(false);
    expect(sameAnswer('1985', '1986')).toBe(false);
    expect(sameAnswer('', '')).toBe(false);
  });
});

describe('scores', () => {
  it('ranks with ties', () => {
    const rows = standings(players(4), { p0: 5, p1: 9, p2: 5, p3: 0 });
    expect(rows.map((r) => [r.id, r.rank])).toEqual([
      ['p1', 1],
      ['p0', 2],
      ['p2', 2],
      ['p3', 4],
    ]);
    expect(winners(standings(players(2), { p0: 3, p1: 3 }))).toEqual(['p0', 'p1']);
    expect(winners(standings(players(2), {}))).toEqual([]);
  });
});

describe('rng and deal', () => {
  it('is repeatable', () => {
    expect(shuffle([1, 2, 3, 4, 5], seeded(4))).toEqual(shuffle([1, 2, 3, 4, 5], seeded(4)));
  });
  it('deals fresh items before recent ones', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));
    const recent = new Set(['0', '1', '2', '3', '4', '5', '6', '7']);
    const got = deal(items, 3, seeded(1), recent).map((i) => i.id);
    expect(got.slice(0, 2).sort()).toEqual(['8', '9']);
    expect(got).toHaveLength(3);
  });
});

describe('room', () => {
  it('joins players with unique names and colours, refuses kicked ones', () => {
    let room = run(
      newRoom('ABCD'),
      { type: 'join', id: 'a', name: '  Sam  ' },
      { type: 'join', id: 'b', name: 'sam' },
      { type: 'join', id: 'a', name: 'again' },
    );
    expect(room.players.map((p) => [p.name, p.color])).toEqual([
      ['Sam', 0],
      ['sam 2', 1],
    ]);
    room = run(room, { type: 'kick', id: 'a' }, { type: 'join', id: 'a', name: 'Sam' });
    expect(room.players.map((p) => p.id)).toEqual(['b']);
    expect(run(room, { type: 'join', id: 'c', name: 'Cy' }).players[1]!.color).toBe(0);
  });

  it('needs enough players to start', () => {
    const room = run(roomWith(2), { type: 'select', game: 'quip' }, { type: 'start' });
    expect(room.game).toBeNull();
    const started = run(roomWith(3), { type: 'select', game: 'quip' }, { type: 'start' });
    expect(started.game?.id).toBe('quip');
  });

  it('validates settings', () => {
    const room = roomWith(3);
    expect(run(room, { type: 'setting', game: 'quip', key: 'rounds', value: 3 }).settings.quip).toEqual({ rounds: 3 });
    expect(run(room, { type: 'setting', game: 'quip', key: 'rounds', value: 99 })).toBe(room);
    expect(run(room, { type: 'setting', game: 'quip', key: 'nope', value: 1 })).toBe(room);
  });

  it('ignores actions from players outside the game', () => {
    let room = run(roomWith(3), { type: 'select', game: 'bluff' }, { type: 'start' });
    room = run(room, { type: 'join', id: 'late', name: 'Late' });
    const before = room;
    expect(run(room, { type: 'play', from: 'late', action: { type: 'lie', text: 'x' } })).toBe(before);
  });

  it('advances on the timer, not while paused, and shifts the deadline on resume', () => {
    let room = run(roomWith(2), { type: 'select', game: 'bluff' }, { type: 'start' });
    const deadline = room.game!.state.deadline!;
    room = reduceRoom(room, { type: 'pause' }, modules, ctx.at(deadline - 1000));
    expect(reduceRoom(room, { type: 'tick' }, modules, ctx.at(deadline + 5000))).toBe(room);
    room = reduceRoom(room, { type: 'resume' }, modules, ctx.at(deadline + 5000));
    expect(room.game!.state.deadline).toBe(deadline + 6000);
    room = reduceRoom(room, { type: 'tick' }, modules, ctx.at(deadline + 6000));
    expect((room.game!.state as unknown as { phase: string }).phase).toBe('pick');
  });

  it('skips, records results and Game Night wins, then returns to the lobby', () => {
    let room = run(roomWith(2), { type: 'select', game: 'bluff' }, { type: 'setting', game: 'bluff', key: 'questions', value: 4 }, { type: 'start' });
    for (let i = 0; i < 40 && !room.game!.over; i++) room = run(room, { type: 'skip' });
    expect(room.game!.over).toBe(true);
    expect(room.result?.game).toBe('bluff');
    room = run(room, { type: 'lobby' });
    expect(room.game).toBeNull();
    expect(room.players).toHaveLength(2);
    const next = run(room, { type: 'select', game: 'reverse' }, { type: 'start' });
    expect(next.game?.id).toBe('reverse');
  });
});
