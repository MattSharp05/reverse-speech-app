import type { Message } from './protocol';

/** A room's broadcast channel. Messages reach everyone else in the room, not the sender. */
export interface Channel<M = Message> {
  send(message: M): void;
  onMessage(handler: (message: M) => void): void;
  close(): void;
}

export const supabaseConfigured = (): boolean =>
  Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

/** `?net=local` plays online between tabs of one browser, with no server (for testing). */
export const localNet = (): boolean => new URLSearchParams(location.search).get('net') === 'local';

export const onlineAvailable = (): boolean => localNet() || supabaseConfigured();

/** Room `code`'s channel. `prefix` keeps apart rooms of classic Esrever and Game Night. */
export async function openChannel<M extends { t: string } = Message>(
  code: string,
  prefix = 'esrever',
): Promise<Channel<M>> {
  const name = `${prefix}:${code}`;
  if (localNet()) return localChannel<M>(name);
  const { supabaseChannel } = await import('./supabase');
  return supabaseChannel<M>(name);
}

function localChannel<M>(name: string): Channel<M> {
  const channel = new BroadcastChannel(name);
  return {
    send: (message) => channel.postMessage(message),
    onMessage: (handler) => channel.addEventListener('message', (event) => handler(event.data as M)),
    close: () => channel.close(),
  };
}
