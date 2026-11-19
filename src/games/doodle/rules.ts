import { deal, maturityOk } from '../../content/deal';
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
import { BOT_ANSWERS, pick, scribble } from '../bots';
import { CANVAS_H, CANVAS_W, validDrawing, type Drawing } from '../sketch/rules';
import { packDrawing } from './pack';

/**
 * Telephone Doodle: everyone writes a phrase; it passes to the next phone to draw, the next
 * guesses the drawing, the next draws that guess… Every chain is then played back on the TV,
 * and everyone votes for their favourite moment in it.
 */

export const TEXT_MAX = 60;
/** Doodles are smaller than Sketch It's: several travel in one message. */
export const DOODLE_MAX_COORDS = 6000;
const SHOW_ENTRY_MS = secs(4);

export interface DoodleSettings {
  steps: number;
  writeSecs: number;
  drawSecs: number;
  guessSecs: number;
  voteSecs: number;
  maturity: string;
  [key: string]: string | number;
}

export interface Entry {
  author: PlayerId;
  kind: 'text' | 'drawing';
  text: string | null;
  drawing: Drawing | null;
}

export type DoodlePhase = 'write' | 'draw' | 'guess' | 'show' | 'vote' | 'done';

export interface DoodleState extends Timed {
  phase: DoodlePhase;
  /** Which hand-off we're on: 0 writing, then drawing and guessing in turn. */
  step: number;
  /** Entries per chain. */
  steps: number;
  players: Player[];
  /** Seating order: at step k, chain c is with `order[(c + k) % n]`. */
  order: PlayerId[];
  settings: DoodleSettings;
  chains: Entry[][];
  /** The chain being shown / voted on, and how many of its entries are showing. */
  chain: number;
  shown: number;
  suggestions: Record<PlayerId, string>;
  votes: Record<PlayerId, number>;
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
  used: string[];
}

const ids = (s: DoodleState) => s.players.map((p) => p.id);
const kindAt = (step: number): Entry['kind'] | 'start' =>
  step === 0 ? 'start' : step % 2 === 1 ? 'drawing' : 'text';

/** The chain this player works on at this step. */
export function chainFor(s: DoodleState, id: PlayerId): number {
  const n = s.order.length;
  const seat = s.order.indexOf(id);
  return (((seat - s.step) % n) + n) % n;
}

const done = (s: DoodleState, id: PlayerId) => s.chains[chainFor(s, id)]!.length > s.step;
const phaseFor = (step: number): DoodlePhase => (step === 0 ? 'write' : step % 2 === 1 ? 'draw' : 'guess');
const secsFor = (s: DoodleState, phase: DoodlePhase) =>
  phase === 'write' ? s.settings.writeSecs : phase === 'draw' ? s.settings.drawSecs : s.settings.guessSecs;

function startStep(s: DoodleState, ctx: Ctx): DoodleState {
  const phase = phaseFor(s.step);
  return { ...s, phase, deadline: ctx.now + secs(secsFor(s, phase)) };
}

/** Time's up for a step: fill in whatever's missing so every chain stays whole. */
function fillMissing(s: DoodleState): DoodleState {
  const kind = kindAt(s.step);
  const chains = s.chains.map((chain, c) => {
    if (chain.length > s.step) return chain;
    const author = s.order[(c + s.step) % s.order.length]!;
    const entry: Entry =
      kind === 'drawing'
        ? { author, kind: 'drawing', text: null, drawing: [] }
        : {
            author,
            kind: 'text',
            text: kind === 'start' ? (s.suggestions[author] ?? '???') : '???',
            drawing: null,
          };
    return [...chain, entry];
  });
  return { ...s, chains };
}

/** Entries in the current chain someone can vote for (not their own). */
const votable = (s: DoodleState, voter: PlayerId) =>
  s.chains[s.chain]!.map((e, i) => ({ e, i }))
    .filter(({ e, i }) => i > 0 && e.author !== voter)
    .map(({ i }) => i);

function openShow(s: DoodleState, chain: number, ctx: Ctx): DoodleState {
  if (chain >= s.chains.length) return { ...s, chain: s.chains.length - 1, phase: 'done', deadline: null };
  return { ...s, phase: 'show', chain, shown: 1, votes: {}, gained: {}, deadline: ctx.now + SHOW_ENTRY_MS };
}

function tallyVotes(s: DoodleState): DoodleState {
  const scores = { ...s.scores };
  const gained: Record<PlayerId, number> = {};
  const chain = s.chains[s.chain]!;
  for (const index of Object.values(s.votes)) {
    const author = chain[index]!.author;
    addPoints(scores, author, 500);
    addPoints(gained, author, 500);
  }
  return { ...s, scores, gained };
}

function next(s: DoodleState, ctx: Ctx): DoodleState {
  switch (s.phase) {
    case 'write':
    case 'draw':
    case 'guess': {
      const filled = fillMissing(s);
      if (s.step + 1 < s.steps) return startStep({ ...filled, step: s.step + 1 }, ctx);
      return openShow(filled, 0, ctx);
    }
    case 'show':
      if (s.shown < s.chains[s.chain]!.length)
        return { ...s, shown: s.shown + 1, deadline: ctx.now + SHOW_ENTRY_MS };
      return { ...s, phase: 'vote', deadline: ctx.now + secs(s.settings.voteSecs) };
    case 'vote':
      return openShow(tallyVotes(s), s.chain + 1, ctx);
    case 'done':
      return s;
  }
}

function packEntry(e: Entry, withDrawing: boolean) {
  return {
    author: e.author,
    kind: e.kind,
    text: e.text,
    drawing: withDrawing && e.drawing ? packDrawing(e.drawing) : null,
  };
}

export const doodle: GameModule<DoodleState, DoodleSettings> = {
  id: 'doodle',
  minPlayers: 3,
  maxPlayers: 10,
  settings: [
    {
      key: 'steps',
      label: 'Chain length',
      options: [
        { value: 4, label: '4 (short)' },
        { value: 6, label: '6' },
        { value: 8, label: '8' },
        { value: 10, label: 'Everyone' },
      ],
    },
    {
      key: 'drawSecs',
      label: 'Drawing time',
      options: [45, 60, 75, 90].map((n) => ({ value: n, label: `${n}s` })),
    },
    {
      key: 'guessSecs',
      label: 'Guess time',
      options: [25, 40, 60].map((n) => ({ value: n, label: `${n}s` })),
    },
    {
      key: 'writeSecs',
      label: 'Writing time',
      options: [30, 45, 60].map((n) => ({ value: n, label: `${n}s` })),
    },
    { key: 'voteSecs', label: 'Vote time', options: [15, 20, 30].map((n) => ({ value: n, label: `${n}s` })) },
    {
      key: 'maturity',
      label: 'Suggestions',
      options: [
        { value: 'family', label: 'Family friendly' },
        { value: 'adult', label: 'Anything goes (18+)' },
      ],
    },
  ],
  defaults: { steps: 6, drawSecs: 75, guessSecs: 40, writeSecs: 45, voteSecs: 20, maturity: 'family' },

  init(players, settings, ctx) {
    const order = shuffle(
      players.map((p) => p.id),
      ctx.rng,
    );
    const steps = Math.max(3, Math.min(order.length, Number(settings.steps) || 6));
    const ideas = deal(ctx.content.sketch, order.length, ctx.rng, ctx.content.recent, (p) =>
      maturityOk(settings.maturity, p),
    );
    const s: DoodleState = {
      phase: 'write',
      deadline: null,
      step: 0,
      steps,
      players,
      order,
      settings: {
        ...settings,
        steps,
        writeSecs: Number(settings.writeSecs),
        drawSecs: Number(settings.drawSecs),
        guessSecs: Number(settings.guessSecs),
        voteSecs: Number(settings.voteSecs),
      },
      chains: order.map(() => []),
      chain: 0,
      shown: 0,
      suggestions: Object.fromEntries(
        order.map((id, i) => [id, ideas[i]?.text ?? 'A cat running for president']),
      ),
      votes: {},
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      gained: {},
      used: ideas.map((p) => p.id),
    };
    return startStep(s, ctx);
  },

  act(s, from, raw, ctx) {
    const action = asRecord(raw);
    if (!ids(s).includes(from)) return s;
    if (s.phase === 'write' || s.phase === 'draw' || s.phase === 'guess') {
      if (done(s, from)) return s;
      let entry: Entry | null = null;
      if (s.phase === 'draw' && action.type === 'draw') {
        const drawing = validDrawing(action.drawing);
        const coords = drawing?.reduce((n, st) => n + st.p.length, 0) ?? Infinity;
        if (drawing && coords <= DOODLE_MAX_COORDS)
          entry = { author: from, kind: 'drawing', text: null, drawing };
      } else if (
        (s.phase === 'write' && action.type === 'write') ||
        (s.phase === 'guess' && action.type === 'guess')
      ) {
        const text = cleanText(action.text, TEXT_MAX);
        if (text) entry = { author: from, kind: 'text', text, drawing: null };
      }
      if (!entry) return s;
      const c = chainFor(s, from);
      const chains = s.chains.map((chain, i) => (i === c ? [...chain, entry!] : chain));
      const next1 = { ...s, chains };
      return ids(next1).every((id) => done(next1, id)) ? next(next1, ctx) : next1;
    }
    if (s.phase === 'vote' && action.type === 'vote') {
      const index = asInt(action.entry);
      if (index === null || s.votes[from] !== undefined || !votable(s, from).includes(index)) return s;
      const next1 = { ...s, votes: { ...s.votes, [from]: index } };
      const voters = ids(next1).filter((id) => votable(next1, id).length > 0);
      return voters.every((id) => next1.votes[id] !== undefined) ? next(next1, ctx) : next1;
    }
    return s;
  },

  advance: (s, ctx) => next(s, ctx),

  view(s) {
    const showing = s.phase === 'show' || s.phase === 'vote';
    const chain = showing ? s.chains[s.chain]! : [];
    const visible = s.phase === 'vote' ? chain : chain.slice(0, s.shown);
    return {
      phase: s.phase,
      deadline: s.deadline,
      step: s.step,
      steps: s.steps,
      chain: s.chain,
      chains: s.chains.length,
      /** Whose phrase started the chain on show. */
      starter: showing ? (chain[0]?.author ?? null) : null,
      entries: showing ? visible.map((e) => packEntry(e, true)) : null,
      votes: s.phase === 'vote' ? Object.keys(s.votes) : null,
      waiting:
        s.phase === 'write' || s.phase === 'draw' || s.phase === 'guess'
          ? ids(s).filter((id) => !done(s, id))
          : s.phase === 'vote'
            ? ids(s).filter((id) => s.votes[id] === undefined && votable(s, id).length > 0)
            : [],
      scores: s.scores,
      gained: s.gained,
    };
  },

  privateView(s, id) {
    const working = s.phase === 'write' || s.phase === 'draw' || s.phase === 'guess';
    const previous = working && s.step > 0 ? s.chains[chainFor(s, id)]![s.step - 1] : null;
    return {
      done: working ? done(s, id) : false,
      suggestion: s.phase === 'write' ? (s.suggestions[id] ?? null) : null,
      /** What to draw (draw step) or the drawing to guess (guess step, packed). */
      text: s.phase === 'draw' ? (previous?.text ?? null) : null,
      drawing: s.phase === 'guess' && previous?.drawing ? packDrawing(previous.drawing) : null,
      votable: s.phase === 'vote' ? votable(s, id) : [],
      vote: s.votes[id] ?? null,
    };
  },

  botAction(s, bot, rng) {
    if ((s.phase === 'write' || s.phase === 'draw' || s.phase === 'guess') && !done(s, bot)) {
      if (s.phase === 'write') return { type: 'write', text: s.suggestions[bot] ?? pick(BOT_ANSWERS, rng) };
      if (s.phase === 'draw') return { type: 'draw', drawing: scribble(rng, CANVAS_W, CANVAS_H) };
      return { type: 'guess', text: pick(BOT_ANSWERS, rng) };
    }
    if (s.phase === 'vote' && s.votes[bot] === undefined) {
      const options = votable(s, bot);
      return options.length ? { type: 'vote', entry: pick(options, rng) } : null;
    }
    return null;
  },

  scores: (s) => s.scores,
  done: (s) => s.phase === 'done',
  used: (s) => s.used,
};
