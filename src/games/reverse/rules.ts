import { judge } from '../../game/match';
import { asInt, asRecord, secs, type Ctx, type GameModule, type Player, type PlayerId, type Timed } from '../../platform/module';
import { shuffle } from '../../platform/rng';
import { addPoints } from '../../platform/scores';
import { cleanText } from '../../platform/text';

/**
 * Party Reverse: Esrever for any number of players. Everyone records secret words; each round
 * every player is dealt someone else's word, hears it backwards on their phone, copies it,
 * hears the copy flipped and guesses. The TV reveals every attempt at once.
 */

export const WORD_MAX = 24;
const REVEAL_BASE_MS = secs(8);
const REVEAL_PER_ATTEMPT_MS = secs(4);

export interface ReverseSettings {
  words: number;
  recordSecs: number;
  guessSecs: number;
  [key: string]: string | number;
}

export interface Word {
  owner: PlayerId;
  text: string;
  clip: string;
}

export interface Attempt {
  guesser: PlayerId;
  /** Index into `words`. */
  word: number;
  mimic: string | null;
  guess: string | null;
  correct: boolean;
  /** The word's owner accepted a near miss. */
  counted: boolean;
}

export type ReversePhase = 'record' | 'guess' | 'reveal' | 'done';

export interface ReverseState extends Timed {
  phase: ReversePhase;
  round: number;
  rounds: number;
  players: Player[];
  settings: ReverseSettings;
  words: Word[];
  locked: PlayerId[];
  /** Word indices already dealt. */
  dealt: number[];
  attempts: Attempt[];
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
}

const validClip = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{3,60}$/.test(v);
export const scoredAttempt = (a: Attempt) => a.correct || a.counted;

/** Deals each player an unused word that isn't theirs, spreading owners where it can. */
export function dealWords(s: ReverseState, ctx: Ctx): Attempt[] {
  const used = new Set(s.dealt);
  const ownersThisRound = new Map<PlayerId, number>();
  const attempts: Attempt[] = [];
  for (const p of shuffle(s.players, ctx.rng)) {
    const candidates = s.words.map((w, i) => ({ w, i })).filter(({ w, i }) => !used.has(i) && w.owner !== p.id);
    if (!candidates.length) continue;
    const least = Math.min(...candidates.map(({ w }) => ownersThisRound.get(w.owner) ?? 0));
    const best = candidates.filter(({ w }) => (ownersThisRound.get(w.owner) ?? 0) === least);
    const choice = best[Math.floor(ctx.rng() * best.length)]!;
    used.add(choice.i);
    ownersThisRound.set(choice.w.owner, least + 1);
    attempts.push({ guesser: p.id, word: choice.i, mimic: null, guess: null, correct: false, counted: false });
  }
  return attempts;
}

function startRound(s: ReverseState, ctx: Ctx): ReverseState {
  if (s.round >= s.rounds) return { ...s, phase: 'done', deadline: null, attempts: [] };
  const attempts = dealWords(s, ctx);
  if (!attempts.length) return { ...s, phase: 'done', deadline: null, attempts: [] };
  return {
    ...s,
    phase: 'guess',
    deadline: ctx.now + secs(s.settings.guessSecs),
    attempts,
    dealt: [...s.dealt, ...attempts.map((a) => a.word)],
    gained: {},
  };
}

function reveal(s: ReverseState, ctx: Ctx): ReverseState {
  const scores = { ...s.scores };
  const gained: Record<PlayerId, number> = {};
  for (const a of s.attempts) {
    if (a.correct) {
      addPoints(scores, a.guesser, 1);
      addPoints(gained, a.guesser, 1);
    }
  }
  return {
    ...s,
    scores,
    gained,
    phase: 'reveal',
    deadline: ctx.now + REVEAL_BASE_MS + REVEAL_PER_ATTEMPT_MS * s.attempts.length,
  };
}

function next(s: ReverseState, ctx: Ctx): ReverseState {
  switch (s.phase) {
    case 'record':
      return startRound({ ...s, round: 0 }, ctx);
    case 'guess':
      return reveal(s, ctx);
    case 'reveal':
      return startRound({ ...s, round: s.round + 1 }, ctx);
    case 'done':
      return s;
  }
}

export const reverse: GameModule<ReverseState, ReverseSettings> = {
  id: 'reverse',
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'words', label: 'Words each (rounds)', options: [2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })) },
    { key: 'recordSecs', label: 'Recording time', options: [90, 120, 180].map((n) => ({ value: n, label: `${n}s` })) },
    { key: 'guessSecs', label: 'Guess time', options: [60, 90, 120].map((n) => ({ value: n, label: `${n}s` })) },
  ],
  defaults: { words: 3, recordSecs: 120, guessSecs: 90 },

  init(players, settings, ctx) {
    const rounds = Math.max(1, Math.min(5, Number(settings.words) || 3));
    return {
      phase: 'record',
      deadline: ctx.now + secs(Number(settings.recordSecs) || 120),
      round: 0,
      rounds,
      players,
      settings: { words: rounds, recordSecs: Number(settings.recordSecs), guessSecs: Number(settings.guessSecs) },
      words: [],
      locked: [],
      dealt: [],
      attempts: [],
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      gained: {},
    };
  },

  act(s, from, raw, ctx) {
    const action = asRecord(raw);
    if (!s.players.some((p) => p.id === from)) return s;
    if (action.type === 'lockIn' && s.phase === 'record') {
      if (s.locked.includes(from) || !Array.isArray(action.words) || action.words.length !== s.rounds) return s;
      const words: Word[] = [];
      for (const raw2 of action.words) {
        const w = asRecord(raw2);
        const text = cleanText(w.text, WORD_MAX);
        if (!text || !validClip(w.clip)) return s;
        words.push({ owner: from, text, clip: w.clip });
      }
      if (new Set(words.map((w) => w.text.toLowerCase())).size !== words.length) return s;
      const next1 = { ...s, words: [...s.words, ...words], locked: [...s.locked, from] };
      return next1.locked.length === s.players.length ? next(next1, ctx) : next1;
    }
    const mine = s.attempts.findIndex((a) => a.guesser === from);
    const attempt = s.attempts[mine];
    if (action.type === 'mimic' && s.phase === 'guess') {
      if (!attempt || attempt.guess !== null || !validClip(action.clip)) return s;
      return { ...s, attempts: s.attempts.map((a, i) => (i === mine ? { ...a, mimic: action.clip as string } : a)) };
    }
    if (action.type === 'guess' && s.phase === 'guess') {
      const text = cleanText(action.text, WORD_MAX);
      if (!attempt || attempt.guess !== null || !text) return s;
      const correct = judge(text, s.words[attempt.word]!.text) === 'correct';
      const attempts = s.attempts.map((a, i) => (i === mine ? { ...a, guess: text, correct } : a));
      const next1 = { ...s, attempts };
      return attempts.every((a) => a.guess !== null) ? next(next1, ctx) : next1;
    }
    if (action.type === 'countIt' && s.phase === 'reveal') {
      const index = asInt(action.attempt);
      const a = index === null ? undefined : s.attempts[index];
      if (!a || scoredAttempt(a) || a.guess === null || s.words[a.word]!.owner !== from) return s;
      const scores = { ...s.scores };
      const gained = { ...s.gained };
      addPoints(scores, a.guesser, 1);
      addPoints(gained, a.guesser, 1);
      return { ...s, scores, gained, attempts: s.attempts.map((x, i) => (i === index ? { ...x, counted: true } : x)) };
    }
    return s;
  },

  advance: (s, ctx) => next(s, ctx),

  view(s) {
    const revealed = s.phase === 'reveal';
    return {
      phase: s.phase,
      deadline: s.deadline,
      round: s.round,
      rounds: s.rounds,
      locked: s.locked,
      attempts: s.attempts.map((a) => {
        const word = s.words[a.word]!;
        return {
          guesser: a.guesser,
          owner: word.owner,
          done: a.guess !== null,
          copied: a.mimic !== null,
          word: revealed ? word.text : null,
          wordClip: revealed ? word.clip : null,
          guess: revealed ? a.guess : null,
          mimic: revealed ? a.mimic : null,
          correct: revealed ? a.correct : null,
          counted: revealed ? a.counted : null,
        };
      }),
      waiting:
        s.phase === 'record'
          ? s.players.filter((p) => !s.locked.includes(p.id)).map((p) => p.id)
          : s.phase === 'guess'
            ? s.attempts.filter((a) => a.guess === null).map((a) => a.guesser)
            : [],
      scores: s.scores,
      gained: s.gained,
    };
  },

  privateView(s, id) {
    const index = s.attempts.findIndex((a) => a.guesser === id);
    const a = s.attempts[index];
    return {
      words: s.rounds,
      locked: s.locked.includes(id),
      attempt:
        a && s.phase === 'guess'
          ? { clip: s.words[a.word]!.clip, owner: s.words[a.word]!.owner, mimic: a.mimic, guess: a.guess }
          : null,
      /** Reveal: attempts at this player's words they may "Count it" for. */
      canCount:
        s.phase === 'reveal'
          ? s.attempts
              .map((x, i) => ({ x, i }))
              .filter(({ x }) => s.words[x.word]!.owner === id && !scoredAttempt(x) && x.guess !== null)
              .map(({ x, i }) => ({ attempt: i, guess: x.guess, word: s.words[x.word]!.text, guesser: x.guesser }))
          : [],
    };
  },

  scores: (s) => s.scores,
  done: (s) => s.phase === 'done',
  used: () => [],
  playerClips(s, id) {
    if (s.phase !== 'guess') return [];
    const a = s.attempts.find((x) => x.guesser === id);
    return a ? [s.words[a.word]!.clip] : [];
  },
  clips(s) {
    return [...s.words.map((w) => w.clip), ...s.attempts.flatMap((a) => (a.mimic ? [a.mimic] : []))];
  },
};
