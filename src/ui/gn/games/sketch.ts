import { CAPTION_MAX, type Drawing } from '../../../games/sketch/rules';
import type { PlayerId } from '../../../platform/module';
import { h } from '../../dom';
import { avatar, draftInput, drafts, nameTag, scoreList, waitingRow } from '../core';
import { drawingView, drawPad } from './canvas';
import { answerBox, choiceButton, lookUp, phoneHead, phoneNote, tvHead } from './common';
import type { GameUi, PhoneCtx, TvCtx } from './types';

interface Option {
  text: string;
  truth: boolean | null;
  authors: PlayerId[] | null;
  house: boolean | null;
  votedBy: PlayerId[] | null;
}

interface View {
  phase: 'draw' | 'caption' | 'vote' | 'reveal' | 'scores' | 'done';
  deadline: number | null;
  round: number;
  rounds: number;
  index: number;
  count: number;
  drawing: Drawing | null;
  artist: PlayerId | null;
  options: Option[] | null;
  prompt: string | null;
  waiting: PlayerId[];
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
}

interface Priv {
  prompt: string | null;
  drawn: boolean;
  artist: boolean;
  caption: string | null;
  rejected: 'truth' | null;
  vote: number | null;
  own: number[];
}

function tv({ room, view: v, players, paused }: TvCtx<View>): HTMLElement {
  const artist = v.artist ? players.get(v.artist) : undefined;
  const kicker = `Drawing ${v.index + 1} of ${v.count}`;
  switch (v.phase) {
    case 'draw':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(v.rounds > 1 ? `Round ${v.round + 1} of ${v.rounds}` : 'Sketch It', 'Draw your secret prompt on your phone!', v.deadline, paused),
        h('div', { class: 'gn-big-icon', 'aria-hidden': 'true' }, '🖍️'),
        h('p', { class: 'gn-lead' }, 'Nobody else knows what you’re drawing. Keep it that way.'),
        waitingRow(room, v.waiting, 'Still drawing:'),
      );
    case 'caption':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(kicker, h('span', {}, 'What did ', nameTag(artist), ' draw?'), v.deadline, paused),
        h(
          'div',
          { class: 'gn-sketch-row' },
          drawingView(v.drawing),
          h('div', { class: 'gn-sketch-side' }, h('p', { class: 'gn-lead' }, 'Write a fake title on your phone. Make it believable!'), waitingRow(room, v.waiting, 'Still writing:')),
        ),
      );
    case 'vote':
    case 'reveal': {
      const reveal = v.phase === 'reveal';
      return h(
        'section',
        { class: `gn-stage ${reveal ? 'reveal' : ''}` },
        tvHead(kicker, reveal ? h('span', {}, nameTag(artist), ' drew…') : 'Which is the real title?', reveal ? null : v.deadline, paused),
        h(
          'div',
          { class: 'gn-sketch-row' },
          drawingView(v.drawing),
          h(
            'div',
            { class: 'gn-options column' },
            (v.options ?? []).map((o, i) =>
              h(
                'article',
                { class: `gn-option${reveal && o.truth ? ' truth' : ''}${reveal && !o.truth ? ' lie' : ''}`, style: `--i:${i}`, 'data-testid': 'option' },
                h('p', {}, o.text),
                reveal &&
                  h(
                    'footer',
                    {},
                    h('span', { class: 'gn-option-tag' }, o.truth ? 'THE REAL TITLE' : o.house ? 'House decoy' : 'By', ...(o.authors ?? []).map((id) => nameTag(players.get(id)))),
                    h('span', { class: 'gn-votes' }, (o.votedBy ?? []).map((id) => avatar(players.get(id), 'sm'))),
                  ),
              ),
            ),
          ),
        ),
        !reveal ? waitingRow(room, v.waiting, 'Still voting:') : null,
      );
    }
    case 'scores':
    case 'done':
      return h('section', { class: 'gn-stage' }, tvHead('Sketch It', 'Scores', null, paused), scoreList(room, v.scores, v.gained));
  }
}

function phone({ view: v, priv, send, paused, sending }: PhoneCtx<View, Priv>): HTMLElement {
  if (!priv) return phoneNote('⏳', 'One moment…');
  switch (v.phase) {
    case 'draw':
      if (priv.drawn) return phoneNote('🎨', 'Masterpiece sent!', 'Waiting for the other artists.', 'drawn');
      if (!priv.prompt) return lookUp('You’ll play next game. Watch the TV');
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('Draw this (secretly!)', v.deadline, paused),
        h('p', { class: 'gn-prompt small', 'data-testid': 'prompt' }, priv.prompt),
        drawPad(`sketch-${v.round}`, (drawing) => send({ type: 'draw', drawing }), sending),
      );
    case 'caption': {
      if (priv.artist) return phoneNote('🖼️', 'That’s your drawing!', 'Everyone’s writing fake titles for it.');
      if (priv.caption) return phoneNote('✅', 'Title sent', `“${priv.caption}”`, 'captioned');
      const key = `caption-${v.round}-${v.index}`;
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('Write a fake title', v.deadline, paused),
        h('p', { class: 'gn-hint' }, 'Look at the drawing on the TV. What could it be?'),
        priv.rejected === 'truth' ? h('p', { class: 'gn-alert', 'data-testid': 'rejected' }, 'You guessed the real one! Write a fake instead.') : null,
        answerBox({
          input: draftInput(key, {}),
          draft: key,
          placeholder: 'A believable title',
          max: CAPTION_MAX,
          button: 'Send title',
          disabled: sending,
          testId: 'caption',
          onSubmit: (text) => {
            drafts.delete(key);
            send({ type: 'caption', text });
          },
        }),
      );
    }
    case 'vote': {
      if (priv.artist) return phoneNote('🍿', 'Your drawing is up', 'See who gets it right.');
      if (priv.vote !== null) return phoneNote('🗳️', 'Vote in!', null, 'voted');
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('Which is the real title?', v.deadline, paused),
        h(
          'div',
          { class: 'gn-choices' },
          (v.options ?? []).map((o, i) =>
            choiceButton(o.text, {
              disabled: priv.own.includes(i) || sending,
              note: priv.own.includes(i) ? 'yours' : undefined,
              testId: `vote-${i}`,
              onClick: () => send({ type: 'vote', option: i }),
            }),
          ),
        ),
      );
    }
    default:
      return lookUp();
  }
}

export const sketchUi: GameUi = { tv, phone };
