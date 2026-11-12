import { cleanUp, MAX_SECONDS, reversed, SAMPLE_RATE } from './pcm';

/**
 * Microphone and speaker. Phones only allow audio after a tap, so every button that records
 * or plays calls `unlock()` first (iOS also suspends the context after the mic was used).
 */

let context: AudioContext | null = null;

function audioContext(): AudioContext {
  context ??= new AudioContext();
  return context;
}

export async function unlock(): Promise<void> {
  const ctx = audioContext();
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
}

/** Box-filtered resample (good enough for speech, and works on every browser's sample rate). */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input.slice();
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = i * ratio;
    const end = Math.min(input.length, start + Math.max(1, ratio));
    let sum = 0;
    let n = 0;
    for (let j = Math.floor(start); j < end; j++) {
      sum += input[j]!;
      n++;
    }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

/** Linear-interpolated upsample for playback at the device's rate. */
function upsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const a = input[j] ?? 0;
    const b = input[j + 1] ?? a;
    out[i] = a + (b - a) * (x - j);
  }
  return out;
}

export class MicError extends Error {}

export interface Recording {
  /** Stops and returns the cleaned-up clip (silence trimmed, levelled). */
  stop(): Promise<Float32Array>;
  cancel(): void;
  /** Mic level 0–1, for the record button's pulse. */
  level(): number;
}

/**
 * Starts recording. `onLimit` runs when the clip reaches `MAX_SECONDS` (the caller then
 * calls `stop()` as usual).
 */
export async function startRecording(onLimit: () => void): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new MicError('This browser can’t record audio. Try Safari or Chrome.');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    throw new MicError('Microphone blocked. Allow it in your browser settings, then try again.');
  }
  const ctx = audioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);
  const levels = new Float32Array(analyser.fftSize);

  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start();
  const limit = setTimeout(onLimit, MAX_SECONDS * 1000);

  const release = () => {
    clearTimeout(limit);
    source.disconnect();
    // Releasing the mic straight away gives iPhones their loud speaker back.
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    async stop() {
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      release();
      const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type });
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < mono.length; i++) mono[i]! += data[i]! / buffer.numberOfChannels;
      }
      const clip = resample(mono, buffer.sampleRate, SAMPLE_RATE);
      return cleanUp(clip.slice(0, MAX_SECONDS * SAMPLE_RATE));
    },
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
    level() {
      analyser.getFloatTimeDomainData(levels);
      let sum = 0;
      for (const v of levels) sum += v * v;
      return Math.min(1, Math.sqrt(sum / levels.length) * 4);
    },
  };
}

let playing: { source: AudioBufferSourceNode; done: () => void } | null = null;

export function stopPlayback(): void {
  if (!playing) return;
  const { source, done } = playing;
  playing = null;
  source.onended = null;
  try {
    source.stop();
  } catch {
    // Already stopped.
  }
  done();
}

/** Plays a clip (stopping whatever was playing); resolves when it ends or is stopped. */
export async function play(samples: Float32Array, options: { reverse?: boolean } = {}): Promise<void> {
  stopPlayback();
  await unlock();
  const ctx = audioContext();
  const data = upsample(options.reverse ? reversed(samples) : samples, SAMPLE_RATE, ctx.sampleRate);
  const buffer = ctx.createBuffer(1, Math.max(1, data.length), ctx.sampleRate);
  buffer.copyToChannel(new Float32Array(data), 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  return new Promise<void>((resolve) => {
    const entry = { source, done: resolve };
    playing = entry;
    source.onended = () => {
      if (playing === entry) playing = null;
      resolve();
    };
    source.start();
  });
}
