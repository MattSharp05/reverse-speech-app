/**
 * Content for the games. Packs are JSON (`packs/*.json`, built by `scripts/import-content.mjs`
 * from the sources in CREDITS.md) or a custom pack the host loads on the TV.
 */

export type Maturity = 'family' | 'adult';

interface Base {
  id: string;
  category: string;
  maturity: Maturity;
  /** Where it came from (a pack id listed in CREDITS.md, or "original" / "custom"). */
  source: string;
  license?: string;
}

/** A Quip Battle prompt. `___` marks a blank to fill in. */
export interface QuipPrompt extends Base {
  text: string;
}

/** A Bluff It question: the real answer is hidden among the players' lies. */
export interface BluffQuestion extends Base {
  /** The question; `___` marks where the answer goes. */
  text: string;
  answer: string;
  /** Other ways of writing the real answer (a lie matching one is turned away). */
  alternates: string[];
  /** Believable wrong answers the house adds when players are short of lies. */
  decoys: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  explanation?: string;
  /** A URL or citation for the fact. */
  reference?: string;
}

/** A Sketch It prompt to draw. */
export interface SketchPrompt extends Base {
  text: string;
}

/** An Odd One Out pair: everyone gets `word` except the odd one out. */
export interface OddPair extends Base {
  /** What everyone else gets. */
  word: string;
  /** What the odd one out gets in "similar word" mode. */
  decoy: string;
}

/** A Hot Takes question: vote for a player ("who"), or rate on a 0–10 scale. */
export interface HotTake extends Base {
  kind: 'who' | 'scale';
  text: string;
  low?: string;
  high?: string;
}

export interface Pack {
  id: string;
  title: string;
  source: string;
  license: string;
  attribution?: string;
  quip?: QuipPrompt[];
  bluff?: BluffQuestion[];
  sketch?: SketchPrompt[];
  oddone?: OddPair[];
  hottakes?: HotTake[];
}

export interface ContentLibrary {
  quip: QuipPrompt[];
  bluff: BluffQuestion[];
  sketch: SketchPrompt[];
  oddone: OddPair[];
  hottakes: HotTake[];
  /** Ids used in recent games (dealt last). */
  recent: ReadonlySet<string>;
}

export const emptyLibrary = (): ContentLibrary => ({
  quip: [],
  bluff: [],
  sketch: [],
  oddone: [],
  hottakes: [],
  recent: new Set(),
});
