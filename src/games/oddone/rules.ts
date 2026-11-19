import { deal, maturityOk } from '../../content/deal';
import type { OddPair } from '../../content/schema';
import {
  asRecord,
  secs,
  type Ctx,
  type GameModule,
  type Player,
  type PlayerId,
  type Timed,
} from '../../platform/module';
import { shuffle } from '../../platform/rng';
import { addPoints } from '../../platform/scores';
import { cleanText, normalizeAnswer, sameAnswer } from '../../platform/text';
import { BOT_ANSWERS, pick } from '../bots';

/**
 * Odd One Out: everyone gets the same secret word except one player, who gets nothing (just the
 * category) or a similar word without knowing it. Each gives a one-line clue, then everyone
 * votes for who's faking. A caught odd one out can still win points by guessing the word.
 */

export const CLUE_MAX = 30;
const GUESS_SECS = 30;
const REVEAL_MS = secs(10);
export const CATCH_POINTS = 500;
export const ESCAPE_POINTS = 1000;
export const GUESS_POINTS = 750;

export interface OddSettings {
  rounds: number;
  clueSecs: number;
  voteSecs: number;
  mode: string;
  maturity: string;
  [key: string]: string | number;
}

export type OddPhase = 'clue' | 'vote' | 'guess' | 'reveal' | 'done';

export interface OddState extends Timed {
  phase: OddPhase;
  round: number;
  players: Player[];
  settings: OddSettings;
  pairs: OddPair[];
  /** The odd one out in each round. */
  odds: PlayerId[];
  clues: Record<PlayerId, string>;
  rejected: Record<PlayerId, 'word' | null>;
  votes: Record<PlayerId, PlayerId>;
  guess: string | null;
  caught: boolean | null;
  guessed: boolean | null;
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
  used: string[];
}

const pair = (s: OddState) => s.pairs[s.round]!;
const oddOf = (s: OddState) => s.odds[s.round]!;
const blank = (s: OddState) => s.settings.mode !== 'similar';
const ids = (s: OddState) => s.players.map((p) => p.id);

/** The word this player was given (null: the odd one out in "no word" mode). */
export function wordFor(s: OddState, id: PlayerId): string | null {
  if (id !== oddOf(s)) return pair(s).word;
  return blank(s) ? null : pair(s).decoy;
}

/** A clue that gives the word away: it contains the word, or is it. */
function givesAway(clue: string, word: string): boolean {
  const c = normalizeAnswer(clue);
  const w = normalizeAnswer(word);
  const padded = ` ${c} `;
  return (
    sameAnswer(clue, word) || (w.length >= 3 && (padded.includes(` ${w} `) || padded.includes(` ${w}s `)))
  );
}

function startRound(s: OddState, ctx: Ctx): OddState {
  if (s.round >= s.pairs.length) return { ...s, round: s.pairs.length - 1, phase: 'done', deadline: null };
  return {
    ...s,
    phase: 'clue',
    deadline: ctx.now + secs(s.settings.clueSecs),
    clues: {},
    rejected: {},
    votes: {},
    guess: null,
    caught: null,
    guessed: null,
    gained: {},
  };
}

function openVote(s: OddState, ctx: Ctx): OddState {
  const clues = { ...s.clues };
  for (const id of ids(s)) clues[id] ??= '…';
  return { ...s, clues, phase: 'vote', deadline: ctx.now + secs(s.settings.voteSecs) };
}

function resolveVotes(s: OddState, ctx: Ctx): OddState {
  const odd = oddOf(s);
  const counts: Record<PlayerId, number> = {};
  for (const target of Object.values(s.votes)) counts[target] = (counts[target] ?? 0) + 1;
  const oddVotes = counts[odd] ?? 0;
  const caught = oddVotes > 0 && Object.values(counts).every((n) => n <= oddVotes);
  const scores = { ...s.scores };
  const gained: Record<PlayerId, number> = {};
  const award = (id: PlayerId, points: number) => {
    addPoints(scores, id, points);
    addPoints(gained, id, points);
  };
  for (const [voter, target] of Object.entries(s.votes)) if (target === odd) award(voter, CATCH_POINTS);
  if (!caught) award(odd, ESCAPE_POINTS);
  const next = { ...s, scores, gained, caught };
  // Caught: the odd one out gets one shot at the word.
  if (caught) return { ...next, phase: 'guess', deadline: ctx.now + secs(GUESS_SECS) };
  return { ...next, phase: 'reveal', deadline: ctx.now + REVEAL_MS };
}

function next(s: OddState, ctx: Ctx): OddState {
  switch (s.phase) {
    case 'clue':
      return openVote(s, ctx);
    case 'vote':
      return resolveVotes(s, ctx);
    case 'guess':
      return { ...s, phase: 'reveal', guessed: false, deadline: ctx.now + REVEAL_MS };
    case 'reveal':
      return startRound({ ...s, round: s.round + 1 }, ctx);
    case 'done':
      return s;
  }
}

export const oddOne: GameModule<OddState, OddSettings> = {
  id: 'oddone',
  minPlayers: 3,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: 'Rounds', options: [3, 4, 5, 6].map((n) => ({ value: n, label: String(n) })) },
    {
      key: 'mode',
      label: 'Odd one gets',
      options: [
        { value: 'blank', label: 'No word (knows it)' },
        { value: 'similar', label: 'A similar word (doesn’t know)' },
      ],
    },
    { key: 'clueSecs', label: 'Clue time', options: [30, 45, 60].map((n) => ({ value: n, label: `${n}s` })) },
    { key: 'voteSecs', label: 'Vote time', options: [20, 30, 45].map((n) => ({ value: n, label: `${n}s` })) },
    {
      key: 'maturity',
      label: 'Content',
      options: [
        { value: 'family', label: 'Family friendly' },
        { value: 'adult', label: 'Anything goes (18+)' },
      ],
    },
  ],
  defaults: { rounds: 4, mode: 'blank', clueSecs: 45, voteSecs: 30, maturity: 'family' },

  init(players, settings, ctx) {
    const rounds = Math.max(1, Math.min(8, Number(settings.rounds) || 4));
    let pairs = deal(ctx.content.oddone, rounds, ctx.rng, ctx.content.recent, (p) =>
      maturityOk(settings.maturity, p),
    );
    if (!pairs.length) {
      pairs = [
        {
          id: 'fallback',
          word: 'pizza',
          decoy: 'flatbread',
          category: 'food',
          maturity: 'family',
          source: 'original',
        },
      ];
    }
    // Everyone gets a turn as the odd one out before anyone gets a second.
    const order = shuffle(
      players.map((p) => p.id),
      ctx.rng,
    );
    const s: OddState = {
      phase: 'clue',
      deadline: null,
      round: 0,
      players,
      settings: { ...settings, clueSecs: Number(settings.clueSecs), voteSecs: Number(settings.voteSecs) },
      pairs,
      odds: pairs.map((_, r) => order[r % order.length]!),
      clues: {},
      rejected: {},
      votes: {},
      guess: null,
      caught: null,
      guessed: null,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      gained: {},
      used: pairs.map((p) => p.id),
    };
    return startRound(s, ctx);
  },

  act(s, from, raw, ctx) {
    const action = asRecord(raw);
    if (!ids(s).includes(from)) return s;
    if (action.type === 'clue' && s.phase === 'clue') {
      if (s.clues[from]) return s;
      const text = cleanText(action.text, CLUE_MAX);
      if (!text) return s;
      const word = wordFor(s, from);
      if (word && givesAway(text, word)) return { ...s, rejected: { ...s.rejected, [from]: 'word' } };
      const next1 = { ...s, clues: { ...s.clues, [from]: text }, rejected: { ...s.rejected, [from]: null } };
      return ids(next1).every((id) => next1.clues[id]) ? next(next1, ctx) : next1;
    }
    if (action.type === 'vote' && s.phase === 'vote') {
      const target = action.player;
      if (typeof target !== 'string' || target === from || !ids(s).includes(target) || s.votes[from])
        return s;
      const next1 = { ...s, votes: { ...s.votes, [from]: target } };
      return ids(next1).every((id) => next1.votes[id]) ? next(next1, ctx) : next1;
    }
    if (action.type === 'guess' && s.phase === 'guess' && from === oddOf(s)) {
      const text = cleanText(action.text, CLUE_MAX);
      if (!text) return s;
      const guessed = sameAnswer(text, pair(s).word);
      const scores = { ...s.scores };
      const gained = { ...s.gained };
      if (guessed) {
        addPoints(scores, from, GUESS_POINTS);
        addPoints(gained, from, GUESS_POINTS);
      }
      return { ...s, guess: text, guessed, scores, gained, phase: 'reveal', deadline: ctx.now + REVEAL_MS };
    }
    return s;
  },

  advance: (s, ctx) => next(s, ctx),

  view(s) {
    const p = pair(s);
    const shown = s.phase === 'vote' || s.phase === 'guess' || s.phase === 'reveal';
    const revealed = s.phase === 'reveal';
    return {
      phase: s.phase,
      deadline: s.deadline,
      round: s.round,
      rounds: s.pairs.length,
      mode: blank(s) ? 'blank' : 'similar',
      category: p.category,
      clues: shown ? s.clues : null,
      voted: s.phase === 'vote' ? Object.keys(s.votes) : null,
      votes: s.phase === 'guess' || revealed ? s.votes : null,
      odd: s.phase === 'guess' || revealed ? oddOf(s) : null,
      caught: s.caught,
      word: revealed ? p.word : null,
      decoy: revealed && !blank(s) ? p.decoy : null,
      guess: revealed ? s.guess : null,
      guessed: revealed ? s.guessed : null,
      waiting:
        s.phase === 'clue'
          ? ids(s).filter((id) => !s.clues[id])
          : s.phase === 'vote'
            ? ids(s).filter((id) => !s.votes[id])
            : s.phase === 'guess'
              ? [oddOf(s)]
              : [],
      scores: s.scores,
      gained: s.gained,
    };
  },

  privateView(s, id) {
    const knowsOdd = blank(s) && id === oddOf(s);
    return {
      word: wordFor(s, id),
      /** Only in "no word" mode does the odd one out know it. */
      odd: knowsOdd,
      clue: s.clues[id] ?? null,
      rejected: s.rejected[id] ?? null,
      vote: s.votes[id] ?? null,
      canGuess: s.phase === 'guess' && id === oddOf(s),
    };
  },

  botAction(s, bot, rng) {
    if (s.phase === 'clue' && !s.clues[bot]) {
      const word = wordFor(s, bot);
      // A bot's clue: the first letter of its word, or a vague line when it has none.
      const text = word
        ? `Starts with ${word[0]!.toUpperCase()}`
        : pick(['Hmm, tricky', 'Classic', 'Love it', 'Very me'], rng);
      return { type: 'clue', text };
    }
    if (s.phase === 'vote' && !s.votes[bot]) {
      const others = ids(s).filter((id) => id !== bot);
      const odd = oddOf(s);
      return { type: 'vote', player: odd !== bot && rng() < 0.35 ? odd : pick(others, rng) };
    }
    if (s.phase === 'guess' && bot === oddOf(s)) {
      return { type: 'guess', text: rng() < 0.25 ? pair(s).word : pick(BOT_ANSWERS, rng) };
    }
    return null;
  },

  scores: (s) => s.scores,
  done: (s) => s.phase === 'done',
  used: (s) => s.used,
};
