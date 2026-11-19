import { WORD_MAX } from '../../../games/reverse/rules';
import type { PlayerId } from '../../../platform/module';
import { h, toast } from '../../dom';
import { playButton, recordButton } from '../../widgets';
import { avatar, draftInput, drafts, gainedBadge, nameTag, scoreList, waitingRow } from '../core';
import { choiceButton, lookUp, phoneHead, phoneNote, tvHead } from './common';
import type { GameUi, PhoneCtx, TvCtx } from './types';

interface AttemptView {
  guesser: PlayerId;
  owner: PlayerId;
  done: boolean;
  copied: boolean;
  word: string | null;
  wordClip: string | null;
  guess: string | null;
  mimic: string | null;
  correct: boolean | null;
  counted: boolean | null;
}

interface View {
  phase: 'record' | 'guess' | 'reveal' | 'done';
  deadline: number | null;
  round: number;
  rounds: number;
  locked: PlayerId[];
  attempts: AttemptView[];
  waiting: PlayerId[];
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
}

interface Priv {
  words: number;
  locked: boolean;
  attempt: { clip: string; owner: PlayerId; mimic: string | null; guess: string | null } | null;
  canCount: { attempt: number; guess: string; word: string; guesser: PlayerId }[];
}

function tv({ room, view: v, players, paused }: TvCtx<View>): HTMLElement {
  const round = `Round ${v.round + 1} of ${v.rounds}`;
  switch (v.phase) {
    case 'record':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead('Reverse', 'Record your secret words on your phone', v.deadline, paused),
        h(
          'ol',
          { class: 'gn-steps' },
          h('li', {}, 'Type a word and record yourself saying it. Keep it quiet!'),
          h('li', {}, 'Each round you get someone else’s word, played backwards.'),
          h('li', {}, 'Copy the sound, flip your copy, and guess the word.'),
        ),
        waitingRow(room, v.waiting, 'Still recording:'),
      );
    case 'guess':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(round, 'Decode your backwards word!', v.deadline, paused),
        h(
          'div',
          { class: 'gn-attempts' },
          v.attempts.map((a, i) =>
            h(
              'article',
              { class: `gn-attempt${a.done ? ' done' : ''}`, style: `--i:${i}` },
              avatar(players.get(a.guesser), 'md'),
              h(
                'p',
                {},
                nameTag(players.get(a.guesser)),
                ' is decoding ',
                nameTag(players.get(a.owner)),
                '’s word',
              ),
              h(
                'span',
                { class: 'gn-attempt-state' },
                a.done ? 'Guessed ✓' : a.copied ? 'Copied 🎙️' : 'Listening 👂',
              ),
            ),
          ),
        ),
      );
    case 'reveal':
      return h(
        'section',
        { class: 'gn-stage reveal' },
        tvHead(round, 'How did everyone do?', v.deadline, paused),
        h(
          'div',
          { class: 'gn-attempts reveal' },
          v.attempts.map((a, i) =>
            h(
              'article',
              {
                class: `gn-attempt ${a.correct || a.counted ? 'right' : 'wrong'}`,
                style: `--i:${i}`,
                'data-testid': 'attempt',
              },
              avatar(players.get(a.guesser), 'md'),
              h(
                'div',
                { class: 'gn-attempt-body' },
                h('p', {}, nameTag(players.get(a.guesser)), ' guessed ', h('b', {}, `“${a.guess ?? '…'}”`)),
                h(
                  'p',
                  { class: 'gn-muted' },
                  nameTag(players.get(a.owner)),
                  '’s word was ',
                  h('b', {}, a.word ?? ''),
                ),
                h(
                  'div',
                  { class: 'gn-attempt-play' },
                  playButton({ label: 'Backwards', clip: a.wordClip, reverse: true, kind: 'gn-play' }),
                  a.mimic
                    ? playButton({ label: 'Copy, flipped', clip: a.mimic, reverse: true, kind: 'gn-play' })
                    : null,
                ),
              ),
              h(
                'span',
                { class: 'gn-verdict' },
                a.correct ? 'Correct!' : a.counted ? 'Counted!' : 'Nope',
                gainedBadge(a.correct || a.counted ? 1 : 0),
              ),
            ),
          ),
        ),
      );
    case 'done':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead('Reverse', 'Scores', null, paused),
        scoreList(room, v.scores, v.gained),
      );
  }
}

/** This phone's clips for its words while recording, by row. */
const wordClips = new Map<string, string>();

function recordWords(v: View, priv: Priv, send: (a: unknown) => void, paused: boolean): HTMLElement {
  const rows = Array.from({ length: priv.words }, (_, i) => i);
  const lock = h(
    'button',
    { class: 'gn-btn primary', type: 'button', 'data-testid': 'lock-in' },
    'Lock in my words',
  );
  const key = (i: number) => `rev-word-${i}`;
  const sync = () => {
    const left = rows.filter((i) => !(drafts.get(key(i)) ?? '').trim() || !wordClips.has(key(i))).length;
    lock.disabled = left > 0;
    lock.textContent = left ? `${left} to go…` : '🔒 Lock in my words';
  };
  const list = rows.map((i) => {
    const input = draftInput(key(i), {
      placeholder: `Word ${i + 1}`,
      maxLength: WORD_MAX,
      autocapitalize: 'none',
      'data-testid': `word-${i}`,
    });
    input.addEventListener('input', sync);
    const listen = () =>
      playButton({ label: '', clip: wordClips.get(key(i)) ?? null, kind: 'icon', testId: `listen-${i}` });
    let slot = listen();
    const rec = recordButton({
      label: 'Record',
      again: 'Redo',
      done: wordClips.has(key(i)),
      testId: `record-${i}`,
      onClip: (id) => {
        wordClips.set(key(i), id);
        const fresh = listen();
        slot.replaceWith(fresh);
        slot = fresh;
        sync();
      },
    });
    return h('li', { class: 'gn-word-row' }, h('span', { class: 'gn-num' }, String(i + 1)), input, rec, slot);
  });
  lock.addEventListener('click', () => {
    const words = rows.map((i) => ({
      text: (drafts.get(key(i)) ?? '').trim(),
      clip: wordClips.get(key(i)) ?? '',
    }));
    if (new Set(words.map((w) => w.text.toLowerCase())).size !== words.length)
      return toast('Use different words.');
    send({ type: 'lockIn', words });
    rows.forEach((i) => {
      drafts.delete(key(i));
      wordClips.delete(key(i));
    });
  });
  sync();
  return h(
    'div',
    { class: 'gn-phone-stack' },
    phoneHead('Your secret words', v.deadline, paused),
    h(
      'p',
      { class: 'gn-hint' },
      'Type each word, tap Record and say it clearly. Short single words work best.',
    ),
    h('ol', { class: 'gn-words' }, list),
    lock,
  );
}

function phone({ view: v, priv, send, paused, sending, players }: PhoneCtx<View, Priv>): HTMLElement {
  if (!priv) return phoneNote('⏳', 'One moment…');
  switch (v.phase) {
    case 'record':
      if (priv.locked) return phoneNote('🔒', 'Words locked in!', 'Waiting for everyone else.', 'locked');
      return recordWords(v, priv, send, paused);
    case 'guess': {
      const a = priv.attempt;
      if (!a) return lookUp('No word for you this round. Watch the TV');
      if (a.guess !== null) return phoneNote('🤞', 'Guess in!', `“${a.guess}”`, 'guessed');
      const key = `rev-guess-${v.round}`;
      const input = draftInput(key, {
        placeholder: 'What’s the word?',
        maxLength: WORD_MAX,
        autocapitalize: 'none',
        'data-testid': 'guess-input',
      });
      const go = h(
        'button',
        { class: 'gn-btn primary', type: 'button', 'data-testid': 'guess', disabled: sending },
        'Guess!',
      );
      const submit = () => {
        const text = input.value.trim();
        if (!text) return toast('Type your guess first.');
        drafts.delete(key);
        send({ type: 'guess', text });
      };
      go.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && submit());
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead(`Decode ${players.get(a.owner)?.name ?? 'their'}’s word`, v.deadline, paused),
        h(
          'ol',
          { class: 'gn-steps phone' },
          h(
            'li',
            {},
            h('b', {}, 'Hear it backwards'),
            playButton({
              label: 'Play backwards',
              clip: a.clip,
              reverse: true,
              kind: 'gn-play',
              testId: 'play-reversed',
            }),
          ),
          h(
            'li',
            {},
            h('b', {}, 'Copy what you heard'),
            recordButton({
              label: 'Record my copy',
              again: 'Record again',
              done: a.mimic !== null,
              testId: 'record-mimic',
              onClip: (id) => send({ type: 'mimic', clip: id }),
            }),
          ),
          h(
            'li',
            {},
            h('b', {}, 'Hear your copy flipped'),
            playButton({
              label: 'Play it flipped',
              clip: a.mimic,
              reverse: true,
              kind: 'gn-play',
              testId: 'play-mimic',
            }),
          ),
          h('li', {}, h('b', {}, 'Your guess'), h('div', { class: 'gn-answer-row' }, input, go)),
        ),
      );
    }
    case 'reveal':
      if (!priv.canCount.length) return lookUp();
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('Close enough?', v.deadline, paused),
        h('p', { class: 'gn-hint' }, 'Your words: tap one to count a near miss.'),
        h(
          'div',
          { class: 'gn-choices' },
          priv.canCount.map((c) =>
            choiceButton(`${players.get(c.guesser)?.name ?? 'Someone'} said “${c.guess}”`, {
              note: `for “${c.word}”: count it`,
              testId: 'count-it',
              onClick: () => send({ type: 'countIt', attempt: c.attempt }),
            }),
          ),
        ),
      );
    default:
      return lookUp();
  }
}

export const reverseUi: GameUi = { tv, phone };
