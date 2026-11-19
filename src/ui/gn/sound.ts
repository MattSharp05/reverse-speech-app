/**
 * Little synthesized sounds (no audio files), as in kart-racer (ADR 0004). Muted on request;
 * browsers only start audio after a tap, so the first tap anywhere unlocks it.
 */
type Cue = 'join' | 'start' | 'tick' | 'submit' | 'reveal' | 'win' | 'phase';

let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('gn:muted') === '1';
  } catch {
    return false;
  }
})();

export const isMuted = (): boolean => muted;

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem('gn:muted', value ? '1' : '0');
  } catch {
    // Not remembered.
  }
}

export function unlockSound(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, at: number, length: number, type: OscillatorType = 'triangle', gain = 0.12): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + at);
  amp.gain.setValueAtTime(0.0001, ctx.currentTime + at);
  amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + at + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + length);
  osc.connect(amp).connect(ctx.destination);
  osc.start(ctx.currentTime + at);
  osc.stop(ctx.currentTime + at + length + 0.05);
}

export function play(cue: Cue): void {
  if (muted || !ctx || ctx.state !== 'running') return;
  switch (cue) {
    case 'join':
      tone(660, 0, 0.12);
      tone(990, 0.08, 0.16);
      return;
    case 'start':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, 'square', 0.06));
      return;
    case 'tick':
      tone(1200, 0, 0.05, 'sine', 0.08);
      return;
    case 'submit':
      tone(880, 0, 0.08, 'sine', 0.1);
      return;
    case 'phase':
      tone(440, 0, 0.12, 'triangle', 0.08);
      tone(660, 0.1, 0.16, 'triangle', 0.08);
      return;
    case 'reveal':
      [392, 523, 659].forEach((f, i) => tone(f, i * 0.07, 0.3, 'triangle', 0.1));
      return;
    case 'win':
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3, 'square', 0.06));
      return;
  }
}

export function buzz(ms = 40): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // No vibration (iPhone Safari).
  }
}
