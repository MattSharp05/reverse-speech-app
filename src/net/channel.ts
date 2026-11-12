import type { Message } from './protocol';

/** A room's broadcast channel. Messages reach everyone else in the room, not the sender. */
export interface Channel {
  send(message: Message): void;
  onMessage(handler: (message: Message) => void): void;
  close(): void;
}

export const supabaseConfigured = (): boolean =>
  Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

/** `?net=local` plays online between tabs of one browser, with no server (for testing). */
export const localNet = (): boolean => new URLSearchParams(location.search).get('net') === 'local';

export const onlineAvailable = (): boolean => localNet() || supabaseConfigured();

export async function openChannel(code: string): Promise<Channel> {
  if (localNet()) return localChannel(code);
  const { supabaseChannel } = await import('./supabase');
  return supabaseChannel(code);
}

function localChannel(code: string): Channel {
  const channel = new BroadcastChannel(`esrever:${code}`);
  return {
    send: (message) => channel.postMessage(message),
    onMessage: (handler) => channel.addEventListener('message', (event) => handler(event.data as Message)),
    close: () => channel.close(),
  };
}
