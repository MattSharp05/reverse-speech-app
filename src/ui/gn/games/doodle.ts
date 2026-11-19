import { unpackDrawing } from '../../../games/doodle/pack';
import { DOODLE_MAX_COORDS, TEXT_MAX } from '../../../games/doodle/rules';
import type { PlayerId } from '../../../platform/module';
import { h } from '../../dom';
import { avatar, draftInput, drafts, nameTag, scoreList, waitingRow } from '../core';
import { drawingView, drawPad } from './canvas';
import { answerBox, lookUp, phoneHead, phoneNote, tvHead } from './common';
import { buzz, play } from '../sound';
import type { GameUi, PhoneCtx, TvCtx } from './types';

interface EntryView {
  author: PlayerId;
  kind: 'text' | 'drawing';
  text: string | null;
  /** Packed (see `games/doodle/pack.ts`). */
  drawing: string | null;
}

interface View {
  phase: 'write' | 'draw' | 'guess' | 'show' | 'vote' | 'done';
  deadline: number | null;
  step: number;
  steps: number;
  chain: number;
  chains: number;
  starter: PlayerId | null;
  entries: EntryView[] | null;
  waiting: PlayerId[];
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
}

interface Priv {
  done: boolean;
  suggestion: string | null;
  text: string | null;
  drawing: string | null;
  votable: number[];
  vote: number | null;
}

const stepKicker = (v: View) => `Step ${v.step + 1} of ${v.steps}`;

function entryCard(e: EntryView, players: TvCtx['players'], big: boolean, i: number): HTMLElement {
  const author = players.get(e.author);
  const drawing = e.drawing !== null ? unpackDrawing(e.drawing) : null;
  return h(
    'article',
    { class: `gn-entry${big ? ' big' : ''}`, style: `--i:${i}`, 'data-testid': 'entry' },
    e.kind === 'drawing'
      ? drawing && drawing.length
        ? drawingView(drawing, 'entry-drawing')
        : h('p', { class: 'gn-entry-empty' }, 'Ran out of time!')
      : h('p', { class: 'gn-entry-text' }, `“${e.text ?? ''}”`),
    h(
      'footer',
      { class: 'gn-by' },
      avatar(author, 'sm'),
      nameTag(author),
      h('span', { class: 'gn-muted' }, e.kind === 'drawing' ? ' drew' : i === 0 ? ' wrote' : ' guessed'),
    ),
  );
}

function tv({ room, view: v, players, paused }: TvCtx<View>): HTMLElement {
  switch (v.phase) {
    case 'write':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(stepKicker(v), 'Write something for someone else to draw', v.deadline, paused),
        h('p', { class: 'gn-lead' }, 'Stuck? Your phone has a suggestion.'),
        h('div', { class: 'gn-big-icon', 'aria-hidden': 'true' }, '✍️'),
        waitingRow(room, v.waiting, 'Still writing:'),
      );
    case 'draw':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(stepKicker(v), 'Draw what’s on your phone', v.deadline, paused),
        h('div', { class: 'gn-big-icon', 'aria-hidden': 'true' }, '🖍️'),
        waitingRow(room, v.waiting, 'Still drawing:'),
      );
    case 'guess':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(stepKicker(v), 'What’s that drawing? Guess on your phone', v.deadline, paused),
        h('div', { class: 'gn-big-icon', 'aria-hidden': 'true' }, '🤔'),
        waitingRow(room, v.waiting, 'Still guessing:'),
      );
    case 'show':
    case 'vote': {
      const entries = v.entries ?? [];
      const starter = v.starter ? players.get(v.starter) : undefined;
      const latest = entries.length - 1;
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(
          `Chain ${v.chain + 1} of ${v.chains}`,
          v.phase === 'vote'
            ? 'Vote for your favourite moment!'
            : h('span', {}, nameTag(starter), '’s chain'),
          v.phase === 'vote' ? v.deadline : null,
          paused,
        ),
        h(
          'div',
          { class: `gn-chain${v.phase === 'vote' ? ' all' : ''}` },
          entries.map((e, i) => entryCard(e, players, v.phase === 'show' && i === latest, i)),
        ),
        v.phase === 'vote' ? waitingRow(room, v.waiting, 'Still voting:') : null,
      );
    }
    case 'done':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead('Telephone Doodle', 'Scores', null, paused),
        scoreList(room, v.scores, v.gained),
      );
  }
}

function phone({ view: v, priv, send, paused, sending, players }: PhoneCtx<View, Priv>): HTMLElement {
  if (!priv) return phoneNote('⏳', 'One moment…');
  const working = v.phase === 'write' || v.phase === 'draw' || v.phase === 'guess';
  if (working && priv.done) return phoneNote('📨', 'Passed on!', 'Waiting for everyone else.', 'passed');
  switch (v.phase) {
    case 'write': {
      const key = 'doodle-start';
      const input = draftInput(key, {});
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('Write something to draw', v.deadline, paused),
        priv.suggestion
          ? h(
              'button',
              {
                class: 'gn-choice',
                type: 'button',
                'data-testid': 'use-suggestion',
                onclick: () => {
                  play('submit');
                  buzz();
                  send({ type: 'write', text: priv.suggestion });
                },
              },
              h('small', {}, 'Use this suggestion'),
              h('span', {}, priv.suggestion),
            )
          : null,
        h('p', { class: 'gn-hint center' }, 'or write your own'),
        answerBox({
          input,
          draft: key,
          placeholder: 'A penguin doing taxes…',
          max: TEXT_MAX,
          button: 'Pass it on',
          disabled: sending,
          testId: 'doodle-write',
          onSubmit: (text) => {
            drafts.delete(key);
            send({ type: 'write', text });
          },
        }),
      );
    }
    case 'draw':
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('Draw this', v.deadline, paused),
        h('p', { class: 'gn-prompt small', 'data-testid': 'prompt' }, priv.text ?? '???'),
        drawPad(`doodle-${v.step}`, (drawing) => send({ type: 'draw', drawing }), sending, DOODLE_MAX_COORDS),
      );
    case 'guess': {
      const drawing = priv.drawing !== null ? unpackDrawing(priv.drawing) : null;
      const key = `doodle-guess-${v.step}`;
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('What is this?', v.deadline, paused),
        drawing && drawing.length
          ? drawingView(drawing, 'guess-drawing')
          : h('p', { class: 'gn-hint' }, 'They ran out of time. Make something up!'),
        answerBox({
          input: draftInput(key, {}),
          draft: key,
          placeholder: 'Your best guess',
          max: TEXT_MAX,
          button: 'Pass it on',
          disabled: sending,
          testId: 'doodle-guess',
          onSubmit: (text) => {
            drafts.delete(key);
            send({ type: 'guess', text });
          },
        }),
      );
    }
    case 'vote': {
      if (priv.vote !== null) return phoneNote('🗳️', 'Vote in!', null, 'voted');
      if (!priv.votable.length) return lookUp();
      const entries = v.entries ?? [];
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('Your favourite moment', v.deadline, paused),
        h(
          'div',
          { class: 'gn-choices' },
          priv.votable.map((i) => {
            const e = entries[i]!;
            const drawing = e.drawing !== null ? unpackDrawing(e.drawing) : null;
            return h(
              'button',
              {
                class: 'gn-choice',
                type: 'button',
                disabled: sending,
                'data-testid': `doodle-vote-${i}`,
                onclick: () => {
                  play('submit');
                  buzz();
                  send({ type: 'vote', entry: i });
                },
              },
              e.kind === 'drawing' && drawing?.length
                ? drawingView(drawing, 'vote-drawing')
                : h('span', {}, e.kind === 'drawing' ? '(blank drawing)' : `“${e.text}”`),
              h(
                'small',
                {},
                `${players.get(e.author)?.name ?? 'Someone'} ${e.kind === 'drawing' ? 'drew' : 'guessed'}`,
              ),
            );
          }),
        ),
      );
    }
    default:
      return lookUp();
  }
}

export const doodleUi: GameUi = { tv, phone };
