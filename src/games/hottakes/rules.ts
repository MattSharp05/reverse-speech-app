import { deal, maturityOk } from '../../content/deal';
import type { HotTake } from '../../content/schema';
import {
  asInt,
  asRecord,
  secs,
  type Ctx,
  type GameModule,
  type Player,
  type PlayerId,
  type Timed,
} from '../../platform/module';
import { addPoints } from '../../platform/scores';
import { pick } from '../bots';

/**
 * Hot Takes: how well do you know your friends? "Who's most likely to…" questions: pick a
 * player, and score if you picked who the group picked. Scale questions: rate it 0–10 yourself
 * and guess the group's average; the closer, the more points.
 */

const REVEAL_MS = secs(10);
export const MAJORITY_POINTS = 500;
/** Scale guesses: full points for the exact average, minus this per point off. */
export const SCALE_MAX = 1000;
export const SCALE_STEP = 250;

export interface HotSettings {
  questions: number;
  answerSecs: number;
  mix: string;
  maturity: string;
  [key: string]: string | number;
}

export type HotPhase = 'answer' | 'reveal' | 'done';

export interface HotState extends Timed {
  phase: HotPhase;
  index: number;
  players: Player[];
  settings: HotSettings;
  questions: HotTake[];
  /** "Who" questions: voter → player picked. */
  picks: Record<PlayerId, PlayerId>;
  /** Scale questions: each player's own rating and their guess at the average. */
  ratings: Record<PlayerId, { own: number; guess: number }>;
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
  used: string[];
}

const question = (s: HotState) => s.questions[s.index]!;
const ids = (s: HotState) => s.players.map((p) => p.id);
const answered = (s: HotState, id: PlayerId) =>
  question(s).kind === 'who' ? s.picks[id] !== undefined : s.ratings[id] !== undefined;

export function average(s: HotState): number | null {
  const own = Object.values(s.ratings).map((r) => r.own);
  return own.length ? own.reduce((a, b) => a + b, 0) / own.length : null;
}

/** The most-picked players ("who" questions). */
export function topPicks(s: HotState): PlayerId[] {
  const counts: Record<PlayerId, number> = {};
  for (const target of Object.values(s.picks)) counts[target] = (counts[target] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  return max ? Object.keys(counts).filter((id) => counts[id] === max) : [];
}

function reveal(s: HotState, ctx: Ctx): HotState {
  const scores = { ...s.scores };
  const gained: Record<PlayerId, number> = {};
  const award = (id: PlayerId, points: number) => {
    if (points <= 0) return;
    addPoints(scores, id, points);
    addPoints(gained, id, points);
  };
  if (question(s).kind === 'who') {
    const top = topPicks(s);
    for (const [voter, target] of Object.entries(s.picks))
      if (top.includes(target)) award(voter, MAJORITY_POINTS);
  } else {
    const avg = average(s);
    if (avg !== null) {
      for (const [id, r] of Object.entries(s.ratings)) {
        award(id, Math.round(Math.max(0, SCALE_MAX - Math.abs(r.guess - avg) * SCALE_STEP) / 10) * 10);
      }
    }
  }
  return { ...s, scores, gained, phase: 'reveal', deadline: ctx.now + REVEAL_MS };
}

function startQuestion(s: HotState, ctx: Ctx): HotState {
  if (s.index >= s.questions.length)
    return { ...s, index: s.questions.length - 1, phase: 'done', deadline: null };
  return {
    ...s,
    phase: 'answer',
    deadline: ctx.now + secs(s.settings.answerSecs),
    picks: {},
    ratings: {},
    gained: {},
  };
}

function next(s: HotState, ctx: Ctx): HotState {
  switch (s.phase) {
    case 'answer':
      return reveal(s, ctx);
    case 'reveal':
      return startQuestion({ ...s, index: s.index + 1 }, ctx);
    case 'done':
      return s;
  }
}

const scale = (v: unknown): number | null => {
  const n = asInt(v);
  return n !== null && n >= 0 && n <= 10 ? n : null;
};

export const hotTakes: GameModule<HotState, HotSettings> = {
  id: 'hottakes',
  minPlayers: 3,
  maxPlayers: 10,
  settings: [
    {
      key: 'questions',
      label: 'Questions',
      options: [6, 8, 10, 12].map((n) => ({ value: n, label: String(n) })),
    },
    {
      key: 'mix',
      label: 'Questions',
      options: [
        { value: 'both', label: 'Who + opinions' },
        { value: 'who', label: 'Only “who’s most likely”' },
        { value: 'scale', label: 'Only opinions (0–10)' },
      ],
    },
    {
      key: 'answerSecs',
      label: 'Answer time',
      options: [20, 30, 45].map((n) => ({ value: n, label: `${n}s` })),
    },
    {
      key: 'maturity',
      label: 'Content',
      options: [
        { value: 'family', label: 'Family friendly' },
        { value: 'adult', label: 'Anything goes (18+)' },
      ],
    },
  ],
  defaults: { questions: 8, mix: 'both', answerSecs: 30, maturity: 'family' },

  init(players, settings, ctx) {
    const count = Math.max(1, Math.min(15, Number(settings.questions) || 8));
    const filter = (q: HotTake) =>
      maturityOk(settings.maturity, q) && (settings.mix === 'both' || q.kind === settings.mix);
    let questions = deal(ctx.content.hottakes, count, ctx.rng, ctx.content.recent, filter);
    if (!questions.length) {
      questions = [
        {
          id: 'fallback',
          kind: 'who',
          text: 'Who is most likely to win this game?',
          category: 'who',
          maturity: 'family',
          source: 'original',
        },
      ];
    }
    const s: HotState = {
      phase: 'answer',
      deadline: null,
      index: 0,
      players,
      settings: { ...settings, answerSecs: Number(settings.answerSecs) },
      questions,
      picks: {},
      ratings: {},
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      gained: {},
      used: questions.map((q) => q.id),
    };
    return startQuestion(s, ctx);
  },

  act(s, from, raw, ctx) {
    const action = asRecord(raw);
    if (s.phase !== 'answer' || !ids(s).includes(from) || answered(s, from)) return s;
    const q = question(s);
    let next1 = s;
    if (action.type === 'pick' && q.kind === 'who') {
      const target = action.player;
      if (typeof target !== 'string' || !ids(s).includes(target)) return s;
      next1 = { ...s, picks: { ...s.picks, [from]: target } };
    } else if (action.type === 'rate' && q.kind === 'scale') {
      const own = scale(action.own);
      const guess = scale(action.guess);
      if (own === null || guess === null) return s;
      next1 = { ...s, ratings: { ...s.ratings, [from]: { own, guess } } };
    } else {
      return s;
    }
    return ids(next1).every((id) => answered(next1, id)) ? next(next1, ctx) : next1;
  },

  advance: (s, ctx) => next(s, ctx),

  view(s) {
    const q = question(s);
    const revealed = s.phase === 'reveal';
    return {
      phase: s.phase,
      deadline: s.deadline,
      index: s.index,
      count: s.questions.length,
      question: { kind: q.kind, text: q.text, low: q.low ?? null, high: q.high ?? null },
      picks: revealed ? s.picks : null,
      top: revealed ? topPicks(s) : null,
      ratings: revealed ? s.ratings : null,
      average: revealed ? average(s) : null,
      waiting: s.phase === 'answer' ? ids(s).filter((id) => !answered(s, id)) : [],
      scores: s.scores,
      gained: s.gained,
    };
  },

  privateView(s, id) {
    return { picked: s.picks[id] ?? null, rated: s.ratings[id] ?? null };
  },

  botAction(s, bot, rng) {
    if (s.phase !== 'answer' || answered(s, bot)) return null;
    if (question(s).kind === 'who') return { type: 'pick', player: pick(ids(s), rng) };
    const own = Math.floor(rng() * 11);
    const guess = Math.max(0, Math.min(10, 5 + Math.round((rng() - 0.5) * 6)));
    return { type: 'rate', own, guess };
  },

  scores: (s) => s.scores,
  done: (s) => s.phase === 'done',
  used: (s) => s.used,
};
