import { onClip } from '../audio/clips';
import { stopPlayback } from '../audio/engine';
import { newGame, reduce, ROUNDS, type Action, type GameState, type Seat } from '../game/state';
import { onlineAvailable, openChannel } from '../net/channel';
import { Room } from '../net/room';
import { h, toast } from './dom';
import * as screens from './screens';
import { refreshClipButtons, setClipOwner } from './widgets';

export interface Draft {
  text: string;
  clip: string | null;
}

/** What only this device's screens need: drafts and the "pass the phone" gates. */
export interface UiState {
  /** One phone: this player has taken the phone to lock in their words. */
  ready: [boolean, boolean];
  drafts: [Draft[], Draft[]];
  guess: string;
}

export interface Session {
  kind: 'local' | 'online';
  state: GameState;
  /** Online: this device's seat (null while joining, or when the room is full). One phone: null. */
  me: Seat | null;
  dispatch(action: Action): void;
  room?: Room;
}

export type View =
  | { name: 'home' }
  | { name: 'how' }
  | { name: 'localSetup' }
  | { name: 'onlineSetup'; code?: string }
  | { name: 'connecting'; code: string }
  | { name: 'game' };

const emptyDrafts = (): Draft[] => Array.from({ length: ROUNDS }, () => ({ text: '', clip: null }));
const freshUi = (): UiState => ({ ready: [false, false], drafts: [emptyDrafts(), emptyDrafts()], guess: '' });

const storage = {
  get(store: Storage, key: string): string | null {
    try {
      return store.getItem(key);
    } catch {
      return null;
    }
  },
  set(store: Storage, key: string, value: string): void {
    try {
      store.setItem(key, value);
    } catch {
      // Private mode: nothing remembered.
    }
  },
  remove(store: Storage, key: string): void {
    try {
      store.removeItem(key);
    } catch {
      // Private mode.
    }
  },
};

const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newRoomCode = () =>
  Array.from({ length: 4 }, () => ROOM_LETTERS[Math.floor(Math.random() * ROOM_LETTERS.length)]).join('');
export const cleanCode = (code: string): string =>
  code
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4);

export class App {
  view: View = { name: 'home' };
  session: Session | null = null;
  ui: UiState = freshUi();
  readonly clientId: string;
  private lastKey = '';
  private lastTurn = '';
  private lastScene = '';
  private readonly main: HTMLElement;
  private readonly banner: HTMLElement;
  private unsubscribeRoom: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.clientId = storage.get(sessionStorage, 'esrever:client') ?? Math.random().toString(36).slice(2, 10);
    storage.set(sessionStorage, 'esrever:client', this.clientId);
    setClipOwner(this.clientId);
    this.banner = h('div', { class: 'banner', hidden: true });
    this.main = h('main', { class: 'screen' });
    root.append(this.banner, this.main);
    onClip(() => refreshClipButtons());
    (window as unknown as { __esrever: unknown }).__esrever = this;

    const code = cleanCode(new URLSearchParams(location.search).get('room') ?? '');
    if (code && onlineAvailable()) {
      if (storage.get(sessionStorage, `esrever:hosting:${code}`))
        void this.openRoom(code, true, this.savedName());
      else if (storage.get(sessionStorage, `esrever:joined:${code}`) && this.savedName())
        void this.openRoom(code, false, this.savedName());
      else this.go({ name: 'onlineSetup', code });
    } else {
      this.render();
    }
  }

  savedName(): string {
    return storage.get(localStorage, 'esrever:name') ?? '';
  }

  go(view: View): void {
    stopPlayback();
    this.view = view;
    this.render();
  }

  startLocal(names: [string, string]): void {
    this.ui = freshUi();
    const session: Session = {
      kind: 'local',
      state: newGame('local', names),
      me: null,
      dispatch: (action) => {
        const next = reduce(session.state, action);
        if (next === session.state) return;
        if (action.type === 'rematch') this.ui = freshUi();
        if (action.type === 'lockIn') this.ui.drafts[action.seat] = emptyDrafts();
        session.state = next;
        this.render();
      },
    };
    this.session = session;
    this.go({ name: 'game' });
  }

  async createRoom(name: string): Promise<void> {
    const code = newRoomCode();
    storage.set(sessionStorage, `esrever:hosting:${code}`, '1');
    await this.openRoom(code, true, name);
  }

  async joinRoom(code: string, name: string): Promise<void> {
    storage.set(sessionStorage, `esrever:joined:${code}`, '1');
    await this.openRoom(code, false, name);
  }

  private async openRoom(code: string, host: boolean, name: string): Promise<void> {
    storage.set(localStorage, 'esrever:name', name);
    this.go({ name: 'connecting', code });
    let room: Room;
    try {
      const channel = await openChannel(code);
      room = new Room(channel, { code, clientId: this.clientId, host, name, storage: sessionStorage });
    } catch {
      toast('Couldn’t connect. Check your internet and try again.');
      this.go({ name: 'onlineSetup', code: host ? undefined : code });
      return;
    }
    this.ui = freshUi();
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    history.replaceState(null, '', url);
    const session: Session = {
      kind: 'online',
      get state() {
        return room.state!;
      },
      get me() {
        return room.seat;
      },
      dispatch: (action) => {
        if (action.type === 'lockIn') this.ui.drafts[action.seat] = emptyDrafts();
        room.dispatch(action);
      },
      room,
    };
    this.session = session;
    this.unsubscribeRoom = room.subscribe(() => {
      if (this.view.name === 'connecting' && room.state) this.view = { name: 'game' };
      this.render();
    });
    if (room.state) this.go({ name: 'game' });
  }

  leave(): void {
    const room = this.session?.room;
    if (room) {
      storage.remove(sessionStorage, `esrever:hosting:${room.code}`);
      storage.remove(sessionStorage, `esrever:joined:${room.code}`);
      storage.remove(sessionStorage, `esrever:host:${room.code}`);
      this.unsubscribeRoom?.();
      room.close();
      const url = new URL(location.href);
      url.searchParams.delete('room');
      history.replaceState(null, '', url);
    }
    this.session = null;
    this.ui = freshUi();
    this.go({ name: 'home' });
  }

  /** A key for what's on screen: the screen is rebuilt only when it changes (so typing isn't lost). */
  private key(): string {
    const s = this.session?.state;
    if (this.view.name !== 'game' || !this.session || !s) return JSON.stringify(this.view);
    const room = this.session.room;
    return JSON.stringify([
      s.phase,
      s.round,
      s.turn,
      s.revealed,
      s.mimic,
      s.names,
      s.words.map((w) => w !== null),
      s.guesses.map((g) => g.counted),
      this.session.me,
      room?.status,
      room && s.phase === 'lobby' ? [room.peerOnline(), room.guestJoined()] : null,
      this.ui.ready,
    ]);
  }

  render(): void {
    this.renderBanner();
    const key = this.key();
    if (key === this.lastKey) return;
    const s = this.session?.state;
    const turn = s ? `${s.phase}|${s.round}|${s.turn}` : '';
    if (turn !== this.lastTurn) this.ui.guess = '';
    // Fade in only on a new screen, not when the same one is rebuilt (a copy recorded, a clip in).
    const scene = JSON.stringify([
      this.view.name,
      turn,
      s?.revealed,
      s?.words.map((w) => w !== null),
      this.ui.ready,
    ]);
    this.main.classList.toggle('still', scene === this.lastScene);
    this.lastScene = scene;
    this.lastTurn = turn;
    this.lastKey = key;
    stopPlayback();
    this.main.replaceChildren(screens.render(this));
    this.main.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  private renderBanner(): void {
    const room = this.session?.room;
    const s = room?.state;
    const show =
      this.view.name === 'game' &&
      room &&
      s &&
      s.phase !== 'lobby' &&
      room.seat !== null &&
      !room.peerOnline();
    this.banner.hidden = !show;
    if (show) this.banner.textContent = `Waiting for ${s.names[room.seat === 0 ? 1 : 0]} to reconnect…`;
  }
}
