import { deal, maturityOk } from '../../content/deal';
import { asInt, asRecord, secs, type Ctx, type GameModule, type Player, type PlayerId, type Timed } from '../../platform/module';
import { shuffle } from '../../platform/rng';
import { addPoints } from '../../platform/scores';
import { cleanText, sameAnswer } from '../../platform/text';

export const CAPTION_MAX = 60;
/** The drawing's coordinate space (4:3). */
export const CANVAS_W = 800;
export const CANVAS_H = 600;
export const MAX_STROKES = 400;
/** Coordinates (x and y each count) across all strokes. */
export const MAX_COORDS = 16000;
export const COLORS = ['#1b1b1f', '#e5484d', '#3e63dd', '#30a46c', '#f5a623', '#ffffff'];
export const SIZES = [4, 10, 24];
const REVEAL_MS = secs(12);
const SCORES_MS = secs(6);
const MIN_OPTIONS = 3;
export const TRUTH_POINTS = 1000;
export const FOOL_POINTS = 500;
export const ARTIST_POINTS = 500;

export interface Stroke {
  /** Colour index into `COLORS`. */
  c: number;
  /** Size index into `SIZES`. */
  s: number;
  /** x0, y0, x1, y1, … integers in the canvas space. */
  p: number[];
}

export type Drawing = Stroke[];

export interface SketchSettings {
  rounds: number;
  drawSecs: number;
  captionSecs: number;
  voteSecs: number;
  maturity: string;
  [key: string]: string | number;
}

export interface Sketch {
  artist: PlayerId;
  prompt: { id: string; text: string };
  drawing: Drawing | null;
}

export interface CaptionOption {
  text: string;
  truth: boolean;
  authors: PlayerId[];
  house: boolean;
}

export type SketchPhase = 'draw' | 'caption' | 'vote' | 'reveal' | 'scores' | 'done';

export interface SketchState extends Timed {
  phase: SketchPhase;
  round: number;
  rounds: number;
  players: Player[];
  settings: SketchSettings;
  sketches: Sketch[];
  /** Indices into `sketches` with a drawing, in showing order. */
  order: number[];
  current: number;
  captions: Record<PlayerId, string>;
  rejected: Record<PlayerId, 'truth' | null>;
  options: CaptionOption[];
  votes: Record<PlayerId, number>;
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
  deck: { id: string; text: string }[];
  used: string[];
}

/** Checks a drawing from a phone: shape, ranges and size limits. Null when it's no good. */
export function validDrawing(value: unknown): Drawing | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STROKES) return null;
  let coords = 0;
  const strokes: Drawing = [];
  for (const raw of value) {
    const stroke = asRecord(raw);
    const c = asInt(stroke.c);
    const s = asInt(stroke.s);
    const p = stroke.p;
    if (c === null || c < 0 || c >= COLORS.length || s === null || s < 0 || s >= SIZES.length) return null;
    if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0) return null;
    coords += p.length;
    if (coords > MAX_COORDS) return null;
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      const max = i % 2 === 0 ? CANVAS_W : CANVAS_H;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) return null;
    }
    strokes.push({ c, s, p: p as number[] });
  }
  return strokes;
}

const sketch = (s: SketchState) => s.sketches[s.order[s.current]!]!;
const nonArtists = (s: SketchState) => s.players.map((p) => p.id).filter((id) => id !== sketch(s).artist);

function startRound(s: SketchState, ctx: Ctx): SketchState {
  const prompts = s.deck.slice(0, s.players.length);
  const sketches = s.players.map((p, i) => ({
    artist: p.id,
    prompt: prompts[i] ?? { id: `blank-${i}`, text: 'A cat running for president' },
    drawing: null,
  }));
  return {
    ...s,
    phase: 'draw',
    deadline: ctx.now + secs(s.settings.drawSecs),
    sketches,
    order: [],
    current: 0,
    deck: s.deck.slice(prompts.length),
    used: [...s.used, ...prompts.map((p) => p.id)],
    gained: {},
  };
}

function startSketch(s: SketchState, ctx: Ctx): SketchState {
  return {
    ...s,
    phase: 'caption',
    deadline: ctx.now + secs(s.settings.captionSecs),
    captions: {},
    rejected: {},
    options: [],
    votes: {},
  };
}

/** After the drawing phase: show the drawings that came in, or skip the round if none did. */
function afterDrawing(s: SketchState, ctx: Ctx): SketchState {
  const order = shuffle(
    s.sketches.map((x, i) => (x.drawing ? i : -1)).filter((i) => i >= 0),
    ctx.rng,
  );
  if (!order.length) return endRound({ ...s, order }, ctx);
  return startSketch({ ...s, order, current: 0 }, ctx);
}

function buildOptions(s: SketchState, ctx: Ctx): CaptionOption[] {
  const truth = sketch(s).prompt.text;
  const options: CaptionOption[] = [{ text: truth, truth: true, authors: [], house: false }];
  for (const id of nonArtists(s)) {
    const caption = s.captions[id];
    if (!caption) continue;
    const same = options.find((o) => !o.truth && sameAnswer(o.text, caption));
    if (same) same.authors.push(id);
    else options.push({ text: caption, truth: false, authors: [id], house: false });
  }
  // Decoys: prompts nobody drew this game.
  for (const decoy of s.deck) {
    if (options.length >= MIN_OPTIONS) break;
    if (!options.some((o) => sameAnswer(o.text, decoy.text)))
      options.push({ text: decoy.text, truth: false, authors: [], house: true });
  }
  return shuffle(options, ctx.rng);
}

function reveal(s: SketchState, ctx: Ctx): SketchState {
  const scores = { ...s.scores };
  const gained = { ...s.gained };
  const artist = sketch(s).artist;
  const award = (id: PlayerId, points: number) => {
    addPoints(scores, id, points);
    addPoints(gained, id, points);
  };
  for (const [voter, index] of Object.entries(s.votes)) {
    const option = s.options[index]!;
    if (option.truth) {
      award(voter, TRUTH_POINTS);
      award(artist, ARTIST_POINTS);
    }
    for (const author of option.authors) if (author !== voter) award(author, FOOL_POINTS);
  }
  return { ...s, scores, gained, phase: 'reveal', deadline: ctx.now + REVEAL_MS };
}

function endRound(s: SketchState, ctx: Ctx): SketchState {
  return { ...s, phase: 'scores', deadline: ctx.now + SCORES_MS };
}

function next(s: SketchState, ctx: Ctx): SketchState {
  switch (s.phase) {
    case 'draw':
      return afterDrawing(s, ctx);
    case 'caption':
      return { ...s, phase: 'vote', options: buildOptions(s, ctx), deadline: ctx.now + secs(s.settings.voteSecs) };
    case 'vote':
      return reveal(s, ctx);
    case 'reveal':
      if (s.current + 1 < s.order.length) return startSketch({ ...s, current: s.current + 1 }, ctx);
      return endRound(s, ctx);
    case 'scores':
      if (s.round + 1 >= s.rounds) return { ...s, phase: 'done', deadline: null };
      return startRound({ ...s, round: s.round + 1 }, ctx);
    case 'done':
      return s;
  }
}

export const sketchIt: GameModule<SketchState, SketchSettings> = {
  id: 'sketch',
  minPlayers: 3,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: 'Rounds', options: [1, 2].map((n) => ({ value: n, label: String(n) })) },
    { key: 'drawSecs', label: 'Drawing time', options: [60, 80, 100, 120].map((n) => ({ value: n, label: `${n}s` })) },
    { key: 'captionSecs', label: 'Caption time', options: [30, 45, 60].map((n) => ({ value: n, label: `${n}s` })) },
    { key: 'voteSecs', label: 'Vote time', options: [15, 20, 30].map((n) => ({ value: n, label: `${n}s` })) },
    {
      key: 'maturity',
      label: 'Content',
      options: [
        { value: 'family', label: 'Family friendly' },
        { value: 'adult', label: 'Anything goes (18+)' },
      ],
    },
  ],
  defaults: { rounds: 1, drawSecs: 80, captionSecs: 45, voteSecs: 20, maturity: 'family' },

  init(players, settings, ctx) {
    const rounds = Math.max(1, Math.min(2, Number(settings.rounds) || 1));
    // Enough to draw, plus spares the house uses as decoys.
    const need = rounds * players.length + 6;
    const dealt = deal(ctx.content.sketch, need, ctx.rng, ctx.content.recent, (p) => maturityOk(settings.maturity, p));
    const s: SketchState = {
      phase: 'draw',
      deadline: null,
      round: 0,
      rounds,
      players,
      settings: {
        ...settings,
        drawSecs: Number(settings.drawSecs),
        captionSecs: Number(settings.captionSecs),
        voteSecs: Number(settings.voteSecs),
      },
      sketches: [],
      order: [],
      current: 0,
      captions: {},
      rejected: {},
      options: [],
      votes: {},
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      gained: {},
      deck: dealt.map((p) => ({ id: p.id, text: p.text })),
      used: [],
    };
    return startRound(s, ctx);
  },

  act(s, from, raw, ctx) {
    const action = asRecord(raw);
    if (action.type === 'draw' && s.phase === 'draw') {
      const index = s.sketches.findIndex((x) => x.artist === from);
      const drawing = validDrawing(action.drawing);
      if (index < 0 || s.sketches[index]!.drawing || !drawing) return s;
      const sketches = s.sketches.map((x, i) => (i === index ? { ...x, drawing } : x));
      const next1 = { ...s, sketches };
      return sketches.every((x) => x.drawing) ? next(next1, ctx) : next1;
    }
    if (action.type === 'caption' && s.phase === 'caption') {
      if (!nonArtists(s).includes(from) || s.captions[from]) return s;
      const text = cleanText(action.text, CAPTION_MAX);
      if (!text) return s;
      if (sameAnswer(text, sketch(s).prompt.text)) return { ...s, rejected: { ...s.rejected, [from]: 'truth' } };
      const next1 = { ...s, captions: { ...s.captions, [from]: text }, rejected: { ...s.rejected, [from]: null } };
      return nonArtists(next1).every((id) => next1.captions[id]) ? next(next1, ctx) : next1;
    }
    if (action.type === 'vote' && s.phase === 'vote') {
      const index = asInt(action.option);
      const option = index === null ? undefined : s.options[index];
      if (!option || !nonArtists(s).includes(from) || s.votes[from] !== undefined || option.authors.includes(from))
        return s;
      const next1 = { ...s, votes: { ...s.votes, [from]: index! } };
      return nonArtists(next1).every((id) => next1.votes[id] !== undefined) ? next(next1, ctx) : next1;
    }
    return s;
  },

  advance: (s, ctx) => next(s, ctx),

  view(s) {
    const showing = s.phase === 'caption' || s.phase === 'vote' || s.phase === 'reveal';
    const current = showing ? sketch(s) : null;
    const revealed = s.phase === 'reveal';
    return {
      phase: s.phase,
      deadline: s.deadline,
      round: s.round,
      rounds: s.rounds,
      index: s.current,
      count: s.order.length,
      drawing: current?.drawing ?? null,
      artist: current?.artist ?? null,
      options:
        s.phase === 'vote' || revealed
          ? s.options.map((o, i) => ({
              text: o.text,
              truth: revealed ? o.truth : null,
              authors: revealed ? o.authors : null,
              house: revealed ? o.house : null,
              votedBy: revealed ? Object.entries(s.votes).filter(([, v]) => v === i).map(([id]) => id) : null,
            }))
          : null,
      prompt: revealed ? current!.prompt.text : null,
      waiting:
        s.phase === 'draw'
          ? s.sketches.filter((x) => !x.drawing).map((x) => x.artist)
          : s.phase === 'caption'
            ? nonArtists(s).filter((id) => !s.captions[id])
            : s.phase === 'vote'
              ? nonArtists(s).filter((id) => s.votes[id] === undefined)
              : [],
      scores: s.scores,
      gained: s.gained,
    };
  },

  privateView(s, id) {
    const mine = s.sketches.find((x) => x.artist === id);
    const showing = s.phase === 'caption' || s.phase === 'vote' || s.phase === 'reveal';
    return {
      prompt: s.phase === 'draw' ? (mine?.prompt.text ?? null) : null,
      drawn: Boolean(mine?.drawing),
      artist: showing ? sketch(s).artist === id : false,
      caption: s.captions[id] ?? null,
      rejected: s.rejected[id] ?? null,
      vote: s.votes[id] ?? null,
      own: s.options.map((o, i) => (o.authors.includes(id) ? i : -1)).filter((i) => i >= 0),
    };
  },

  scores: (s) => s.scores,
  done: (s) => s.phase === 'done',
  used: (s) => s.used,
};
