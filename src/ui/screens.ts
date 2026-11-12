import { judge } from '../game/match';
import {
  cleanName,
  currentWord,
  lastGuess,
  other,
  ROUNDS,
  scored,
  scores,
  winner,
  type GameState,
  type Seat,
} from '../game/state';
import { onlineAvailable } from '../net/channel';
import { cleanCode, type App } from './app';
import { h, toast } from './dom';
import { playButton, recordButton } from './widgets';

const TITLE = 'Esrever';
const seatClass = (seat: Seat) => `p${seat + 1}`;
const nameTag = (s: GameState, seat: Seat) => h('b', { class: `name ${seatClass(seat)}` }, s.names[seat]);

export function render(app: App): HTMLElement {
  const view = app.view;
  switch (view.name) {
    case 'home':
      return home(app);
    case 'how':
      return how(app);
    case 'localSetup':
      return localSetup(app);
    case 'onlineSetup':
      return onlineSetup(app, view.code);
    case 'connecting':
      return page(
        h(
          'div',
          { class: 'center' },
          h('div', { class: 'spinner' }),
          h('p', {}, `Joining room ${view.code}…`),
        ),
      );
    case 'game':
      return game(app);
  }
}

function page(...children: (Node | null | false)[]): HTMLElement {
  return h('div', { class: 'page' }, ...children);
}

function logo(small = false): HTMLElement {
  // The title, then itself backwards underneath, like the game.
  return h(
    'div',
    { class: `logo${small ? ' small' : ''}` },
    h('h1', {}, ...[...TITLE].map((c, i) => h('span', { class: `c${i % 6}` }, c))),
    !small && h('p', { class: 'tagline' }, 'the say-it-backwards word game'),
  );
}

function back(app: App, label = '‹ Back'): HTMLElement {
  return h('button', { class: 'link back', type: 'button', onclick: () => app.go({ name: 'home' }) }, label);
}

function home(app: App): HTMLElement {
  return page(
    logo(),
    h(
      'div',
      { class: 'blob-row' },
      h('span', { class: 'blob a' }, '🗣️'),
      h('span', { class: 'blob b' }, '🔁'),
      h('span', { class: 'blob c' }, '🤔'),
    ),
    h(
      'div',
      { class: 'stack' },
      h(
        'button',
        { class: 'btn big p1', type: 'button', onclick: () => app.go({ name: 'localSetup' }) },
        '📱 One phone',
      ),
      h(
        'button',
        {
          class: 'btn big p2',
          type: 'button',
          onclick: () =>
            onlineAvailable() ? app.go({ name: 'onlineSetup' }) : toast('Online play isn’t set up yet.'),
        },
        '🌍 Two phones (online)',
      ),
      h(
        'button',
        { class: 'btn ghost', type: 'button', onclick: () => app.go({ name: 'how' }) },
        'How to play',
      ),
    ),
  );
}

function how(app: App): HTMLElement {
  const step = (emoji: string, title: string, text: string) =>
    h(
      'li',
      { class: 'how-step' },
      h('span', { class: 'emoji' }, emoji),
      h('div', {}, h('b', {}, title), h('p', {}, text)),
    );
  return page(
    back(app),
    h('h2', {}, 'How to play'),
    h(
      'ol',
      { class: 'how' },
      step(
        '🤫',
        'Secret words',
        `Each player types ${ROUNDS} words and records themselves saying each one, while the other covers their ears.`,
      ),
      step(
        '🔁',
        'Hear it backwards',
        'On your turn you hear your friend’s word played in reverse. “Cat” comes out like “tac”.',
      ),
      step('🦜', 'Copy it', 'Record yourself copying that backwards sound as well as you can.'),
      step('🪄', 'Flip it back', 'Your copy gets reversed. It should sound a lot like the real word…'),
      step('✏️', 'Guess', 'Type what you think the word is. Right answers score a point.'),
      step(
        '🏆',
        'Win',
        `${ROUNDS} rounds each. Most correct guesses wins. Near misses? The word’s owner can count them.`,
      ),
    ),
    h(
      'p',
      { class: 'hint' },
      'Tip: short, single words with strong sounds work best. Speak close to the phone.',
    ),
    h('button', { class: 'btn big p1', type: 'button', onclick: () => app.go({ name: 'home' }) }, 'Got it'),
  );
}

function field(label: string, input: HTMLInputElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function textInput(props: Record<string, unknown>): HTMLInputElement {
  return h('input', {
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'words',
    spellcheck: false,
    enterKeyHint: 'next',
    maxLength: 16,
    ...props,
  });
}

function localSetup(app: App): HTMLElement {
  const a = textInput({ placeholder: 'Player 1', 'data-testid': 'name-1' });
  const b = textInput({ placeholder: 'Player 2', 'data-testid': 'name-2' });
  const start = () => app.startLocal([cleanName(a.value, 0), cleanName(b.value, 1)]);
  b.addEventListener('keydown', (e) => e.key === 'Enter' && start());
  return page(
    back(app),
    h('h2', {}, 'Who’s playing?'),
    h('div', { class: 'card stack' }, field('Player 1', a), field('Player 2', b)),
    h('button', { class: 'btn big p1', type: 'button', onclick: start, 'data-testid': 'start' }, 'Let’s go!'),
  );
}

function onlineSetup(app: App, code?: string): HTMLElement {
  const name = textInput({ placeholder: 'Your name', value: app.savedName(), 'data-testid': 'online-name' });
  const codeInput = textInput({
    placeholder: 'ABCD',
    value: code ?? '',
    maxLength: 4,
    autocapitalize: 'characters',
    class: 'code-input',
    'data-testid': 'room-code',
  });
  codeInput.addEventListener('input', () => (codeInput.value = cleanCode(codeInput.value)));
  const needName = () => {
    if (name.value.trim()) return name.value.trim().slice(0, 16);
    name.focus();
    toast('Pop your name in first.');
    return null;
  };
  const create = () => {
    const n = needName();
    if (n) void app.createRoom(n);
  };
  const join = () => {
    const n = needName();
    if (!n) return;
    const c = cleanCode(codeInput.value);
    if (c.length !== 4) return toast('Room codes are 4 letters.');
    void app.joinRoom(c, n);
  };
  const joinCard = h(
    'div',
    { class: 'card stack' },
    h('h3', {}, code ? `Join room ${code}` : 'Join a friend'),
    !code && field('Room code', codeInput),
    h('button', { class: 'btn big p2', type: 'button', onclick: join, 'data-testid': 'join' }, 'Join room'),
  );
  const createCard = h(
    'div',
    { class: 'card stack' },
    h('h3', {}, 'Start a game'),
    h('p', { class: 'hint' }, 'You’ll get a link to send your friend.'),
    h(
      'button',
      { class: 'btn big p1', type: 'button', onclick: create, 'data-testid': 'create' },
      'Create a room',
    ),
  );
  return page(
    back(app),
    h('h2', {}, 'Play online'),
    h('div', { class: 'card stack' }, field('Your name', name)),
    ...(code ? [joinCard] : [createCard, h('div', { class: 'or' }, 'or'), joinCard]),
  );
}

function topBar(app: App, s: GameState): HTMLElement {
  const [a, b] = scores(s);
  const showScores = s.phase === 'play' || s.phase === 'done';
  const leave = () => {
    if (s.phase === 'done' || confirm('Leave this game?')) app.leave();
  };
  return h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'link', type: 'button', onclick: leave, 'data-testid': 'leave' }, '✕'),
    logo(true),
    showScores
      ? h(
          'div',
          { class: 'scores', 'data-testid': 'scores' },
          h('span', { class: 'chip p1' }, `${s.names[0]} ${a}`),
          h('span', { class: 'chip p2' }, `${s.names[1]} ${b}`),
        )
      : h('span', { class: 'spacer' }),
  );
}

function game(app: App): HTMLElement {
  const session = app.session!;
  const s = session.state;
  const room = session.room;
  if (room?.status === 'full') {
    return page(
      h(
        'div',
        { class: 'center' },
        h('div', { class: 'big-emoji' }, '🙈'),
        h('h2', {}, 'This room is full'),
        h('p', {}, 'Two players are already in it.'),
      ),
      h('button', { class: 'btn big p1', type: 'button', onclick: () => app.leave() }, 'Home'),
    );
  }
  const body =
    s.phase === 'lobby'
      ? lobby(app, s)
      : s.phase === 'lockin'
        ? lockIn(app, s)
        : s.phase === 'play'
          ? s.revealed
            ? result(app, s)
            : session.kind === 'online' && session.me !== s.turn
              ? watch(s)
              : guess(app, s)
          : done(app, s);
  return h('div', { class: 'page game' }, topBar(app, s), body);
}

function lobby(app: App, s: GameState): HTMLElement {
  const room = app.session!.room!;
  const host = room.seat === 0;
  const friendHere = room.guestJoined();
  const link = new URL(location.href);
  link.searchParams.set('room', room.code);
  const share = async () => {
    const url = link.toString();
    if (navigator.share) {
      await navigator
        .share({ title: TITLE, text: `Play ${TITLE} with me! Room ${room.code}`, url })
        .catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(url).then(
        () => toast('Link copied'),
        () => toast(url),
      );
    }
  };
  const player = (seat: Seat, here: boolean) =>
    h(
      'li',
      { class: `player ${seatClass(seat)}${here ? '' : ' away'}` },
      h('span', { class: 'avatar' }, here ? s.names[seat][0]?.toUpperCase() : '?'),
      here ? s.names[seat] : 'Waiting for a friend…',
    );
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'card center' },
      h('p', { class: 'hint' }, 'Room code'),
      h('div', { class: 'room-code', 'data-testid': 'lobby-code' }, room.code),
      host && h('button', { class: 'btn p2', type: 'button', onclick: share }, '🔗 Send the link'),
    ),
    h('ul', { class: 'players' }, player(0, true), player(1, friendHere)),
    host
      ? h(
          'button',
          {
            class: 'btn big p1',
            type: 'button',
            disabled: !friendHere,
            onclick: () => app.session!.dispatch({ type: 'start' }),
            'data-testid': 'start-online',
          },
          friendHere ? 'Start the game' : 'Waiting for a friend…',
        )
      : h('p', { class: 'hint center' }, `Waiting for ${s.names[0]} to start…`),
  );
}

/** Which seat is locking in on this device right now (null: waiting for the other phone). */
function lockingSeat(app: App, s: GameState): Seat | null {
  const session = app.session!;
  if (session.kind === 'online') return session.me !== null && !s.words[session.me] ? session.me : null;
  return !s.words[0] ? 0 : !s.words[1] ? 1 : null;
}

function lockIn(app: App, s: GameState): HTMLElement {
  const session = app.session!;
  const seat = lockingSeat(app, s);
  if (seat === null) {
    const waitingFor = s.words[0] ? 1 : 0;
    return h(
      'div',
      { class: 'center stack' },
      h('div', { class: 'big-emoji wobble' }, '🔒'),
      h('h2', {}, 'Your words are locked in!'),
      h('p', {}, 'Waiting for ', nameTag(s, waitingFor), ' to lock in theirs…'),
    );
  }
  if (session.kind === 'local' && !app.ui.ready[seat]) return handoff(app, s, seat);

  const drafts = app.ui.drafts[seat];
  const lockButton = h(
    'button',
    { class: `btn big ${seatClass(seat)}`, type: 'button', 'data-testid': 'lock-in' },
    '🔒 Lock in my words',
  );
  const sync = () => {
    const ready = drafts.every((d) => d.text.trim() && d.clip);
    lockButton.disabled = !ready;
    const left = drafts.filter((d) => !d.text.trim() || !d.clip).length;
    lockButton.textContent = ready ? '🔒 Lock in my words' : `${left} to go…`;
  };
  const rows = drafts.map((draft, i) => {
    const input = textInput({
      value: draft.text,
      placeholder: `Word ${i + 1}`,
      maxLength: 24,
      autocapitalize: 'none',
      'data-testid': `word-${i}`,
    });
    const listen = () => playButton({ label: '', clip: draft.clip, kind: 'icon', testId: `listen-${i}` });
    let playSlot = listen();
    input.addEventListener('input', () => {
      draft.text = input.value;
      sync();
    });
    const rec = recordButton({
      label: 'Record',
      again: 'Redo',
      done: draft.clip !== null,
      testId: `record-${i}`,
      onClip: (id) => {
        draft.clip = id;
        const fresh = listen();
        playSlot.replaceWith(fresh);
        playSlot = fresh;
        sync();
      },
    });
    return h(
      'li',
      { class: 'word-row' },
      h('span', { class: `num ${seatClass(seat)}` }, String(i + 1)),
      input,
      rec,
      playSlot,
    );
  });
  lockButton.addEventListener('click', () => {
    const words = drafts.map((d) => ({ text: d.text.trim(), clip: d.clip! }));
    if (words.some((w) => !w.text || !w.clip)) return;
    if (new Set(words.map((w) => w.text.toLowerCase())).size !== words.length)
      return toast('Use 5 different words.');
    session.dispatch({ type: 'lockIn', seat, words });
  });
  sync();
  return h(
    'div',
    { class: 'stack' },
    h('h2', {}, nameTag(s, seat), '’s secret words'),
    h(
      'p',
      { class: 'hint' },
      'Type each word, then tap Record and say it clearly. Short, single words work best.',
    ),
    h('ol', { class: 'words card' }, rows),
    lockButton,
  );
}

function handoff(app: App, s: GameState, seat: Seat): HTMLElement {
  const friend = other(seat);
  return h(
    'div',
    { class: 'center stack handoff' },
    h('div', { class: 'big-emoji' }, '📱'),
    h('h2', {}, 'Pass the phone to ', nameTag(s, seat)),
    h(
      'div',
      { class: 'card ears' },
      h('span', { class: 'big-emoji' }, '🙉'),
      h('p', {}, nameTag(s, friend), ': no peeking and no listening! Cover your ears or put some music on.'),
    ),
    h(
      'button',
      {
        class: `btn big ${seatClass(seat)}`,
        type: 'button',
        'data-testid': 'ready',
        onclick: () => {
          app.ui.ready[seat] = true;
          app.render();
        },
      },
      `I’m ${s.names[seat]}, let’s go!`,
    ),
  );
}

function roundPill(s: GameState): HTMLElement {
  return h('div', { class: 'round-pill', 'data-testid': 'round' }, `Round ${s.round + 1} of ${ROUNDS}`);
}

function step(n: number, title: string, ...content: (Node | null | false)[]): HTMLElement {
  return h(
    'li',
    { class: 'step' },
    h('span', { class: 'step-num' }, String(n)),
    h('div', { class: 'step-body' }, h('b', {}, title), ...content),
  );
}

/** The guesser's turn: hear it backwards, copy it, hear the copy flipped, guess. */
function guess(app: App, s: GameState): HTMLElement {
  const session = app.session!;
  const seat = s.turn;
  const owner = other(seat);
  const word = currentWord(s)!;
  const input = textInput({
    value: app.ui.guess,
    placeholder: 'What’s the word?',
    autocapitalize: 'none',
    enterKeyHint: 'done',
    maxLength: 24,
    'data-testid': 'guess-input',
  });
  const submit = h(
    'button',
    { class: `btn ${seatClass(seat)}`, type: 'button', 'data-testid': 'guess' },
    'Guess!',
  );
  const send = () => {
    const text = input.value.trim();
    if (!text) return toast('Type your guess first.');
    session.dispatch({ type: 'guess', seat, text });
  };
  input.addEventListener('input', () => (app.ui.guess = input.value));
  input.addEventListener('keydown', (e) => e.key === 'Enter' && send());
  submit.addEventListener('click', send);
  return h(
    'div',
    { class: 'stack' },
    roundPill(s),
    h('h2', { class: 'turn-title' }, nameTag(s, seat), ', guess ', nameTag(s, owner), '’s word'),
    h(
      'ol',
      { class: 'steps card' },
      step(
        1,
        'Hear it backwards',
        playButton({
          label: 'Play backwards',
          clip: word.clip,
          reverse: true,
          kind: seatClass(owner),
          testId: 'play-reversed',
        }),
      ),
      step(
        2,
        'Copy what you heard',
        recordButton({
          label: 'Record my copy',
          again: 'Record again',
          done: s.mimic !== null,
          testId: 'record-mimic',
          onClip: (id) => session.dispatch({ type: 'mimic', seat, clip: id }),
        }),
      ),
      step(
        3,
        'Hear your copy flipped',
        playButton({
          label: 'Play it flipped',
          clip: s.mimic,
          reverse: true,
          kind: seatClass(seat),
          testId: 'play-mimic',
        }),
        !s.mimic && h('p', { class: 'hint' }, 'Record your copy first.'),
      ),
      step(4, 'Your guess', h('div', { class: 'guess-row' }, input, submit)),
    ),
  );
}

/** Online, the other player's turn: follow along and hear their attempt. */
function watch(s: GameState): HTMLElement {
  const guesser = s.turn;
  const me = other(guesser);
  const word = currentWord(s)!;
  return h(
    'div',
    { class: 'stack' },
    roundPill(s),
    h('h2', { class: 'turn-title' }, nameTag(s, guesser), ' is guessing your word'),
    h(
      'div',
      { class: 'card center' },
      h('p', { class: 'hint' }, 'Your word'),
      h('div', { class: 'reveal-word' }, word.text),
    ),
    h(
      'div',
      { class: 'card stack' },
      h(
        'p',
        { class: 'status-line' },
        s.mimic ? `🦜 ${s.names[guesser]} recorded a copy` : `👂 ${s.names[guesser]} is listening…`,
      ),
      playButton({ label: 'Your word backwards', clip: word.clip, reverse: true, kind: seatClass(me) }),
      playButton({
        label: `${s.names[guesser]}’s copy flipped`,
        clip: s.mimic,
        reverse: true,
        kind: seatClass(guesser),
        testId: 'watch-mimic',
      }),
    ),
    h('div', { class: 'center' }, h('div', { class: 'dots' }, h('span', {}), h('span', {}), h('span', {}))),
  );
}

function result(app: App, s: GameState): HTMLElement {
  const session = app.session!;
  const index = s.guesses.length - 1;
  const g = lastGuess(s)!;
  const owner = other(g.guesser);
  const word = s.words[owner]![g.round]!;
  const verdict = judge(g.text, word.text);
  const [emoji, title, kind] = scored(g)
    ? g.correct
      ? ['🎉', 'Correct!', 'yes']
      : ['👍', 'Counted!', 'yes']
    : verdict === 'close'
      ? ['😬', 'So close!', 'close']
      : ['🙃', 'Nope!', 'no'];
  const canCount = !scored(g) && (session.kind === 'local' || session.me === owner);
  const lastTurn = g.guesser === 1 && g.round === ROUNDS - 1;
  const nextLabel = lastTurn
    ? 'See who won 🏆'
    : g.guesser === 0
      ? `${s.names[1]}’s turn →`
      : `Round ${g.round + 2} →`;
  return h(
    'div',
    { class: 'stack' },
    roundPill(s),
    h(
      'div',
      { class: `card center verdict ${kind}`, 'data-testid': 'verdict' },
      h('div', { class: 'big-emoji pop' }, emoji),
      h('h2', {}, title),
      h('p', { class: 'hint' }, 'The word was'),
      h('div', { class: 'reveal-word', 'data-testid': 'answer' }, word.text),
      h('p', {}, nameTag(s, g.guesser), ' guessed “', h('b', {}, g.text), '”'),
    ),
    h(
      'div',
      { class: 'card stack' },
      playButton({ label: `${s.names[owner]} saying it`, clip: word.clip, kind: seatClass(owner) }),
      playButton({
        label: `${s.names[owner]} backwards`,
        clip: word.clip,
        reverse: true,
        kind: seatClass(owner),
      }),
      g.mimic &&
        playButton({
          label: `${s.names[g.guesser]}’s copy flipped`,
          clip: g.mimic,
          reverse: true,
          kind: seatClass(g.guesser),
        }),
    ),
    canCount &&
      h(
        'button',
        {
          class: 'btn ghost',
          type: 'button',
          'data-testid': 'count-it',
          onclick: () => session.dispatch({ type: 'countIt', seat: owner, guess: index }),
        },
        session.kind === 'local'
          ? `${s.names[owner]}: close enough? Count it 👍`
          : 'Close enough? Count it 👍',
      ),
    h(
      'button',
      {
        class: `btn big ${seatClass(lastTurn ? 0 : other(g.guesser))}`,
        type: 'button',
        'data-testid': 'next',
        onclick: () => session.dispatch({ type: 'next', guess: index }),
      },
      nextLabel,
    ),
  );
}

function done(app: App, s: GameState): HTMLElement {
  const session = app.session!;
  const [a, b] = scores(s);
  const win = winner(s);
  const mark = (seat: Seat, round: number) => {
    const g = s.guesses.find((x) => x.guesser === seat && x.round === round);
    const answer = s.words[other(seat)]?.[round]?.text ?? '';
    if (!g) return h('td', {}, '–');
    return h(
      'td',
      { class: scored(g) ? 'hit' : 'miss' },
      h('span', { class: 'mark' }, scored(g) ? '✓' : '✗'),
      h('span', { class: 'answer' }, answer),
      !g.correct && h('span', { class: 'said' }, `“${g.text}”`),
    );
  };
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'card center winner', 'data-testid': 'winner' },
      h('div', { class: 'big-emoji pop' }, win === 'tie' ? '🤝' : '🏆'),
      h('h2', {}, win === 'tie' ? 'It’s a tie!' : `${s.names[win]} wins!`),
      h(
        'div',
        { class: 'final' },
        h('span', { class: 'p1' }, String(a)),
        h('span', { class: 'dash' }, '–'),
        h('span', { class: 'p2' }, String(b)),
      ),
    ),
    h(
      'table',
      { class: 'card recap' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, ''),
          h('th', { class: 'p1' }, s.names[0]),
          h('th', { class: 'p2' }, s.names[1]),
        ),
      ),
      h(
        'tbody',
        {},
        Array.from({ length: ROUNDS }, (_, r) =>
          h('tr', {}, h('th', {}, String(r + 1)), mark(0, r), mark(1, r)),
        ),
      ),
    ),
    h(
      'button',
      {
        class: 'btn big p1',
        type: 'button',
        'data-testid': 'rematch',
        onclick: () => session.dispatch({ type: 'rematch' }),
      },
      'Play again',
    ),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => app.leave() }, 'Home'),
  );
}
