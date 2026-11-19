import { categoryOk, deal, maturityOk } from '../../content/deal';
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
import { shuffle } from '../../platform/rng';
import { addPoints } from '../../platform/scores';
import { cleanText } from '../../platform/text';

export const ANSWER_MAX = 80;
const INTRO_MS = secs(6);
const RESULT_MS = secs(8);
const SCORES_MS = secs(8);
/** Votes each player has in the final round. */
export const FINAL_VOTES = 3;

export interface QuipSettings {
  rounds: number;
  final: string;
  answerSecs: number;
  voteSecs: number;
  maturity: string;
  category: string;
  [key: string]: string | number;
}

export interface Matchup {
  prompt: { id: string; text: string };
  authors: PlayerId[];
  /** One per author; null: no answer. */
  answers: (string | null)[];
  /** Voter → the answer indices they voted for. */
  votes: Record<PlayerId, number[]>;
  /** Points each author got from this matchup (set on reveal). */
  points: Record<PlayerId, number>;
  /** Everyone who could vote voted for the same answer. */
  sweep: number | null;
}

export type QuipPhase = 'intro' | 'answer' | 'vote' | 'result' | 'scores' | 'done';

export interface QuipState extends Timed {
  phase: QuipPhase;
  /** 0-based; the final round is `rounds` (when `hasFinal`). */
  round: number;
  rounds: number;
  hasFinal: boolean;
  players: Player[];
  settings: QuipSettings;
  matchups: Matchup[];
  /** The matchup being voted on / revealed. */
  current: number;
  scores: Record<PlayerId, number>;
  /** Points scored this round (the scoreboard animates them). */
  gained: Record<PlayerId, number>;
  deck: { id: string; text: string }[];
  used: string[];
}

const isFinal = (s: QuipState) => s.hasFinal && s.round === s.rounds;
/** Points per vote: 100 in round 1, 200 in round 2, … and 300 in the final. */
const multiplier = (s: QuipState) => (isFinal(s) ? 3 : Math.min(s.round + 1, 3));

/**
 * Prompts for a round: as many as players, prompt i for players i and i+1 (after a shuffle),
 * so everyone answers two prompts, each against a different player.
 */
function pairUp(players: Player[], prompts: { id: string; text: string }[], ctx: Ctx): Matchup[] {
  const order = shuffle(
    players.map((p) => p.id),
    ctx.rng,
  );
  const count = order.length === 2 ? 1 : order.length;
  return Array.from({ length: count }, (_, i) => ({
    prompt: prompts[i] ?? { id: `blank-${i}`, text: 'Something you should never say to a ___' },
    authors: [order[i]!, order[(i + 1) % order.length]!],
    answers: [null, null],
    votes: {},
    points: {},
    sweep: null,
  }));
}

function startRound(s: QuipState, ctx: Ctx): QuipState {
  const final = s.hasFinal && s.round === s.rounds;
  const need = final ? 1 : s.players.length === 2 ? 1 : s.players.length;
  const prompts = s.deck.slice(0, need);
  const deck = s.deck.slice(need);
  const matchups = final
    ? [
        {
          prompt: prompts[0] ?? { id: 'final', text: 'The best thing about tonight' },
          authors: s.players.map((p) => p.id),
          answers: s.players.map(() => null),
          votes: {},
          points: {},
          sweep: null,
        },
      ]
    : pairUp(s.players, prompts, ctx);
  return {
    ...s,
    phase: 'intro',
    deadline: ctx.now + INTRO_MS,
    matchups,
    current: 0,
    gained: {},
    deck,
    used: [...s.used, ...prompts.map((p) => p.id)],
  };
}

export function eligibleVoters(s: QuipState, m: Matchup): PlayerId[] {
  if (isFinal(s)) return s.players.map((p) => p.id).filter((id) => answeredOthers(m, id) > 0);
  return s.players.map((p) => p.id).filter((id) => !m.authors.includes(id));
}

/** How many answers in `m` someone other than `id` wrote. */
function answeredOthers(m: Matchup, id: PlayerId): number {
  return m.answers.filter((a, i) => a !== null && m.authors[i] !== id).length;
}

const answeredCount = (m: Matchup) => m.answers.filter((a) => a !== null).length;

/** Voting on the current matchup, or straight to its result when there's nothing to vote on. */
function openVote(s: QuipState, ctx: Ctx): QuipState {
  const m = s.matchups[s.current]!;
  if (answeredCount(m) < 2 || eligibleVoters(s, m).length === 0) return reveal(s, ctx);
  return { ...s, phase: 'vote', deadline: ctx.now + secs(s.settings.voteSecs) };
}

function reveal(s: QuipState, ctx: Ctx): QuipState {
  const m = s.matchups[s.current]!;
  const per = 100 * multiplier(s);
  const counts = m.answers.map(() => 0);
  for (const choices of Object.values(m.votes)) for (const c of choices) counts[c] = (counts[c] ?? 0) + 1;
  const points: Record<PlayerId, number> = {};
  m.authors.forEach((a) => (points[a] = 0));
  counts.forEach((n, i) => (points[m.authors[i]!]! += n * per));
  let sweep: number | null = null;
  if (!isFinal(s)) {
    const answered = m.answers.map((a) => a !== null);
    if (answered.filter(Boolean).length === 1) {
      // The other player didn't answer: a win by forfeit.
      points[m.authors[answered.indexOf(true)]!]! += per;
    } else if (counts[0] !== counts[1]) {
      const win = counts[0]! > counts[1]! ? 0 : 1;
      points[m.authors[win]!]! += per; // winner bonus
      const voters = eligibleVoters(s, m).length;
      if (voters >= 2 && counts[win] === voters) {
        sweep = win;
        points[m.authors[win]!]! += 2 * per;
      }
    }
  }
  const scores = { ...s.scores };
  const gained = { ...s.gained };
  for (const [id, p] of Object.entries(points)) {
    addPoints(scores, id, p);
    addPoints(gained, id, p);
  }
  const matchups = s.matchups.map((x, i) => (i === s.current ? { ...m, points, sweep } : x));
  return { ...s, matchups, scores, gained, phase: 'result', deadline: ctx.now + RESULT_MS };
}

function next(s: QuipState, ctx: Ctx): QuipState {
  switch (s.phase) {
    case 'intro':
      return { ...s, phase: 'answer', deadline: ctx.now + secs(s.settings.answerSecs) };
    case 'answer':
      return openVote({ ...s, current: 0 }, ctx);
    case 'vote':
      return reveal(s, ctx);
    case 'result':
      if (s.current + 1 < s.matchups.length) return openVote({ ...s, current: s.current + 1 }, ctx);
      return { ...s, phase: 'scores', deadline: ctx.now + SCORES_MS };
    case 'scores': {
      const last = s.round + 1 >= s.rounds + (s.hasFinal ? 1 : 0);
      if (last) return { ...s, phase: 'done', deadline: null };
      return startRound({ ...s, round: s.round + 1 }, ctx);
    }
    case 'done':
      return s;
  }
}

function allAnswered(s: QuipState): boolean {
  return s.matchups.every((m) => m.answers.every((a) => a !== null));
}

function allVoted(s: QuipState): boolean {
  const m = s.matchups[s.current]!;
  return eligibleVoters(s, m).every((id) => m.votes[id] !== undefined);
}

export const quip: GameModule<QuipState, QuipSettings> = {
  id: 'quip',
  minPlayers: 3,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: 'Rounds', options: [1, 2, 3].map((n) => ({ value: n, label: String(n) })) },
    {
      key: 'final',
      label: 'Final round',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    },
    {
      key: 'answerSecs',
      label: 'Answer time',
      options: [45, 75, 90, 120].map((n) => ({ value: n, label: `${n}s` })),
    },
    { key: 'voteSecs', label: 'Vote time', options: [15, 20, 30].map((n) => ({ value: n, label: `${n}s` })) },
    {
      key: 'maturity',
      label: 'Content',
      options: [
        { value: 'family', label: 'Family friendly' },
        { value: 'adult', label: 'Anything goes (18+)' },
      ],
    },
    { key: 'category', label: 'Category', options: [{ value: 'any', label: 'Everything' }] },
  ],
  defaults: { rounds: 2, final: 'yes', answerSecs: 75, voteSecs: 20, maturity: 'family', category: 'any' },

  init(players, settings, ctx) {
    const rounds = Math.max(1, Math.min(3, Number(settings.rounds) || 2));
    const hasFinal = settings.final !== 'no';
    const need = rounds * players.length + 1;
    const filter = (p: { maturity: 'family' | 'adult'; category: string }) =>
      maturityOk(settings.maturity, p) && categoryOk(settings.category, p);
    let dealt = deal(ctx.content.quip, need, ctx.rng, ctx.content.recent, filter);
    if (dealt.length < need)
      dealt = deal(ctx.content.quip, need, ctx.rng, ctx.content.recent, (p) =>
        maturityOk(settings.maturity, p),
      );
    const s: QuipState = {
      phase: 'intro',
      deadline: null,
      round: 0,
      rounds,
      hasFinal,
      players,
      settings: { ...settings, answerSecs: Number(settings.answerSecs), voteSecs: Number(settings.voteSecs) },
      matchups: [],
      current: 0,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      gained: {},
      deck: dealt.map((p) => ({ id: p.id, text: p.text })),
      used: [],
    };
    return startRound(s, ctx);
  },

  act(s, from, raw, ctx) {
    const action = asRecord(raw);
    if (action.type === 'answer' && s.phase === 'answer') {
      const index = asInt(action.matchup);
      const m = index === null ? undefined : s.matchups[index];
      const seat = m ? m.authors.indexOf(from) : -1;
      const text = cleanText(action.text, ANSWER_MAX);
      if (!m || seat < 0 || m.answers[seat] !== null || !text) return s;
      const answers = m.answers.map((a, i) => (i === seat ? text : a));
      const next1 = { ...s, matchups: s.matchups.map((x, i) => (i === index ? { ...m, answers } : x)) };
      return allAnswered(next1) ? next(next1, ctx) : next1;
    }
    if (action.type === 'vote' && s.phase === 'vote') {
      const m = s.matchups[s.current]!;
      if (!eligibleVoters(s, m).includes(from) || m.votes[from] !== undefined) return s;
      const raw2 = Array.isArray(action.choices) ? action.choices : [action.choice];
      const choices = [...new Set(raw2.map(asInt))].filter(
        (c): c is number =>
          c !== null && m.answers[c] !== null && m.answers[c] !== undefined && m.authors[c] !== from,
      );
      const max = isFinal(s) ? FINAL_VOTES : 1;
      if (choices.length === 0 || choices.length > max || choices.length !== raw2.length) return s;
      const updated = { ...m, votes: { ...m.votes, [from]: choices } };
      const next1 = { ...s, matchups: s.matchups.map((x, i) => (i === s.current ? updated : x)) };
      return allVoted(next1) ? next(next1, ctx) : next1;
    }
    return s;
  },

  advance: (s, ctx) => next(s, ctx),

  view(s) {
    const m = s.matchups[s.current];
    const showAuthors = s.phase === 'result';
    const waiting =
      s.phase === 'answer'
        ? s.players
            .filter((p) => s.matchups.some((x) => x.answers[x.authors.indexOf(p.id)] === null))
            .map((p) => p.id)
        : s.phase === 'vote' && m
          ? eligibleVoters(s, m).filter((id) => m.votes[id] === undefined)
          : [];
    return {
      phase: s.phase,
      deadline: s.deadline,
      round: s.round,
      rounds: s.rounds,
      final: isFinal(s),
      matchupIndex: s.current,
      matchupCount: s.matchups.length,
      prompt: s.phase === 'vote' || s.phase === 'result' ? m?.prompt.text : null,
      answers:
        s.phase === 'vote' || s.phase === 'result'
          ? m?.answers.map((text, i) => ({
              text,
              author: showAuthors ? m.authors[i] : null,
              votes: showAuthors
                ? Object.entries(m.votes)
                    .filter(([, c]) => c.includes(i))
                    .map(([v]) => v)
                : null,
              points: showAuthors ? (m.points[m.authors[i]!] ?? 0) : null,
            }))
          : null,
      sweep: showAuthors ? (m?.sweep ?? null) : null,
      waiting,
      scores: s.scores,
      gained: s.gained,
      votesEach: isFinal(s) ? FINAL_VOTES : 1,
    };
  },

  privateView(s, id) {
    const m = s.matchups[s.current];
    return {
      prompts:
        s.phase === 'answer' || s.phase === 'intro'
          ? s.matchups
              .map((x, index) => ({
                index,
                text: x.prompt.text,
                answer: x.answers[x.authors.indexOf(id)] ?? null,
                mine: x.authors.includes(id),
              }))
              .filter((x) => x.mine)
              .map(({ index, text, answer }) => ({ index, text, answer }))
          : [],
      canVote: s.phase === 'vote' && m ? eligibleVoters(s, m).includes(id) : false,
      voted: m?.votes[id] ?? null,
      /** Answers in the current matchup this player wrote (they can't vote for them). */
      own: m ? m.authors.map((a, i) => (a === id ? i : -1)).filter((i) => i >= 0) : [],
    };
  },

  scores: (s) => s.scores,
  done: (s) => s.phase === 'done',
  used: (s) => s.used,
};
