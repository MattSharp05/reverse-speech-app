import type { PublicRoom } from '../../net/gnProtocol';
import { isMuted } from './sound';

/**
 * Background music on the TV, so a Game Night is never silent: a track per kind of moment
 * (lobby, writing, drawing, voting) that crossfades as phases change, stingers for reveals and
 * winners, and a ticking clock over the last seconds of a timer. Files in `public/music/`
 * (credits in CREDITS.md). Phones play none of it.
 */

export type Track = 'lobby' | 'thinking' | 'drawing' | 'voting';
export type Sting = 'reveal' | 'winner' | 'drumroll';

export interface Scene {
  track: Track | null;
  /** 0–1: how loud the track plays relative to the music volume (quieter under recordings). */
  level: number;
  /** A timer runs and the ticking clock may play in its last seconds. */
  timed: boolean;
}

/** Phases by the music they get (the games share phase names where they're alike). */
const PHASE_TRACK: Record<string, Track> = {
  answer: 'thinking',
  lie: 'thinking',
  caption: 'thinking',
  clue: 'thinking',
  write: 'thinking',
  guess: 'thinking',
  record: 'thinking',
  draw: 'drawing',
  vote: 'voting',
  pick: 'voting',
};

/** The ticking clock starts this long before a deadline, ms. */
export const TICK_FROM_MS = 10_000;

/** What should be playing for this room. */
export function sceneFor(room: PublicRoom | null): Scene {
  const game = room?.game;
  if (!game || game.over) return { track: 'lobby', level: 1, timed: false };
  const phase = (game.view as { phase?: string }).phase ?? '';
  const track = PHASE_TRACK[phase] ?? 'lobby';
  let level = game.paused ? 0.3 : 1;
  // Reverse: phones record voices and the TV plays them back, so the music keeps well under.
  if (game.id === 'reverse') level *= phase === 'reveal' ? 0.12 : 0.3;
  return { track, level, timed: track !== 'lobby' && !game.paused };
}

const FADE_MS = 900;
const STEP_MS = 50;
const VOLUME_KEY = 'gn:music-volume';

function storedVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && localStorage.getItem(VOLUME_KEY) !== null
      ? Math.min(1, Math.max(0, v))
      : 0.5;
  } catch {
    return 0.5;
  }
}

class MusicPlayer {
  volume = storedVolume();
  /** The browser refused to start audio before a click (shown as a hint on the TV). */
  blocked = false;
  private readonly tracks = new Map<Track, HTMLAudioElement>();
  private ticking: HTMLAudioElement | null = null;
  private scene: Scene = { track: null, level: 1, timed: false };
  private tickOn = false;
  /** Music dips under a stinger until then (performance.now ms). */
  private duckUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<() => void>();

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    try {
      localStorage.setItem(VOLUME_KEY, String(this.volume));
    } catch {
      // Not remembered.
    }
    this.run();
  }

  /** Plays what `scene` asks for (crossfading), and the ticking clock if `tick`. */
  update(scene: Scene, tick: boolean): void {
    this.scene = scene;
    this.tickOn = tick && scene.timed;
    this.run();
  }

  sting(name: Sting): void {
    if (isMuted() || this.volume === 0) return;
    const audio = new Audio(`/music/${name}.mp3`);
    audio.volume = Math.min(1, this.volume * 1.4);
    void audio.play().catch(() => undefined);
    // Dip the music while it plays.
    this.duckUntil = performance.now() + (name === 'winner' ? 9000 : name === 'drumroll' ? 3500 : 3000);
    this.run();
  }

  /** Called on any click: browsers allow audio once the page has been interacted with. */
  resume(): void {
    if (!this.blocked) return;
    this.blocked = false;
    for (const listener of this.listeners) listener();
    this.run();
  }

  stopAll(): void {
    this.scene = { track: null, level: 0, timed: false };
    this.tickOn = false;
    this.run();
  }

  private audio(track: Track): HTMLAudioElement {
    let audio = this.tracks.get(track);
    if (!audio) {
      audio = new Audio(`/music/${track}.mp3`);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = 0;
      this.tracks.set(track, audio);
    }
    return audio;
  }

  private async start(audio: HTMLAudioElement): Promise<void> {
    if (!audio.paused) return;
    try {
      await audio.play();
    } catch {
      if (!this.blocked) {
        this.blocked = true;
        for (const listener of this.listeners) listener();
      }
    }
  }

  /** One fade step towards the target volumes; keeps stepping until everything has arrived. */
  private run(): void {
    this.timer ??= setInterval(() => this.step(), STEP_MS);
  }

  private step(): void {
    const muted = isMuted();
    const ducked = performance.now() < this.duckUntil ? 0.35 : 1;
    const delta = STEP_MS / FADE_MS;
    let moving = false;
    const wanted = this.scene.track;
    if (wanted && !muted) {
      const audio = this.audio(wanted);
      if (audio.paused && !this.blocked) void this.start(audio);
    }
    for (const [track, audio] of this.tracks) {
      const target = !muted && track === wanted ? this.volume * this.scene.level * ducked : 0;
      const next =
        audio.volume < target
          ? Math.min(target, audio.volume + delta)
          : Math.max(target, audio.volume - delta);
      audio.volume = Math.min(1, Math.max(0, next));
      if (audio.volume === 0 && target === 0 && !audio.paused) audio.pause();
      if (Math.abs(audio.volume - target) > 0.001) moving = true;
    }
    // The ticking clock: on or off, no fade.
    const tick = this.tickOn && !muted && this.volume > 0;
    if (tick) {
      this.ticking ??= Object.assign(new Audio('/music/ticking.mp3'), { loop: true });
      this.ticking.volume = Math.min(1, this.volume * 0.9);
      if (this.ticking.paused && !this.blocked) void this.start(this.ticking);
    } else if (this.ticking && !this.ticking.paused) {
      this.ticking.pause();
      this.ticking.currentTime = 0;
    }
    if (!moving && performance.now() >= this.duckUntil && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const music = new MusicPlayer();

if (typeof window !== 'undefined') (window as unknown as { __music: unknown }).__music = music;
