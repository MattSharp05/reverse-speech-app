import { categoryOk, deal } from '../../content/deal';
import type { BluffQuestion } from '../../content/schema';
import { asInt, asRecord, secs, type Ctx, type GameModule, type Player, type PlayerId, type Timed } from '../../platform/module';
import { shuffle } from '../../platform/rng';
import { addPoints } from '../../platform/scores';
import { cleanText, sameAnswer } from '../../platform/text';

export const LIE_MAX = 45;
const REVEAL_MS = secs(12);
const SCORES_MS = secs(6);
/** Fewest choices on screen: the house adds decoys to reach it. */
const MIN_OPTIONS = 3;
export const TRUTH_POINTS = 1000;
export const FOOL_POINTS = 500;

export interface BluffSettings {
  questions: number;
  lieSecs: number;
  pickSecs: number;
  category: string;
  difficulty: string;
  [key: string]: string | number;
}

export interface BluffOption {
  text: string;
  truth: boolean;
  /** Players who wrote this lie (several, when they wrote the same thing). */
  authors: PlayerId[];
  /** A decoy the house added. */
  house: boolean;
}

export type BluffPhase = 'lie' | 'pick' | 'reveal' | 'scores' | 'done';

export interface BluffState extends Timed {
  phase: BluffPhase;
  index: number;
  players: Player[];
  settings: BluffSettings;
  /** Host only: never sent as is (the answer is in here). */
  questions: BluffQuestion[];
  lies: Record<PlayerId, string>;
  /** Why a player's last lie was turned away. */
  rejected: Record<PlayerId, 'truth' | null>;
  options: BluffOption[];
  picks: Record<PlayerId, number>;
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
  used: string[];
}

const question = (s: BluffState) => s.questions[s.index]!;
const lastQuestion = (s: BluffState) => s.index === s.questions.length - 1;
const multiplier = (s: BluffState) => (lastQuestion(s) && s.questions.length > 1 ? 2 : 1);

function isTruth(q: BluffQuestion, text: string): boolean {
  return [q.answer, ...q.alternates].some((a) => sameAnswer(a, text));
}

function startQuestion(s: BluffState, ctx: Ctx): BluffState {
  return {
    ...s,
    phase: 'lie',
    deadline: ctx.now + secs(s.settings.lieSecs),
    lies: {},
    rejected: {},
    options: [],
    picks: {},
    gained: {},
  };
}

/** The truth, every distinct lie (equivalent lies merged), house decoys if short; shuffled. */
export function buildOptions(s: BluffState, ctx: Ctx): BluffOption[] {
  const q = question(s);
  const options: BluffOption[] = [{ text: q.answer, truth: true, authors: [], house: false }];
  for (const p of s.players) {
    const lie = s.lies[p.id];
    if (!lie) continue;
    const same = options.find((o) => !o.truth && sameAnswer(o.text, lie));
    if (same) same.authors.push(p.id);
    else options.push({ text: lie, truth: false, authors: [p.id], house: false });
  }
  for (const decoy of shuffle(q.decoys, ctx.rng)) {
    if (options.length >= MIN_OPTIONS) break;
    if (options.some((o) => sameAnswer(o.text, decoy))) continue;
    options.push({ text: decoy, truth: false, authors: [], house: true });
  }
  return shuffle(options, ctx.rng);
}

/** Who may pick: everyone who has a choice that isn't their own lie. */
const pickers = (s: BluffState) => s.players.map((p) => p.id);

function reveal(s: BluffState, ctx: Ctx): BluffState {
  const m = multiplier(s);
  const scores = { ...s.scores };
  const gained: Record<PlayerId, number> = {};
  for (const [picker, index] of Object.entries(s.picks)) {
    const option = s.options[index]!;
    if (option.truth) {
      addPoints(scores, picker, TRUTH_POINTS * m);
      addPoints(gained, picker, TRUTH_POINTS * m);
    }
    for (const author of option.authors) {
      if (author === picker) continue;
      addPoints(scores, author, FOOL_POINTS * m);
      addPoints(gained, author, FOOL_POINTS * m);
    }
  }
  return { ...s, scores, gained, phase: 'reveal', deadline: ctx.now + REVEAL_MS };
}

function next(s: BluffState, ctx: Ctx): BluffState {
  switch (s.phase) {
    case 'lie':
      return { ...s, phase: 'pick', options: buildOptions(s, ctx), deadline: ctx.now + secs(s.settings.pickSecs) };
    case 'pick':
      return reveal(s, ctx);
    case 'reveal':
      return { ...s, phase: 'scores', deadline: ctx.now + SCORES_MS };
    case 'scores':
      if (lastQuestion(s)) return { ...s, phase: 'done', deadline: null };
      return startQuestion({ ...s, index: s.index + 1 }, ctx);
    case 'done':
      return s;
  }
}

export const bluff: GameModule<BluffState, BluffSettings> = {
  id: 'bluff',
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'questions', label: 'Questions', options: [4, 6, 8, 10].map((n) => ({ value: n, label: String(n) })) },
    { key: 'lieSecs', label: 'Lie time', options: [30, 45, 60, 90].map((n) => ({ value: n, label: `${n}s` })) },
    { key: 'pickSecs', label: 'Pick time', options: [15, 20, 30].map((n) => ({ value: n, label: `${n}s` })) },
    { key: 'category', label: 'Category', options: [{ value: 'any', label: 'Everything' }] },
    {
      key: 'difficulty',
      label: 'Difficulty',
      options: [
        { value: 'any', label: 'Any' },
        { value: 'easy', label: 'Easy' },
        { value: 'medium', label: 'Medium' },
        { value: 'hard', label: 'Hard' },
      ],
    },
  ],
  defaults: { questions: 6, lieSecs: 45, pickSecs: 20, category: 'any', difficulty: 'any' },

  init(players, settings, ctx) {
    const count = Math.max(1, Math.min(12, Number(settings.questions) || 6));
    const filter = (q: BluffQuestion) =>
      categoryOk(settings.category, q) && (settings.difficulty === 'any' || q.difficulty === settings.difficulty);
    let questions = deal(ctx.content.bluff, count, ctx.rng, ctx.content.recent, filter);
    if (questions.length < count) questions = deal(ctx.content.bluff, count, ctx.rng, ctx.content.recent);
    if (!questions.length) {
      questions = [
        {
          id: 'fallback',
          text: 'The national animal of Scotland is the ___.',
          answer: 'unicorn',
          alternates: [],
          decoys: ['red deer', 'golden eagle'],
          category: 'general',
          difficulty: 'easy',
          maturity: 'family',
          source: 'original',
        },
      ];
    }
    const s: BluffState = {
      phase: 'lie',
      deadline: null,
      index: 0,
      players,
      settings: { ...settings, lieSecs: Number(settings.lieSecs), pickSecs: Number(settings.pickSecs) },
      questions,
      lies: {},
      rejected: {},
      options: [],
      picks: {},
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      gained: {},
      used: questions.map((q) => q.id),
    };
    return startQuestion(s, ctx);
  },

  act(s, from, raw, ctx) {
    const action = asRecord(raw);
    if (action.type === 'lie' && s.phase === 'lie') {
      if (s.lies[from]) return s;
      const text = cleanText(action.text, LIE_MAX);
      if (!text) return s;
      if (isTruth(question(s), text)) {
        // Found the truth: they must try another lie (and nobody else learns it).
        return { ...s, rejected: { ...s.rejected, [from]: 'truth' } };
      }
      const next1 = { ...s, lies: { ...s.lies, [from]: text }, rejected: { ...s.rejected, [from]: null } };
      return s.players.every((p) => next1.lies[p.id]) ? next(next1, ctx) : next1;
    }
    if (action.type === 'pick' && s.phase === 'pick') {
      const index = asInt(action.option);
      const option = index === null ? undefined : s.options[index];
      if (!option || s.picks[from] !== undefined || option.authors.includes(from)) return s;
      const next1 = { ...s, picks: { ...s.picks, [from]: index! } };
      return pickers(next1).every((id) => next1.picks[id] !== undefined) ? next(next1, ctx) : next1;
    }
    return s;
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
      final: lastQuestion(s) && s.questions.length > 1,
      question: q.text,
      category: q.category,
      options:
        s.phase === 'pick' || revealed
          ? s.options.map((o, i) => ({
              text: o.text,
              truth: revealed ? o.truth : null,
              authors: revealed ? o.authors : null,
              house: revealed ? o.house : null,
              pickedBy: revealed ? Object.entries(s.picks).filter(([, p]) => p === i).map(([id]) => id) : null,
            }))
          : null,
      answer: revealed ? q.answer : null,
      explanation: revealed ? (q.explanation ?? null) : null,
      reference: revealed ? (q.reference ?? null) : null,
      waiting:
        s.phase === 'lie'
          ? s.players.filter((p) => !s.lies[p.id]).map((p) => p.id)
          : s.phase === 'pick'
            ? pickers(s).filter((id) => s.picks[id] === undefined)
            : [],
      scores: s.scores,
      gained: s.gained,
    };
  },

  privateView(s, id) {
    return {
      lie: s.lies[id] ?? null,
      rejected: s.rejected[id] ?? null,
      pick: s.picks[id] ?? null,
      /** Options this player wrote (they can't pick them). */
      own: s.options.map((o, i) => (o.authors.includes(id) ? i : -1)).filter((i) => i >= 0),
    };
  },

  scores: (s) => s.scores,
  done: (s) => s.phase === 'done',
  used: (s) => s.used,
};
