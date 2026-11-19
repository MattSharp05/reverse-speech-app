import type { GameId, PlayerId } from '../../platform/module';
import type { PublicPlayer, PublicRoom } from '../../net/gnProtocol';
import { h } from '../dom';
import { play } from './sound';

export const PLAYER_COLORS = [
  '#ff6b6b',
  '#ffa94d',
  '#ffd43b',
  '#69db7c',
  '#38d9a9',
  '#4dabf7',
  '#748ffc',
  '#b197fc',
  '#f783ac',
  '#a9e34b',
];

export interface GameInfo {
  id: GameId;
  title: string;
  tagline: string;
  blurb: string;
  players: string;
  minutes: string;
}

export const GAMES: Record<GameId, GameInfo> = {
  reverse: {
    id: 'reverse',
    title: 'Reverse',
    tagline: 'Say it backwards.',
    blurb: 'Record secret words, then decode each other’s backwards recordings by copying the sound.',
    players: '2–10 players',
    minutes: '10–15 min',
  },
  quip: {
    id: 'quip',
    title: 'Quip Battle',
    tagline: 'Write. Vote. Laugh.',
    blurb: 'Two players answer each ridiculous prompt. Everyone else picks the funnier one.',
    players: '3–10 players',
    minutes: '15–20 min',
  },
  bluff: {
    id: 'bluff',
    title: 'Bluff It',
    tagline: 'Make up lies. Fool your friends.',
    blurb: 'Invent believable fake answers to strange trivia, then find the real one among them.',
    players: '2–10 players',
    minutes: '10–20 min',
  },
  sketch: {
    id: 'sketch',
    title: 'Sketch It',
    tagline: 'Bad drawings. Great laughs.',
    blurb: 'Draw an absurd prompt, then trick everyone with fake titles for each other’s doodles.',
    players: '3–10 players',
    minutes: '15–20 min',
  },
};

export const colorOf = (p: { color: number } | undefined): string => PLAYER_COLORS[(p?.color ?? 0) % PLAYER_COLORS.length]!;

export function playerMap(room: PublicRoom): Map<PlayerId, PublicPlayer> {
  return new Map(room.players.map((p) => [p.id, p]));
}

/** A round avatar with the player's initial in their colour. */
export function avatar(p: PublicPlayer | undefined, size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
  return h(
    'span',
    { class: `gn-avatar ${size}${p && !p.online ? ' away' : ''}`, style: `--pc:${colorOf(p)}` },
    (p?.name ?? '?').slice(0, 1).toUpperCase(),
  );
}

export function nameTag(p: PublicPlayer | undefined): HTMLElement {
  return h('span', { class: 'gn-name', style: `--pc:${colorOf(p)}` }, p?.name ?? 'Someone');
}

/** A countdown to `deadline` (host clock). The ticker below keeps every one up to date. */
export function timer(deadline: number | null, paused = false, big = false): HTMLElement | null {
  if (deadline === null) return null;
  return h(
    'div',
    {
      class: `gn-timer${big ? ' big' : ''}${paused ? ' paused' : ''}`,
      'data-deadline': String(deadline),
      'data-testid': 'timer',
    },
    h('span', { class: 'gn-timer-num' }, ''),
  );
}

let clock: () => number = Date.now;
let tickSounds = false;
let lastTickSecond = -1;

/** Starts updating countdowns from `hostNow` (TV: its own clock; phones: the TV's). */
export function startTicker(hostNow: () => number, sounds: boolean): void {
  clock = hostNow;
  tickSounds = sounds;
}

function updateTimers(): void {
  const now = clock();
  let lowest = Infinity;
  document.querySelectorAll<HTMLElement>('[data-deadline]').forEach((el) => {
    if (el.classList.contains('paused')) return;
    const deadline = Number(el.dataset.deadline);
    const left = Math.max(0, Math.ceil((deadline - now) / 1000));
    lowest = Math.min(lowest, left);
    const num = el.querySelector('.gn-timer-num');
    if (num && num.textContent !== String(left)) num.textContent = String(left);
    el.classList.toggle('low', left <= 5);
  });
  if (tickSounds && lowest <= 5 && lowest > 0 && lowest !== lastTickSecond) play('tick');
  lastTickSecond = lowest;
}

setInterval(updateTimers, 200);
export const refreshTimers = updateTimers;

/** Text typed on this device, by field, so a re-render never loses it. */
export const drafts = new Map<string, string>();

export function draftInput(
  key: string,
  props: Record<string, unknown> & { multiline?: boolean },
): HTMLInputElement | HTMLTextAreaElement {
  const { multiline, ...rest } = props;
  const el = multiline
    ? h('textarea', { rows: 3, ...rest, 'data-draft': key })
    : h('input', { type: 'text', autocomplete: 'off', ...rest, 'data-draft': key });
  el.value = drafts.get(key) ?? '';
  el.addEventListener('input', () => drafts.set(key, el.value));
  el.addEventListener('focus', () => setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250));
  return el;
}

/** Replaces `root`'s content, keeping the focused draft field focused (and its caret). */
export function swap(root: HTMLElement, next: Node): void {
  const active = document.activeElement as HTMLInputElement | null;
  const key = active?.dataset?.draft;
  const start = active?.selectionStart ?? null;
  root.replaceChildren(next);
  if (key) {
    const again = root.querySelector<HTMLInputElement>(`[data-draft="${CSS.escape(key)}"]`);
    if (again) {
      again.focus({ preventScroll: true });
      if (start !== null) again.setSelectionRange(start, start);
    }
  }
  updateTimers();
}

/** Points a player gained this round, as a bubble. */
export function gainedBadge(points: number | undefined): HTMLElement | null {
  if (!points) return null;
  return h('span', { class: 'gn-gain' }, `+${points.toLocaleString()}`);
}

export function scoreList(room: PublicRoom, scores: Record<PlayerId, number>, gained: Record<PlayerId, number> = {}): HTMLElement {
  const players = playerMap(room);
  const ids = room.game?.players ?? Object.keys(scores);
  const rows = ids
    .map((id) => ({ id, p: players.get(id), score: scores[id] ?? 0 }))
    .filter((r) => r.p)
    .sort((a, b) => b.score - a.score);
  return h(
    'ol',
    { class: 'gn-scores', 'data-testid': 'scores' },
    rows.map((r, i) =>
      h(
        'li',
        { style: `--pc:${colorOf(r.p)}; --i:${i}` },
        avatar(r.p, 'sm'),
        h('span', { class: 'gn-scores-name' }, r.p!.name),
        gainedBadge(gained[r.id]),
        h('b', { class: 'gn-scores-pts' }, (r.score ?? 0).toLocaleString()),
      ),
    ),
  );
}

/** Small avatars of who we're still waiting for. */
export function waitingRow(room: PublicRoom, waiting: PlayerId[], label = 'Waiting for'): HTMLElement | null {
  if (!waiting.length) return null;
  const players = playerMap(room);
  return h(
    'div',
    { class: 'gn-waiting', 'data-testid': 'waiting' },
    h('span', {}, label),
    waiting.map((id) => avatar(players.get(id), 'sm')),
  );
}
