import { judge } from './match';

/** Words each player records, and so the number of rounds. */
export const ROUNDS = 5;

export type Seat = 0 | 1;
export type Mode = 'local' | 'online';

/** A secret word: what the player typed and the id of their recording of it. */
export interface WordEntry {
  text: string;
  clip: string;
}

export interface Guess {
  round: number;
  guesser: Seat;
  /** The guesser's copy of the reversed word (a clip id), if they recorded one. */
  mimic: string | null;
  text: string;
  /** Matched automatically (see `match.ts`). */
  correct: boolean;
  /** The word's owner accepted a near miss. */
  counted: boolean;
}

export interface GameState {
  mode: Mode;
  /** lobby (online only: waiting for a friend) → lockin → play → done. */
  phase: 'lobby' | 'lockin' | 'play' | 'done';
  names: [string, string];
  /** Each player's locked-in words; null until they lock in. */
  words: [WordEntry[] | null, WordEntry[] | null];
  /** 0-based round. */
  round: number;
  /** Who is guessing right now. */
  turn: Seat;
  /** The current guesser's latest copy (clip id). */
  mimic: string | null;
  /** The current turn has a guess and is showing its result. */
  revealed: boolean;
  guesses: Guess[];
}

export type Action =
  | { type: 'join'; name: string }
  | { type: 'rename'; seat: Seat; name: string }
  | { type: 'start' }
  | { type: 'lockIn'; seat: Seat; words: WordEntry[] }
  | { type: 'mimic'; seat: Seat; clip: string }
  | { type: 'guess'; seat: Seat; text: string }
  /** The word's owner accepts guess number `guess` (index into `guesses`). */
  | { type: 'countIt'; seat: Seat; guess: number }
  /** Moves on from the result of guess number `guess` (so a double tap can't skip a turn). */
  | { type: 'next'; guess: number }
  | { type: 'rematch' };

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

export function newGame(mode: Mode, names: [string, string]): GameState {
  return {
    mode,
    phase: mode === 'online' ? 'lobby' : 'lockin',
    names,
    words: [null, null],
    round: 0,
    turn: 0,
    mimic: null,
    revealed: false,
    guesses: [],
  };
}

export const cleanName = (name: string, seat: Seat): string =>
  name.trim().slice(0, 16) || `Player ${seat + 1}`;

/** The word the current guesser is trying to work out. */
export function currentWord(state: GameState): WordEntry | null {
  return state.words[other(state.turn)]?.[state.round] ?? null;
}

export function lastGuess(state: GameState): Guess | null {
  return state.guesses[state.guesses.length - 1] ?? null;
}

export const scored = (guess: Guess): boolean => guess.correct || guess.counted;

export function scores(state: GameState): [number, number] {
  const result: [number, number] = [0, 0];
  for (const guess of state.guesses) if (scored(guess)) result[guess.guesser] += 1;
  return result;
}

/** The winning seat, or 'tie'. Only meaningful once the game is done. */
export function winner(state: GameState): Seat | 'tie' {
  const [a, b] = scores(state);
  return a === b ? 'tie' : a > b ? 0 : 1;
}

function validWords(words: WordEntry[]): boolean {
  return (
    words.length === ROUNDS &&
    words.every((word) => typeof word.text === 'string' && word.text.trim() !== '' && word.clip !== '')
  );
}

/**
 * The game rules. Pure: returns the same state object when an action doesn't apply (wrong
 * phase, wrong player, a stale double tap), so callers can tell nothing changed.
 */
export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'join':
      if (state.mode !== 'online') return state;
      return { ...state, names: [state.names[0], cleanName(action.name, 1)] };

    case 'rename': {
      const names: [string, string] = [...state.names];
      names[action.seat] = cleanName(action.name, action.seat);
      return { ...state, names };
    }

    case 'start':
      if (state.phase !== 'lobby') return state;
      return { ...state, phase: 'lockin' };

    case 'lockIn': {
      if (state.phase !== 'lockin' || state.words[action.seat] || !validWords(action.words)) return state;
      const words: GameState['words'] = [...state.words];
      words[action.seat] = action.words.map((word) => ({ text: word.text.trim(), clip: word.clip }));
      const ready = words[0] !== null && words[1] !== null;
      return { ...state, words, phase: ready ? 'play' : 'lockin' };
    }

    case 'mimic':
      if (state.phase !== 'play' || state.revealed || action.seat !== state.turn) return state;
      return { ...state, mimic: action.clip };

    case 'guess': {
      const word = currentWord(state);
      if (state.phase !== 'play' || state.revealed || action.seat !== state.turn || !word) return state;
      const text = action.text.trim();
      if (!text) return state;
      const guess: Guess = {
        round: state.round,
        guesser: state.turn,
        mimic: state.mimic,
        text,
        correct: judge(text, word.text) === 'correct',
        counted: false,
      };
      return { ...state, revealed: true, guesses: [...state.guesses, guess] };
    }

    case 'countIt': {
      const guess = state.guesses[action.guess];
      if (!guess || scored(guess) || action.seat !== other(guess.guesser)) return state;
      const guesses = state.guesses.map((g, i) => (i === action.guess ? { ...g, counted: true } : g));
      return { ...state, guesses };
    }

    case 'next': {
      if (state.phase !== 'play' || !state.revealed || action.guess !== state.guesses.length - 1)
        return state;
      // Player 1 then player 2 each round.
      const lastInRound = state.turn === 1;
      const done = lastInRound && state.round === ROUNDS - 1;
      return {
        ...state,
        phase: done ? 'done' : 'play',
        round: lastInRound && !done ? state.round + 1 : state.round,
        turn: done ? state.turn : other(state.turn),
        mimic: null,
        revealed: done,
      };
    }

    case 'rematch':
      if (state.phase !== 'done') return state;
      return { ...newGame(state.mode, state.names), phase: 'lockin' };
  }
}

/** Every clip id the state refers to (so an online player can fetch the ones it lacks). */
export function clipIds(state: GameState): string[] {
  const ids = new Set<string>();
  for (const words of state.words) for (const word of words ?? []) ids.add(word.clip);
  for (const guess of state.guesses) if (guess.mimic) ids.add(guess.mimic);
  if (state.mimic) ids.add(state.mimic);
  return [...ids];
}
