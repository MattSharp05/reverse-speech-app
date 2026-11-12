import { describe, expect, it } from 'vitest';
import {
  clipIds,
  newGame,
  reduce,
  ROUNDS,
  scores,
  winner,
  type Action,
  type GameState,
  type Seat,
} from './state';

const words = (prefix: string) =>
  Array.from({ length: ROUNDS }, (_, i) => ({ text: `${prefix}${i}`, clip: `${prefix}-clip-${i}` }));

function lockedGame(): GameState {
  let s = newGame('local', ['Ana', 'Ben']);
  s = reduce(s, { type: 'lockIn', seat: 0, words: words('a') });
  s = reduce(s, { type: 'lockIn', seat: 1, words: words('b') });
  return s;
}

/** Plays one turn: the guesser records a copy, guesses, and the game moves on. */
function turn(s: GameState, guess: (answer: string) => string): GameState {
  const seat = s.turn;
  const answer = s.words[seat === 0 ? 1 : 0]![s.round]!.text;
  s = reduce(s, { type: 'mimic', seat, clip: `m-${s.guesses.length}` });
  s = reduce(s, { type: 'guess', seat, text: guess(answer) });
  return reduce(s, { type: 'next', guess: s.guesses.length - 1 });
}

describe('game flow', () => {
  it('starts local games at lock-in and online games in the lobby', () => {
    expect(newGame('local', ['a', 'b']).phase).toBe('lockin');
    const online = newGame('online', ['Host', 'Player 2']);
    expect(online.phase).toBe('lobby');
    const joined = reduce(online, { type: 'join', name: '  Guest  ' });
    expect(joined.names).toEqual(['Host', 'Guest']);
    expect(reduce(joined, { type: 'start' }).phase).toBe('lockin');
  });

  it('needs all five words with recordings to lock in', () => {
    const s = newGame('local', ['a', 'b']);
    expect(reduce(s, { type: 'lockIn', seat: 0, words: words('a').slice(1) })).toBe(s);
    const blank = words('a').map((w, i) => (i === 2 ? { ...w, text: ' ' } : w));
    expect(reduce(s, { type: 'lockIn', seat: 0, words: blank })).toBe(s);
    const noClip = words('a').map((w, i) => (i === 2 ? { ...w, clip: '' } : w));
    expect(reduce(s, { type: 'lockIn', seat: 0, words: noClip })).toBe(s);
  });

  it('plays when both have locked in, and words cannot be changed after', () => {
    let s = newGame('local', ['a', 'b']);
    s = reduce(s, { type: 'lockIn', seat: 0, words: words('a') });
    expect(s.phase).toBe('lockin');
    expect(reduce(s, { type: 'lockIn', seat: 0, words: words('z') })).toBe(s);
    s = reduce(s, { type: 'lockIn', seat: 1, words: words('b') });
    expect(s.phase).toBe('play');
    expect(s.turn).toBe(0);
  });

  it('player 1 guesses player 2’s word first', () => {
    const s = lockedGame();
    const after = reduce(s, { type: 'guess', seat: 0, text: 'b0' });
    expect(after.guesses[0]).toMatchObject({ guesser: 0, round: 0, text: 'b0', correct: true });
    expect(after.revealed).toBe(true);
  });

  it('ignores the other player acting out of turn', () => {
    const s = lockedGame();
    expect(reduce(s, { type: 'guess', seat: 1, text: 'a0' })).toBe(s);
    expect(reduce(s, { type: 'mimic', seat: 1, clip: 'x' })).toBe(s);
  });

  it('remembers the copy with the guess', () => {
    let s = lockedGame();
    s = reduce(s, { type: 'mimic', seat: 0, clip: 'copy1' });
    s = reduce(s, { type: 'mimic', seat: 0, clip: 'copy2' });
    s = reduce(s, { type: 'guess', seat: 0, text: 'nope' });
    expect(s.guesses[0]!.mimic).toBe('copy2');
    expect(reduce(s, { type: 'mimic', seat: 0, clip: 'late' })).toBe(s);
  });

  it('a double tap on next cannot skip a turn', () => {
    let s = lockedGame();
    s = reduce(s, { type: 'guess', seat: 0, text: 'x' });
    s = reduce(s, { type: 'next', guess: 0 });
    expect(s.turn).toBe(1);
    expect(reduce(s, { type: 'next', guess: 0 })).toBe(s);
  });

  it('runs five rounds, each player once a round, then finishes', () => {
    let s = lockedGame();
    const order: [number, Seat][] = [];
    for (let i = 0; i < ROUNDS * 2; i++) {
      order.push([s.round, s.turn]);
      s = turn(s, (answer) => (s.turn === 0 ? answer : 'wrong'));
    }
    expect(order.slice(0, 4)).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    expect(s.phase).toBe('done');
    expect(scores(s)).toEqual([5, 0]);
    expect(winner(s)).toBe(0);
  });

  it('lets only the word’s owner count a miss, once', () => {
    let s = lockedGame();
    s = reduce(s, { type: 'guess', seat: 0, text: 'b' });
    expect(s.guesses[0]!.correct).toBe(false);
    expect(reduce(s, { type: 'countIt', seat: 0, guess: 0 })).toBe(s);
    s = reduce(s, { type: 'countIt', seat: 1, guess: 0 });
    expect(scores(s)).toEqual([1, 0]);
    expect(reduce(s, { type: 'countIt', seat: 1, guess: 0 })).toBe(s);
  });

  it('calls a tie and rematches with the same names', () => {
    let s = lockedGame();
    for (let i = 0; i < ROUNDS * 2; i++) s = turn(s, () => 'miss');
    expect(winner(s)).toBe('tie');
    const again = reduce(s, { type: 'rematch' });
    expect(again).toMatchObject({ phase: 'lockin', names: ['Ana', 'Ben'], guesses: [], words: [null, null] });
  });

  it('lists every clip it refers to', () => {
    let s = lockedGame();
    s = reduce(s, { type: 'mimic', seat: 0, clip: 'copy' });
    const ids = clipIds(s);
    expect(ids).toContain('a-clip-0');
    expect(ids).toContain('b-clip-4');
    expect(ids).toContain('copy');
    expect(ids).toHaveLength(ROUNDS * 2 + 1);
  });

  it('ignores actions in the wrong phase', () => {
    const s = newGame('local', ['a', 'b']);
    const actions: Action[] = [
      { type: 'start' },
      { type: 'guess', seat: 0, text: 'x' },
      { type: 'next', guess: 0 },
      { type: 'rematch' },
    ];
    for (const action of actions) expect(reduce(s, action)).toBe(s);
  });
});
