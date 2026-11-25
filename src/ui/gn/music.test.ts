import { describe, expect, it } from 'vitest';
import type { PublicRoom } from '../../net/gnProtocol';
import type { GameId } from '../../platform/module';
import { sceneFor } from './music';

const room = (
  id: GameId | null,
  phase = '',
  extra: Partial<NonNullable<PublicRoom['game']>> = {},
): PublicRoom => ({
  code: 'ABCD',
  players: [],
  kicked: [],
  selected: 'quip',
  game: id ? { id, players: [], over: false, paused: false, view: { phase }, ...extra } : null,
  result: null,
  wins: {},
});

describe('music scenes', () => {
  it('plays the lobby track between games and on the results screen', () => {
    expect(sceneFor(room(null)).track).toBe('lobby');
    expect(sceneFor(room('quip', 'done', { over: true })).track).toBe('lobby');
  });

  it('matches each kind of phase in every game', () => {
    expect(sceneFor(room('quip', 'answer')).track).toBe('thinking');
    expect(sceneFor(room('bluff', 'lie')).track).toBe('thinking');
    expect(sceneFor(room('oddone', 'clue')).track).toBe('thinking');
    expect(sceneFor(room('sketch', 'draw')).track).toBe('drawing');
    expect(sceneFor(room('doodle', 'draw')).track).toBe('drawing');
    expect(sceneFor(room('quip', 'vote')).track).toBe('voting');
    expect(sceneFor(room('bluff', 'pick')).track).toBe('voting');
    expect(sceneFor(room('quip', 'result')).track).toBe('lobby');
    expect(sceneFor(room('doodle', 'show')).track).toBe('lobby');
  });

  it('only ticks in timed phases, and keeps quiet under Reverse’s recordings and while paused', () => {
    expect(sceneFor(room('quip', 'answer')).timed).toBe(true);
    expect(sceneFor(room('quip', 'result')).timed).toBe(false);
    expect(sceneFor(room('reverse', 'guess')).level).toBeLessThan(0.5);
    expect(sceneFor(room('quip', 'answer', { paused: true }))).toMatchObject({ level: 0.3, timed: false });
  });
});
