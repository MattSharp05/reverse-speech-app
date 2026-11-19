import { CLUE_MAX } from '../../../games/oddone/rules';
import type { PlayerId } from '../../../platform/module';
import { h } from '../../dom';
import { avatar, draftInput, drafts, gainedBadge, nameTag, scoreList, waitingRow } from '../core';
import { answerBox, choiceButton, lookUp, phoneHead, phoneNote, tvHead } from './common';
import type { GameUi, PhoneCtx, TvCtx } from './types';

interface View {
  phase: 'clue' | 'vote' | 'guess' | 'reveal' | 'done';
  deadline: number | null;
  round: number;
  rounds: number;
  mode: 'blank' | 'similar';
  category: string;
  clues: Record<PlayerId, string> | null;
  votes: Record<PlayerId, PlayerId> | null;
  odd: PlayerId | null;
  caught: boolean | null;
  word: string | null;
  decoy: string | null;
  guess: string | null;
  guessed: boolean | null;
  waiting: PlayerId[];
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
}

interface Priv {
  word: string | null;
  odd: boolean;
  clue: string | null;
  rejected: 'word' | null;
  vote: PlayerId | null;
  canGuess: boolean;
}

const kicker = (v: View) => `Round ${v.round + 1} of ${v.rounds} · ${v.category}`;

/** Every player with their clue; at the reveal, who voted for them. */
function clueCards(v: TvCtx<View>['view'], c: TvCtx<View>, reveal: boolean): HTMLElement {
  const ids = c.room.game?.players ?? [];
  const votesFor = (id: PlayerId) =>
    Object.entries(v.votes ?? {})
      .filter(([, t]) => t === id)
      .map(([voter]) => voter);
  return h(
    'div',
    { class: 'gn-clues' },
    ids.map((id, i) => {
      const p = c.players.get(id);
      const isOdd = reveal && v.odd === id;
      return h(
        'article',
        { class: `gn-clue${isOdd ? ' odd' : ''}`, style: `--i:${i}`, 'data-testid': 'clue' },
        h('div', { class: 'gn-by' }, avatar(p, 'sm'), nameTag(p)),
        h('p', { class: 'gn-clue-text' }, v.clues?.[id] ?? '…'),
        reveal
          ? h(
              'div',
              { class: 'gn-votes' },
              votesFor(id).map((voter) => avatar(c.players.get(voter), 'sm')),
            )
          : null,
        isOdd ? h('span', { class: 'gn-option-tag odd' }, 'ODD ONE OUT', gainedBadge(v.gained[id])) : null,
      );
    }),
  );
}

function tv(c: TvCtx<View>): HTMLElement {
  const { room, view: v, players, paused } = c;
  const odd = v.odd ? players.get(v.odd) : undefined;
  switch (v.phase) {
    case 'clue':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(kicker(v), 'Give a one-line clue on your phone', v.deadline, paused),
        h(
          'p',
          { class: 'gn-lead' },
          v.mode === 'blank'
            ? 'Everyone has the same secret word, except one player who has no idea what it is. Don’t make it too easy for them!'
            : 'Everyone has the same secret word, except one player who has a similar word and doesn’t know it.',
        ),
        h('div', { class: 'gn-big-icon', 'aria-hidden': 'true' }, '🕵️'),
        waitingRow(room, v.waiting, 'Still thinking:'),
      );
    case 'vote':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(kicker(v), 'Who’s the odd one out?', v.deadline, paused),
        clueCards(v, c, false),
        waitingRow(room, v.waiting, 'Still voting:'),
      );
    case 'guess':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(
          kicker(v),
          h('span', {}, 'Caught! ', nameTag(odd), ' was the odd one out'),
          v.deadline,
          paused,
        ),
        h('p', { class: 'gn-lead' }, 'But they can still steal points by guessing the secret word…'),
        clueCards(v, c, true),
      );
    case 'reveal':
      return h(
        'section',
        { class: 'gn-stage reveal' },
        tvHead(
          kicker(v),
          h(
            'span',
            {},
            'The word was ',
            h('span', { class: 'gn-accent', 'data-testid': 'secret-word' }, v.word ?? ''),
          ),
          null,
          paused,
        ),
        h(
          'p',
          { class: 'gn-lead' },
          v.caught
            ? v.guessed
              ? h('span', {}, nameTag(odd), ' was caught, but guessed it! “', v.guess ?? '', '”')
              : h('span', {}, nameTag(odd), ' was caught', v.guess ? ` and guessed “${v.guess}”. Nope!` : '.')
            : h('span', {}, nameTag(odd), ' got away with it!'),
          v.decoy ? ` (They had “${v.decoy}”.)` : '',
        ),
        clueCards(v, c, true),
      );
    case 'done':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead('Odd One Out', 'Scores', null, paused),
        scoreList(room, v.scores, v.gained),
      );
  }
}

function phone({
  view: v,
  priv,
  send,
  paused,
  sending,
  room,
  me,
  players,
}: PhoneCtx<View, Priv>): HTMLElement {
  if (!priv) return phoneNote('⏳', 'One moment…');
  switch (v.phase) {
    case 'clue': {
      const secret = priv.odd
        ? h(
            'div',
            { class: 'gn-secret odd', 'data-testid': 'secret' },
            h('small', {}, 'You’re the odd one out 🤫'),
            h('b', {}, `Category: ${v.category}`),
            h('small', {}, 'Blend in. Work out the word from the others’ clues.'),
          )
        : h(
            'div',
            { class: 'gn-secret', 'data-testid': 'secret' },
            h('small', {}, 'Your secret word'),
            h('b', {}, priv.word ?? ''),
            h(
              'small',
              {},
              v.mode === 'similar'
                ? 'Someone has a different word. Maybe you?'
                : 'One player doesn’t have it.',
            ),
          );
      if (priv.clue)
        return h(
          'div',
          { class: 'gn-phone-stack' },
          secret,
          phoneNote('✅', 'Clue sent', `“${priv.clue}”`, 'clued'),
        );
      const key = `odd-${v.round}`;
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('Your clue', v.deadline, paused),
        secret,
        priv.rejected === 'word'
          ? h(
              'p',
              { class: 'gn-alert', 'data-testid': 'rejected' },
              'That gives the word away! Try something subtler.',
            )
          : null,
        answerBox({
          input: draftInput(key, {}),
          draft: key,
          placeholder: 'A word or short phrase',
          max: CLUE_MAX,
          button: 'Send clue',
          disabled: sending,
          testId: 'clue',
          onSubmit: (text) => {
            drafts.delete(key);
            send({ type: 'clue', text });
          },
        }),
      );
    }
    case 'vote': {
      if (priv.vote)
        return phoneNote(
          '🗳️',
          'Vote in!',
          h('span', {}, 'You suspect ', nameTag(players.get(priv.vote))),
          'voted',
        );
      const others = (room.game?.players ?? []).filter((id) => id !== me.id);
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('Who’s faking it?', v.deadline, paused),
        h(
          'div',
          { class: 'gn-choices' },
          others.map((id) =>
            choiceButton(players.get(id)?.name ?? '?', {
              note: v.clues?.[id] ? `“${v.clues[id]}”` : undefined,
              disabled: sending,
              testId: `suspect-${players.get(id)?.name ?? id}`,
              onClick: () => send({ type: 'vote', player: id }),
            }),
          ),
        ),
      );
    }
    case 'guess': {
      if (!priv.canGuess) return lookUp('Can they guess the word? Watch the TV');
      const key = `odd-guess-${v.round}`;
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('You were caught! Guess the word', v.deadline, paused),
        h('p', { class: 'gn-hint' }, `Category: ${v.category}. Guess right and you still score.`),
        answerBox({
          input: draftInput(key, {}),
          draft: key,
          placeholder: 'The secret word',
          max: CLUE_MAX,
          button: 'Guess',
          disabled: sending,
          testId: 'odd-guess',
          onSubmit: (text) => {
            drafts.delete(key);
            send({ type: 'guess', text });
          },
        }),
      );
    }
    default:
      return lookUp();
  }
}

export const oddOneUi: GameUi = { tv, phone };
