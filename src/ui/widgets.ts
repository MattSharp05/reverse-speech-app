import { getClip, hasClip, newClipId, putClip } from '../audio/clips';
import { MicError, play, startRecording, stopPlayback, unlock, type Recording } from '../audio/engine';
import { MAX_SECONDS } from '../audio/pcm';
import { h, toast } from './dom';

/** Whoever records: the id prefix for clips made on this device. */
let owner = 'local';
export const setClipOwner = (id: string): void => void (owner = id);

let active: { stop(): void } | null = null;

/**
 * A record button: tap to start, tap again to stop (it stops by itself at `MAX_SECONDS`).
 * `onClip` gets the new clip's id once it's cleaned up and stored.
 */
export function recordButton(options: {
  label: string;
  again?: string;
  done?: boolean;
  onClip: (id: string) => void;
  testId?: string;
}): HTMLButtonElement {
  let recording: Recording | null = null;
  let busy = false;
  let frame = 0;
  let started = 0;
  const label = h('span', {}, options.done && options.again ? options.again : options.label);
  const ring = h('span', { class: 'ring' });
  const button = h(
    'button',
    { class: `btn rec${options.done ? ' done' : ''}`, type: 'button', 'data-testid': options.testId },
    ring,
    h('span', { class: 'dot' }),
    label,
  );

  const pulse = () => {
    if (!recording) return;
    const left = Math.max(0, MAX_SECONDS - (performance.now() - started) / 1000);
    ring.style.setProperty('--level', String(recording.level()));
    label.textContent = `Stop (${Math.ceil(left)}s)`;
    frame = requestAnimationFrame(pulse);
  };

  const finish = async () => {
    const current = recording;
    if (!current) return;
    recording = null;
    active = null;
    cancelAnimationFrame(frame);
    button.classList.remove('live');
    busy = true;
    label.textContent = 'Saving…';
    try {
      const samples = await current.stop();
      if (samples.length < 800) throw new MicError('That was too short. Hold on a moment and say it again.');
      const id = newClipId(owner);
      putClip(id, samples);
      button.classList.add('done');
      label.textContent = options.again ?? options.label;
      options.onClip(id);
    } catch (error) {
      label.textContent = options.label;
      toast(error instanceof MicError ? error.message : 'Couldn’t save that recording. Try again.');
    } finally {
      busy = false;
    }
  };

  button.addEventListener('click', async () => {
    if (busy) return;
    if (recording) return void finish();
    active?.stop();
    stopPlayback();
    busy = true;
    try {
      await unlock();
      recording = await startRecording(() => void finish());
      active = { stop: () => void finish() };
      started = performance.now();
      button.classList.add('live');
      pulse();
    } catch (error) {
      toast(error instanceof MicError ? error.message : 'Couldn’t start the microphone.');
    } finally {
      busy = false;
    }
  });
  return button;
}

/**
 * A play button for clip `id` (forwards or reversed). It waits, disabled, for a clip that
 * hasn't arrived yet; `refreshClipButtons()` wakes it when one does.
 */
export function playButton(options: {
  label: string;
  clip: string | null;
  reverse?: boolean;
  kind?: string;
  testId?: string;
}): HTMLButtonElement {
  const label = h('span', {}, options.label);
  const button = h(
    'button',
    {
      class: `btn play ${options.kind ?? ''}`,
      type: 'button',
      'data-clip': options.clip ?? '',
      'data-testid': options.testId,
    },
    h('span', { class: 'tri' }),
    label,
  );
  const sync = () => {
    const ready = options.clip !== null && hasClip(options.clip);
    button.disabled = !ready;
    button.classList.toggle('waiting', options.clip !== null && !ready);
  };
  (button as HTMLButtonElement & { sync?: () => void }).sync = sync;
  sync();
  button.addEventListener('click', async () => {
    const samples = getClip(options.clip);
    if (!samples) return;
    active?.stop();
    if (button.classList.contains('playing')) return stopPlayback();
    document.querySelectorAll('.btn.playing').forEach((b) => b.classList.remove('playing'));
    button.classList.add('playing');
    await play(samples, { reverse: options.reverse });
    button.classList.remove('playing');
  });
  return button;
}

export function refreshClipButtons(): void {
  document
    .querySelectorAll<HTMLButtonElement & { sync?: () => void }>('[data-clip]')
    .forEach((b) => b.sync?.());
}
