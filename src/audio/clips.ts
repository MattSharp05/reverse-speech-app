/**
 * Every clip this device knows about, by id: its own recordings and (online) the ones its
 * friend sent. Samples are mono `SAMPLE_RATE` floats.
 */
const clips = new Map<string, Float32Array>();
const listeners = new Set<(id: string) => void>();

export function getClip(id: string | null | undefined): Float32Array | undefined {
  return id ? clips.get(id) : undefined;
}

export const hasClip = (id: string): boolean => clips.has(id);

export function putClip(id: string, samples: Float32Array): void {
  clips.set(id, samples);
  for (const listener of [...listeners]) listener(id);
}

export function onClip(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function newClipId(owner: string): string {
  return `${owner}-${Math.random().toString(36).slice(2, 10)}`;
}
