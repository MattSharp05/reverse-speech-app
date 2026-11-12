import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { Channel } from './channel';
import type { Message } from './protocol';

/**
 * Online rooms ride Supabase Realtime Broadcast: room `CODE` is channel `esrever:CODE`.
 * Nothing is stored server-side; a room exists while someone is in it. Loaded only when a
 * player goes online, so it never weighs on the first page load.
 */

/** Sends are queued and paced under Realtime's per-client rate limit. */
const SEND_INTERVAL_MS = 70;
const RATE_LIMITED_RETRY_MS = 600;

export async function supabaseChannel(code: string): Promise<Channel> {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const supabase = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  const channel: RealtimeChannel = supabase.channel(`esrever:${code}`, {
    config: { broadcast: { self: false, ack: false } },
  });
  const handlers: ((message: Message) => void)[] = [];
  channel.on('broadcast', { event: 'm' }, ({ payload }) => {
    for (const handler of handlers) handler(payload as Message);
  });

  let subscribed = false;
  let closed = false;
  const outbox: Message[] = [];
  let draining = false;
  const drain = async () => {
    if (draining || !subscribed) return;
    draining = true;
    while (outbox.length && !closed) {
      const message = outbox[0]!;
      const result = await channel.send({ type: 'broadcast', event: 'm', payload: message });
      if (result === 'rate limited') {
        await new Promise((r) => setTimeout(r, RATE_LIMITED_RETRY_MS));
        continue;
      }
      outbox.shift();
      await new Promise((r) => setTimeout(r, SEND_INTERVAL_MS));
    }
    draining = false;
  };

  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        resolve();
        void drain();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        subscribed = false;
        reject(err ?? new Error(status));
      }
    });
  });

  return {
    send(message) {
      // A newer state replaces any older one still waiting to go.
      if (message.t === 'state') {
        const queued = outbox.findIndex((m) => m.t === 'state');
        if (queued > 0) outbox.splice(queued, 1);
      }
      outbox.push(message);
      void drain();
    },
    onMessage: (handler) => handlers.push(handler),
    close() {
      closed = true;
      void supabase.removeChannel(channel);
    },
  };
}
