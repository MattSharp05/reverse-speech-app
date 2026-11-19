import { onClip } from '../../audio/clips';
import { stopPlayback, unlock } from '../../audio/engine';
import {
  customPacks,
  loadLibrary,
  parseCsvPack,
  parsePack,
  rememberUsed,
  saveCustomPacks,
} from '../../content/library';
import type { ContentLibrary, Pack } from '../../content/schema';
import { categories } from '../../content/deal';
import { GAME_IDS, modules } from '../../games/registry';
import { onlineAvailable, openChannel } from '../../net/channel';
import type { GnMessage, PublicRoom } from '../../net/gnProtocol';
import { HostRoom } from '../../net/host';
import { PlayerClient } from '../../net/player';
import type { GameId } from '../../platform/module';
import { MAX_PLAYERS, settingsFor } from '../../platform/room';
import { h, toast } from '../dom';
import { refreshClipButtons, setClipOwner } from '../widgets';
import { avatar, colorOf, draftInput, drafts, GAMES, nameTag, playerMap, startTicker, swap } from './core';
import { bluffUi } from './games/bluff';
import { phoneNote } from './games/common';
import { quipUi } from './games/quip';
import { reverseUi } from './games/reverse';
import { sketchUi } from './games/sketch';
import type { GameUi } from './games/types';
import { qrSvg } from './qr';
import { buzz, isMuted, play, setMuted, unlockSound } from './sound';

const UIS: Record<GameId, GameUi> = { reverse: reverseUi, quip: quipUi, bluff: bluffUi, sketch: sketchUi };

/** Room codes: no look-alike characters (from kart-racer's `ROOM_CODE_ALPHABET`). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () =>
  Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
export const cleanGnCode = (text: string) =>
  text
    .toUpperCase()
    .split('')
    .filter((c) => CODE_ALPHABET.includes(c))
    .join('')
    .slice(0, 4);

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private mode.
    }
  },
};
const safeStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: (k) => store.get(k),
  setItem: (k, v) => store.set(k, v),
};
/**
 * A phone's identity lives in this tab's session storage: it survives a refresh (same player,
 * same seat) while two tabs of one browser are two players.
 */
const tabStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: (k) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      // Private mode.
    }
  },
};

type View =
  | { name: 'home' }
  | { name: 'join'; code: string }
  | { name: 'busy'; text: string }
  | { name: 'tv' }
  | { name: 'phone' };

/** Game Night: the TV (host display) and the phone (controller) in one page. */
export class GameNight {
  private view: View = { name: 'home' };
  private host: HostRoom | null = null;
  private library: ContentLibrary | null = null;
  private client: PlayerClient | null = null;
  private readonly root: HTMLElement;
  private lastKey = '';
  private lastScene = '';
  private lastPlayers = 0;
  private lastPhase = '';
  private packsOpen = false;

  constructor(root: HTMLElement) {
    document.body.classList.add('gn');
    this.root = h('main', { class: 'gn-root' });
    root.append(this.root);
    onClip(() => refreshClipButtons());
    document.addEventListener('pointerdown', () => {
      unlockSound();
      void unlock().catch(() => undefined);
    });
    (window as unknown as { __gn: unknown }).__gn = this;
    const params = new URLSearchParams(location.search);
    const tv = cleanGnCode(params.get('tv') ?? '');
    const join = cleanGnCode(params.get('join') ?? '');
    if (tv && store.get(`gn:host:${tv}`)) void this.hostRoom(tv);
    else if (join && tabStorage.getItem(`gn:me:${join}`))
      void this.joinRoom(join, tabStorage.getItem('gn:name') ?? store.get('gn:name') ?? 'Player');
    else if (join) this.go({ name: 'join', code: join });
    else this.render();
  }

  private go(view: View): void {
    this.view = view;
    this.render(true);
  }

  private setUrl(key: 'tv' | 'join' | null, code?: string): void {
    const url = new URL(location.href);
    url.searchParams.delete('tv');
    url.searchParams.delete('join');
    if (key && code) url.searchParams.set(key, code);
    history.replaceState(null, '', url);
  }

  // ---- Hosting -------------------------------------------------------------------------

  async hostRoom(code = newCode()): Promise<void> {
    if (!onlineAvailable()) return toast('Online play isn’t set up (Supabase env vars missing).');
    this.go({ name: 'busy', text: 'Setting up the room…' });
    try {
      this.library ??= await loadLibrary(safeStorage);
      const channel = await openChannel<GnMessage>(code, 'gn');
      this.host = await HostRoom.open({
        code,
        channel,
        content: this.library,
        storage: safeStorage,
        onGameOver: (used) => rememberUsed(safeStorage, this.library!, used),
      });
    } catch {
      toast('Couldn’t create the room. Check your connection and try again.');
      return this.go({ name: 'home' });
    }
    startTicker(Date.now, true);
    this.setUrl('tv', code);
    this.host.subscribe(() => this.render());
    this.lastPlayers = this.host.room.players.length;
    this.go({ name: 'tv' });
  }

  private closeRoom(): void {
    if (!confirm('Close this Game Night room? Everyone will be disconnected.')) return;
    this.host?.close();
    this.host = null;
    this.setUrl(null);
    this.go({ name: 'home' });
  }

  // ---- Joining -------------------------------------------------------------------------

  async joinRoom(code: string, name: string): Promise<void> {
    if (!onlineAvailable()) return toast('Online play isn’t set up (Supabase env vars missing).');
    store.set('gn:name', name);
    tabStorage.setItem('gn:name', name);
    this.go({ name: 'busy', text: `Joining room ${code}…` });
    try {
      const channel = await openChannel<GnMessage>(code, 'gn');
      this.client = await PlayerClient.open({ code, name, channel, storage: tabStorage });
    } catch {
      toast('Couldn’t connect. Check your internet and try again.');
      return this.go({ name: 'join', code });
    }
    setClipOwner(this.client.id);
    startTicker(() => this.client?.hostNow() ?? Date.now(), false);
    this.setUrl('join', code);
    this.client.subscribe(() => this.render());
    this.go({ name: 'phone' });
  }

  private leaveRoom(): void {
    this.client?.close();
    this.client = null;
    this.setUrl(null);
    this.go({ name: 'home' });
  }

  // ---- Rendering -----------------------------------------------------------------------

  private key(): string {
    if (this.view.name === 'tv' && this.host)
      return JSON.stringify([
        'tv',
        this.host.publicRoom(),
        this.packsOpen,
        isMuted(),
        this.host.room.settings,
      ]);
    if (this.view.name === 'phone' && this.client) {
      const c = this.client;
      const room = c.room;
      const game = room?.game;
      const view = game?.view as Record<string, unknown> | undefined;
      const { waiting: _w, scores: _s, gained: _g, ...phoneView } = view ?? {};
      return JSON.stringify([
        'phone',
        c.status,
        c.connected(),
        room?.players.find((p) => p.id === c.id),
        room?.players.length,
        room?.selected,
        game
          ? {
              id: game.id,
              over: game.over,
              paused: game.paused,
              mine: game.players.includes(c.id),
              phoneView,
            }
          : null,
        game?.over ? room?.result : null,
        c.slot?.view,
        c.hasPending(),
      ]);
    }
    return JSON.stringify(this.view);
  }

  render(force = false): void {
    const key = this.key();
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.sounds();
    const scene = this.scene();
    const mode = this.view.name === 'tv' ? 'tv' : 'phone';
    // A new screen animates in; a re-render of the same one stays still.
    this.root.className = `gn-root gn-${mode}${scene === this.lastScene ? ' still' : ''}`;
    if (scene !== this.lastScene) stopPlayback();
    this.lastScene = scene;
    swap(this.root, this.screen());
  }

  /** What counts as a new screen (it animates in); re-renders of the same one stay put. */
  private scene(): string {
    const room = this.host?.publicRoom() ?? this.client?.room;
    const view = room?.game?.view as
      { phase?: string; round?: number; index?: number; current?: number; matchupIndex?: number } | undefined;
    return JSON.stringify([
      this.view.name,
      room?.game?.id,
      room?.game?.over,
      view?.phase,
      view?.round,
      view?.index,
      view?.matchupIndex,
    ]);
  }

  private sounds(): void {
    const room = this.host?.publicRoom();
    if (!room) return;
    if (room.players.length > this.lastPlayers) play('join');
    this.lastPlayers = room.players.length;
    const phase = room.game
      ? `${room.game.id}:${room.game.over}:${(room.game.view as { phase?: string }).phase}`
      : '';
    if (phase && phase !== this.lastPhase) {
      const p = (room.game!.view as { phase?: string }).phase ?? '';
      if (room.game!.over) play('win');
      else if (!this.lastPhase.startsWith(room.game!.id)) play('start');
      else if (/result|reveal/.test(p)) play('reveal');
      else play('phase');
    }
    this.lastPhase = phase;
  }

  private screen(): HTMLElement {
    switch (this.view.name) {
      case 'home':
        return this.home();
      case 'join':
        return this.joinForm(this.view.code);
      case 'busy':
        return h(
          'div',
          { class: 'gn-center' },
          h('div', { class: 'gn-spinner' }),
          h('p', {}, this.view.text),
        );
      case 'tv':
        return this.tv();
      case 'phone':
        return this.phone();
    }
  }

  private logo(small = false): HTMLElement {
    return h(
      'div',
      { class: `gn-logo${small ? ' small' : ''}` },
      h('span', { class: 'gn-logo-mark', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
      h('span', { class: 'gn-logo-text' }, 'Game Night'),
    );
  }

  private home(): HTMLElement {
    const phoneSized = matchMedia('(max-width: 700px)').matches;
    const hostBtn = h(
      'button',
      {
        class: `gn-btn ${phoneSized ? '' : 'primary'} big`,
        type: 'button',
        'data-testid': 'host',
        onclick: () => void this.hostRoom(),
      },
      '📺 Host on this screen',
    );
    const joinBtn = h(
      'button',
      {
        class: `gn-btn ${phoneSized ? 'primary' : ''} big`,
        type: 'button',
        'data-testid': 'join-start',
        onclick: () => this.go({ name: 'join', code: '' }),
      },
      '📱 Join on my phone',
    );
    return h(
      'div',
      { class: 'gn-home' },
      h(
        'section',
        { class: 'gn-hero' },
        this.logo(),
        h('h1', { class: 'gn-hero-title' }, 'One screen. Everyone’s phones. Four party games.'),
        h(
          'p',
          { class: 'gn-lead' },
          'Open this on a laptop or TV to host. Friends join on their phones with the room code. No apps, no accounts.',
        ),
        h('div', { class: 'gn-hero-actions' }, phoneSized ? [joinBtn, hostBtn] : [hostBtn, joinBtn]),
      ),
      h(
        'section',
        { class: 'gn-cards' },
        GAME_IDS.map((id) => this.card(id)),
      ),
      h(
        'p',
        { class: 'gn-foot' },
        'Just two of you and no TV? ',
        h('a', { href: '?mode=classic', 'data-testid': 'classic' }, 'Play classic Reverse (Esrever)'),
        ' · ',
        h('a', { href: '#credits', onclick: (e: Event) => (e.preventDefault(), this.credits()) }, 'Credits'),
      ),
    );
  }

  private credits(): void {
    alert(
      'Game Night content credits\n\n' +
        '• Original prompts written for Game Night\n' +
        '• Quick, Draw! subjects © Google, CC BY 4.0\n' +
        '• Open Trivia Database (opentdb.com), CC BY-SA 4.0\n' +
        '• Cards Against Humanity (official black cards), CC BY-NC-SA 4.0\n' +
        '• Rumpus (rodwilco/rumpus), AGPL-3.0\n' +
        '• Quiplibre (hyperdriveguy/quiplibre), AGPL-3.0\n' +
        '• Digual Games fallback prompts (argosautomation/digual-games), MIT per README\n' +
        '• Pictionary idioms (nick-aschenbach/game-words), MIT\n\n' +
        'Full list with links: CREDITS.md in the source repository.',
    );
  }

  private card(id: GameId, options: { selected?: boolean; onClick?: () => void } = {}): HTMLElement {
    const g = GAMES[id];
    return h(
      'article',
      {
        class: `gn-card game-${id}${options.selected ? ' selected' : ''}${options.onClick ? ' clickable' : ''}`,
        'data-testid': `card-${id}`,
        onclick: options.onClick,
        role: options.onClick ? 'button' : undefined,
        tabIndex: options.onClick ? 0 : undefined,
      },
      h('div', { class: 'gn-card-art', 'aria-hidden': 'true' }, art(id)),
      h(
        'div',
        { class: 'gn-card-body' },
        h('h3', {}, g.title),
        h('p', { class: 'gn-card-tag' }, g.tagline),
        h('p', { class: 'gn-card-blurb' }, g.blurb),
        h('p', { class: 'gn-card-meta' }, h('span', {}, g.players), h('span', {}, g.minutes)),
        options.onClick
          ? h('span', { class: 'gn-card-cta' }, options.selected ? 'Selected ✓' : 'Select')
          : null,
      ),
    );
  }

  private joinForm(code: string): HTMLElement {
    const codeInput = h('input', {
      class: 'gn-input code',
      value: code,
      placeholder: 'ABCD',
      maxLength: 4,
      autocapitalize: 'characters',
      autocomplete: 'off',
      inputMode: 'text',
      'data-testid': 'join-code',
    });
    codeInput.addEventListener('input', () => (codeInput.value = cleanGnCode(codeInput.value)));
    const nameInput = h('input', {
      class: 'gn-input',
      value: store.get('gn:name') ?? '',
      placeholder: 'Your name',
      maxLength: 14,
      autocomplete: 'nickname',
      enterKeyHint: 'go',
      'data-testid': 'join-name',
    });
    const submit = () => {
      const c = cleanGnCode(codeInput.value);
      const n = nameInput.value.trim();
      if (c.length !== 4) return toast('Enter the 4-character room code from the TV.');
      if (!n) return toast('Enter your name.');
      void this.joinRoom(c, n);
    };
    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    return h(
      'div',
      { class: 'gn-join' },
      this.logo(true),
      h('h1', {}, 'Join the game'),
      h('label', { class: 'gn-field' }, h('span', {}, 'Room code'), codeInput),
      h('label', { class: 'gn-field' }, h('span', {}, 'Name'), nameInput),
      h(
        'button',
        { class: 'gn-btn primary big', type: 'button', onclick: submit, 'data-testid': 'join' },
        'Join',
      ),
      h('button', { class: 'gn-link', type: 'button', onclick: () => this.go({ name: 'home' }) }, '‹ Back'),
    );
  }

  // ---- TV ------------------------------------------------------------------------------

  private joinUrl(code: string): string {
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('join', code);
    if (new URLSearchParams(location.search).get('net') === 'local') url.searchParams.set('net', 'local');
    return url.toString();
  }

  private tvBar(room: PublicRoom): HTMLElement {
    const host = this.host!;
    const game = room.game;
    const muteBtn = h(
      'button',
      {
        class: 'gn-icon-btn',
        type: 'button',
        title: isMuted() ? 'Sound off' : 'Sound on',
        'aria-label': 'Toggle sound',
        onclick: () => (setMuted(!isMuted()), this.render(true)),
      },
      isMuted() ? '🔇' : '🔊',
    );
    const controls = game
      ? game.over
        ? []
        : [
            h(
              'button',
              {
                class: 'gn-btn small',
                type: 'button',
                'data-testid': game.paused ? 'resume' : 'pause',
                onclick: () => host.dispatch({ type: game.paused ? 'resume' : 'pause' }),
              },
              game.paused ? '▶ Resume' : '❚❚ Pause',
            ),
            h(
              'button',
              {
                class: 'gn-btn small',
                type: 'button',
                'data-testid': 'skip',
                onclick: () => host.dispatch({ type: 'skip' }),
              },
              'Skip ⏭',
            ),
            h(
              'button',
              {
                class: 'gn-btn small',
                type: 'button',
                'data-testid': 'end-game',
                onclick: () =>
                  confirm('End this game and go back to the lobby?') && host.dispatch({ type: 'lobby' }),
              },
              'End game',
            ),
          ]
      : [
          h(
            'button',
            {
              class: 'gn-btn small',
              type: 'button',
              'data-testid': 'packs',
              onclick: () => ((this.packsOpen = !this.packsOpen), this.render(true)),
            },
            'Content packs',
          ),
          h(
            'button',
            { class: 'gn-btn small', type: 'button', onclick: () => this.closeRoom() },
            'Close room',
          ),
        ];
    return h(
      'header',
      { class: 'gn-bar' },
      this.logo(true),
      game ? h('span', { class: `gn-bar-game game-${game.id}` }, GAMES[game.id].title) : null,
      h(
        'span',
        { class: 'gn-bar-code' },
        'Join at ',
        h('b', {}, location.host),
        ' · code ',
        h('b', { 'data-testid': 'bar-code' }, room.code),
      ),
      h('div', { class: 'gn-bar-actions' }, controls, muteBtn),
    );
  }

  private tv(): HTMLElement {
    const host = this.host!;
    const room = host.publicRoom();
    const game = room.game;
    let body: HTMLElement;
    if (!game) body = this.lobby(room);
    else if (game.over) body = this.results(room);
    else {
      body = h(
        'div',
        { class: `gn-game game-${game.id}` },
        UIS[game.id].tv({ room, view: game.view, players: playerMap(room), paused: game.paused }),
        game.paused ? h('div', { class: 'gn-paused', 'data-testid': 'paused' }, h('h1', {}, 'Paused')) : null,
      );
    }
    return h(
      'div',
      { class: 'gn-tv-frame' },
      this.tvBar(room),
      body,
      this.packsOpen && !game ? this.packsPanel() : null,
    );
  }

  private lobby(room: PublicRoom): HTMLElement {
    const host = this.host!;
    const url = this.joinUrl(room.code);
    const selected = room.selected;
    const module = modules[selected];
    const enough = room.players.length >= module.minPlayers;
    const settings = settingsFor(host.room, module);
    const library = this.library!;
    const kinds: Partial<Record<GameId, 'quip' | 'bluff' | 'sketch'>> = {
      quip: 'quip',
      bluff: 'bluff',
      sketch: 'sketch',
    };
    const kind = kinds[selected];
    const settingRows = module.settings.map((def) => {
      const options =
        def.key === 'category' && kind
          ? [
              { value: 'any', label: 'Everything' },
              ...categories(library, kind).map((c) => ({
                value: c,
                label: c[0]!.toUpperCase() + c.slice(1),
              })),
            ]
          : def.options;
      const select = h(
        'select',
        { class: 'gn-select', 'data-testid': `setting-${def.key}` },
        options.map((o) =>
          h(
            'option',
            { value: String(o.value), selected: String(settings[def.key]) === String(o.value) },
            o.label,
          ),
        ),
      );
      select.addEventListener('change', () => {
        const option = options.find((o) => String(o.value) === select.value);
        if (option) host.dispatch({ type: 'setting', game: selected, key: def.key, value: option.value });
      });
      return h('label', { class: 'gn-setting' }, h('span', {}, def.label), select);
    });
    const wins = room.wins;
    return h(
      'div',
      { class: 'gn-lobby' },
      h(
        'aside',
        { class: 'gn-join-panel' },
        h('p', { class: 'gn-kicker' }, 'Join on your phone'),
        h('div', { class: 'gn-qr' }, qrSvg(url, `QR code to join room ${room.code}`)),
        h('p', { class: 'gn-join-url' }, location.host),
        h('p', { class: 'gn-kicker' }, 'Room code'),
        h('div', { class: 'gn-code', 'data-testid': 'room-code' }, room.code),
        h(
          'ul',
          { class: 'gn-players', 'data-testid': 'players' },
          room.players.length
            ? room.players.map((p) =>
                h(
                  'li',
                  { class: `gn-player${p.online ? '' : ' away'}`, style: `--pc:${colorOf(p)}` },
                  avatar(p),
                  h('span', { class: 'gn-player-name' }, p.name),
                  p.bot
                    ? h('span', { class: 'gn-bot', title: 'Bot: played by this screen' }, '🤖 bot')
                    : null,
                  wins[p.id]
                    ? h('span', { class: 'gn-trophy', title: 'Games won tonight' }, `🏆 ${wins[p.id]}`)
                    : null,
                  h(
                    'button',
                    {
                      class: 'gn-kick',
                      type: 'button',
                      title: `Remove ${p.name}`,
                      'aria-label': `Remove ${p.name}`,
                      onclick: () =>
                        (p.bot || confirm(`Remove ${p.name} from the room?`)) &&
                        host.dispatch({ type: 'kick', id: p.id }),
                    },
                    '✕',
                  ),
                ),
              )
            : h('li', { class: 'gn-empty' }, 'Waiting for players…'),
        ),
        h(
          'button',
          {
            class: 'gn-btn small',
            type: 'button',
            disabled: room.players.length >= MAX_PLAYERS,
            title: 'A player this screen plays itself, for testing or a small group',
            'data-testid': 'add-bot',
            onclick: () => host.addBot(),
          },
          '🤖 Add a bot',
        ),
      ),
      h(
        'section',
        { class: 'gn-pick' },
        h('h1', { class: 'gn-section-title' }, 'Pick a game'),
        h(
          'div',
          { class: 'gn-cards compact' },
          GAME_IDS.map((id) =>
            this.card(id, {
              selected: id === selected,
              onClick: () => host.dispatch({ type: 'select', game: id }),
            }),
          ),
        ),
        h(
          'div',
          { class: `gn-launch game-${selected}` },
          h('div', { class: 'gn-settings' }, settingRows),
          h(
            'button',
            {
              class: 'gn-btn primary big',
              type: 'button',
              disabled: !enough,
              'data-testid': 'start-game',
              onclick: () => {
                unlockSound();
                host.dispatch({ type: 'start' });
              },
            },
            enough ? `Start ${GAMES[selected].title}` : `Need ${module.minPlayers} players`,
          ),
        ),
      ),
    );
  }

  private results(room: PublicRoom): HTMLElement {
    const host = this.host!;
    const result = room.result;
    const players = playerMap(room);
    if (!result) return h('div', {});
    const winners = result.winners.map((id) => players.get(id)).filter(Boolean);
    const title =
      winners.length === 0
        ? 'Nobody scored!'
        : winners.length === 1
          ? `${winners[0]!.name} wins!`
          : `It’s a tie!`;
    return h(
      'section',
      { class: `gn-results game-${result.game}` },
      h(
        'div',
        { class: 'gn-confetti', 'aria-hidden': 'true' },
        Array.from({ length: 24 }, (_, i) => h('i', { style: `--i:${i}` })),
      ),
      h('p', { class: 'gn-kicker' }, `${GAMES[result.game].title} · final results`),
      h('h1', { class: 'gn-huge', 'data-testid': 'winner' }, title),
      winners.length > 1 ? h('p', { class: 'gn-lead' }, winners.map((w) => w!.name).join(' & ')) : null,
      h(
        'ol',
        { class: 'gn-podium', 'data-testid': 'standings' },
        result.standings.map((row, i) =>
          h(
            'li',
            { class: row.rank === 1 ? 'first' : '', style: `--pc:${colorOf(row)}; --i:${i}` },
            h('span', { class: 'gn-rank' }, `#${row.rank}`),
            avatar(players.get(row.id) ?? { ...row, online: true }, 'md'),
            h('span', { class: 'gn-podium-name' }, row.name),
            h('b', {}, row.score.toLocaleString()),
            room.wins[row.id] ? h('span', { class: 'gn-trophy' }, `🏆 ${room.wins[row.id]}`) : null,
          ),
        ),
      ),
      h(
        'div',
        { class: 'gn-results-actions' },
        h(
          'button',
          {
            class: 'gn-btn primary big',
            type: 'button',
            'data-testid': 'play-again',
            onclick: () => host.dispatch({ type: 'restart' }),
          },
          'Play again',
        ),
        h(
          'button',
          {
            class: 'gn-btn big',
            type: 'button',
            'data-testid': 'to-lobby',
            onclick: () => host.dispatch({ type: 'lobby' }),
          },
          'Back to Game Night',
        ),
      ),
    );
  }

  private packsPanel(): HTMLElement {
    const packs = customPacks(safeStorage);
    const file = h('input', {
      type: 'file',
      accept: '.json,.csv,application/json,text/csv',
      'data-testid': 'pack-file',
    });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const text = await f.text();
      const id = f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'custom';
      let pack: Pack | null = null;
      try {
        pack = f.name.endsWith('.csv') ? parseCsvPack(text, id) : parsePack(JSON.parse(text), id);
      } catch {
        pack = null;
      }
      if (!pack) return toast('That file has no prompts Game Night can use.');
      saveCustomPacks(safeStorage, [...packs.filter((p) => p.id !== pack!.id), pack]);
      await this.reloadLibrary();
      toast(`Loaded “${pack.title}”`);
    });
    return h(
      'div',
      { class: 'gn-dialog', role: 'dialog', 'aria-label': 'Content packs' },
      h('h2', {}, 'Content packs'),
      h(
        'p',
        { class: 'gn-hint' },
        `Built in: ${this.library!.quip.length} Quip prompts, ${this.library!.bluff.length} Bluff questions, ${this.library!.sketch.length} drawing prompts. Add your own (JSON or CSV with columns game,text,answer,decoys,category,maturity). Custom packs stay in this browser.`,
      ),
      h(
        'ul',
        { class: 'gn-pack-list' },
        packs.map((p) =>
          h(
            'li',
            {},
            h('b', {}, p.title),
            ` ${(p.quip?.length ?? 0) + (p.bluff?.length ?? 0) + (p.sketch?.length ?? 0)} items`,
            h(
              'button',
              {
                class: 'gn-link',
                type: 'button',
                onclick: async () => {
                  saveCustomPacks(
                    safeStorage,
                    packs.filter((x) => x.id !== p.id),
                  );
                  await this.reloadLibrary();
                },
              },
              'Remove',
            ),
          ),
        ),
      ),
      h('label', { class: 'gn-btn' }, 'Load a pack file…', file),
      h(
        'button',
        {
          class: 'gn-btn primary',
          type: 'button',
          onclick: () => ((this.packsOpen = false), this.render(true)),
        },
        'Done',
      ),
    );
  }

  private async reloadLibrary(): Promise<void> {
    const fresh = await loadLibrary(safeStorage);
    if (this.library) Object.assign(this.library, fresh);
    this.render(true);
  }

  // ---- Phone ---------------------------------------------------------------------------

  private phone(): HTMLElement {
    const c = this.client!;
    const room = c.room;
    const me = room?.players.find((p) => p.id === c.id);
    const banner = c.connected()
      ? null
      : h('div', { class: 'gn-offline', 'data-testid': 'offline' }, 'Reconnecting to the TV…');
    let body: HTMLElement;
    if (c.status === 'kicked') {
      body = phoneNote('🚪', 'You were removed from this room', null, 'kicked');
    } else if (c.status === 'full') {
      body = phoneNote('🙈', 'This room is full', 'Ten players is the limit.');
    } else if (!room || !me) {
      body = phoneNote(
        '📡',
        `Joining room ${c.code}…`,
        room ? 'Almost there.' : 'Looking for the TV. Is the room code right?',
        'joining',
      );
    } else if (!room.game) {
      body = this.phoneLobby(room, me.id);
    } else if (room.game.over) {
      const row = room.result?.standings.find((r) => r.id === me.id);
      const won = room.result?.winners.includes(me.id);
      if (won) buzz(200);
      body = phoneNote(
        won ? '🏆' : '🎉',
        won ? 'You won!' : row ? `You came #${row.rank}` : 'Game over',
        row ? `${row.score.toLocaleString()} points` : 'Look at the TV',
        'phone-result',
      );
    } else if (!room.game.players.includes(me.id)) {
      body = phoneNote('⏭️', 'Game in progress', 'You’ll be in the next one. Watch the TV!', 'spectating');
    } else {
      const ui = UIS[room.game.id];
      body = ui.phone({
        room,
        view: room.game.view,
        priv: c.slot?.view ?? null,
        me,
        players: playerMap(room),
        paused: room.game.paused,
        sending: c.hasPending(),
        send: (action) => c.dispatch({ type: 'play', action }),
      });
    }
    return h(
      'div',
      { class: `gn-phone-frame${room?.game ? ` game-${room.game.id}` : ''}` },
      banner,
      h(
        'header',
        { class: 'gn-phone-bar' },
        me ? h('span', { class: 'gn-me' }, avatar(me, 'sm'), nameTag(me)) : this.logo(true),
        room?.game ? h('span', { class: 'gn-bar-game' }, GAMES[room.game.id].title) : null,
        h('span', {
          class: `gn-dot${c.connected() ? ' on' : ''}`,
          title: c.connected() ? 'Connected' : 'Reconnecting',
        }),
      ),
      h('div', { class: 'gn-phone-body' }, body),
    );
  }

  private phoneLobby(room: PublicRoom, me: string): HTMLElement {
    const c = this.client!;
    const player = room.players.find((p) => p.id === me)!;
    const key = 'rename';
    if (!drafts.has(key)) drafts.set(key, player.name);
    const input = draftInput(key, { maxLength: 14, class: 'gn-input', 'data-testid': 'rename-input' });
    const save = h('button', { class: 'gn-btn small', type: 'button' }, 'Rename');
    save.addEventListener('click', () => {
      const name = input.value.trim();
      if (name && name !== player.name) {
        c.dispatch({ type: 'rename', name });
        store.set('gn:name', name);
      }
    });
    return h(
      'div',
      { class: 'gn-phone-stack center', 'data-testid': 'phone-lobby' },
      h('div', { class: 'gn-me-big', style: `--pc:${colorOf(player)}` }, avatar(player, 'lg')),
      h('h2', {}, 'You’re in!'),
      h(
        'p',
        { class: 'gn-hint' },
        `${room.players.length} player${room.players.length === 1 ? '' : 's'} here. The host is picking a game: `,
        h('b', {}, GAMES[room.selected].title),
        '.',
      ),
      h('div', { class: 'gn-answer-row' }, input, save),
      h(
        'button',
        { class: 'gn-link', type: 'button', onclick: () => confirm('Leave this room?') && this.leaveRoom() },
        'Leave room',
      ),
    );
  }
}

/** Each game's card illustration: simple shapes in its colours. */
function art(id: GameId): HTMLElement {
  const svg = (inner: string) => {
    const el = h('div', { class: 'gn-art' });
    el.innerHTML = `<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    return el;
  };
  switch (id) {
    case 'reverse':
      return svg(
        '<rect x="22" y="28" width="86" height="50" rx="25" fill="var(--a)"/><path d="M48 78 l-6 16 18-16z" fill="var(--a)"/>' +
          '<rect x="92" y="42" width="86" height="50" rx="25" fill="var(--a2)"/><path d="M152 92 l6 16 -18-16z" fill="var(--a2)"/>' +
          '<path d="M44 53 h40 m-10 -8 l10 8 -10 8" stroke="#0d0f14" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<path d="M156 67 h-40 m10 -8 l-10 8 10 8" stroke="#0d0f14" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
      );
    case 'quip':
      return svg(
        '<rect x="14" y="22" width="78" height="60" rx="16" fill="var(--a)" transform="rotate(-6 53 52)"/>' +
          '<rect x="108" y="30" width="78" height="60" rx="16" fill="var(--a2)" transform="rotate(6 147 60)"/>' +
          '<circle cx="40" cy="50" r="5" fill="#0d0f14"/><circle cx="56" cy="48" r="5" fill="#0d0f14"/><circle cx="72" cy="46" r="5" fill="#0d0f14"/>' +
          '<circle cx="100" cy="58" r="21" fill="#0d0f14"/>' +
          '<text x="100" y="66" text-anchor="middle" font-size="21" font-weight="800" fill="#f3f4f7">VS</text>',
      );
    case 'bluff':
      return svg(
        '<rect x="34" y="18" width="62" height="86" rx="10" fill="var(--a2)" transform="rotate(-10 65 61)"/>' +
          '<rect x="104" y="18" width="62" height="86" rx="10" fill="var(--a)" transform="rotate(10 135 61)"/>' +
          '<text x="65" y="76" text-anchor="middle" font-size="46" font-weight="800" fill="#0d0f14" transform="rotate(-10 65 61)">?</text>' +
          '<text x="135" y="76" text-anchor="middle" font-size="46" font-weight="800" fill="#0d0f14" transform="rotate(10 135 61)">!</text>',
      );
    case 'sketch':
      return svg(
        '<rect x="30" y="16" width="140" height="92" rx="10" fill="#f3f4f7"/>' +
          '<path d="M48 82 C 62 40, 80 40, 92 70 S 124 96, 150 38" stroke="var(--a)" stroke-width="7" fill="none" stroke-linecap="round"/>' +
          '<circle cx="64" cy="40" r="9" fill="none" stroke="var(--a2)" stroke-width="5"/>' +
          '<path d="M140 90 l26 -26 8 8 -26 26 -12 4z" fill="var(--a2)"/>',
      );
  }
}
