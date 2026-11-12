/**
 * Clips are mono 16 kHz Float32 samples: plenty for speech, and small enough to send to a
 * friend's phone (32 KB a second as 16-bit).
 */
export const SAMPLE_RATE = 16000;

/** Longest recording, seconds. One word fits easily; a cap keeps clips small online. */
export const MAX_SECONDS = 4;

/** Silence trim: 10 ms windows, kept from the first to the last one this loud vs the peak. */
const TRIM_WINDOW = SAMPLE_RATE / 100;
const TRIM_RELATIVE = 0.08;
const TRIM_ABSOLUTE = 0.004;
/** Kept around the speech so it doesn't start or end on a click, seconds. */
const TRIM_PAD_SECONDS = 0.08;
const NORMALIZE_PEAK = 0.9;
const FADE_SECONDS = 0.01;

export function reversed(samples: Float32Array): Float32Array {
  return samples.slice().reverse();
}

/**
 * Cuts the silence before and after the word. Reversed audio sounds far better without it:
 * otherwise the guesser hears the room tone first and the word last.
 */
export function trimSilence(samples: Float32Array): Float32Array {
  const windows = Math.ceil(samples.length / TRIM_WINDOW);
  const rms = new Float32Array(windows);
  let peak = 0;
  for (let w = 0; w < windows; w++) {
    let sum = 0;
    const end = Math.min(samples.length, (w + 1) * TRIM_WINDOW);
    for (let i = w * TRIM_WINDOW; i < end; i++) sum += samples[i]! * samples[i]!;
    rms[w] = Math.sqrt(sum / (end - w * TRIM_WINDOW));
    peak = Math.max(peak, rms[w]!);
  }
  const threshold = Math.max(TRIM_ABSOLUTE, peak * TRIM_RELATIVE);
  const first = rms.findIndex((v) => v >= threshold);
  if (first < 0) return samples.slice();
  let last = windows - 1;
  while (last > first && rms[last]! < threshold) last--;
  const pad = Math.round(TRIM_PAD_SECONDS * SAMPLE_RATE);
  const start = Math.max(0, first * TRIM_WINDOW - pad);
  const end = Math.min(samples.length, (last + 1) * TRIM_WINDOW + pad);
  return samples.slice(start, end);
}

/** Scales to a common loudness and fades the ends, so every clip plays at about the same volume. */
export function normalize(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const out = samples.slice();
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i]! / peak) * NORMALIZE_PEAK;
  const fade = Math.min(Math.round(FADE_SECONDS * SAMPLE_RATE), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    const gain = i / fade;
    out[i]! *= gain;
    out[out.length - 1 - i]! *= gain;
  }
  return out;
}

export const cleanUp = (samples: Float32Array): Float32Array => normalize(trimSilence(samples));

/** 16-bit little-endian PCM as base64, for sending. */
export function encode(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, Math.round(v * 0x7fff), true);
  }
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

export function decode(base64: string): Float32Array {
  const binary = atob(base64);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) view.setUint8(i, binary.charCodeAt(i));
  const samples = new Float32Array(Math.floor(binary.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 0x7fff;
  return samples;
}
