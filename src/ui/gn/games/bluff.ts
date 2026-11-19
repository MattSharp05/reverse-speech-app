import { LIE_MAX } from '../../../games/bluff/rules';
import type { PlayerId } from '../../../platform/module';
import { h } from '../../dom';
import { avatar, draftInput, drafts, nameTag, scoreList, waitingRow } from '../core';
import { answerBox, choiceButton, lookUp, phoneHead, phoneNote, tvHead } from './common';
import type { GameUi, PhoneCtx, TvCtx } from './types';

interface Option {
  text: string;
  truth: boolean | null;
  authors: PlayerId[] | null;
  house: boolean | null;
  pickedBy: PlayerId[] | null;
}

interface View {
  phase: 'lie' | 'pick' | 'reveal' | 'scores' | 'done';
  deadline: number | null;
  index: number;
  count: number;
  final: boolean;
  question: string;
  category: string;
  options: Option[] | null;
  answer: string | null;
  explanation: string | null;
  reference: string | null;
  waiting: PlayerId[];
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
}

interface Priv {
  lie: string | null;
  rejected: 'truth' | null;
  pick: number | null;
  own: number[];
}

/** The question, with its blank drawn as a line. */
function question(text: string): HTMLElement {
  const parts = text.split('___');
  return h(
    'span',
    {},
    parts.flatMap((part, i) =>
      i < parts.length - 1 ? [part, h('span', { class: 'gn-blank' }, '')] : [part],
    ),
  );
}

const kicker = (v: View) =>
  `Question ${v.index + 1} of ${v.count}${v.final ? ' · double points' : ''} · ${v.category}`;

function tv({ room, view: v, players, paused }: TvCtx<View>): HTMLElement {
  switch (v.phase) {
    case 'lie':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(kicker(v), question(v.question), v.deadline, paused),
        h('p', { class: 'gn-lead' }, 'Write a believable lie on your phone. Fool everyone into picking it.'),
        waitingRow(room, v.waiting, 'Still lying:'),
      );
    case 'pick':
    case 'reveal': {
      const reveal = v.phase === 'reveal';
      return h(
        'section',
        { class: `gn-stage ${reveal ? 'reveal' : ''}` },
        tvHead(kicker(v), question(v.question), reveal ? null : v.deadline, paused),
        h(
          'div',
          { class: 'gn-options' },
          (v.options ?? []).map((o, i) =>
            h(
              'article',
              {
                class: `gn-option${reveal && o.truth ? ' truth' : ''}${reveal && !o.truth ? ' lie' : ''}`,
                style: `--i:${i}`,
                'data-testid': 'option',
              },
              h('p', {}, o.text),
              reveal &&
                h(
                  'footer',
                  {},
                  h(
                    'span',
                    { class: 'gn-option-tag' },
                    o.truth ? 'THE TRUTH' : o.house ? 'House lie' : 'Lie by',
                    ...(o.authors ?? []).map((id) => nameTag(players.get(id))),
                  ),
                  h(
                    'span',
                    { class: 'gn-votes' },
                    (o.pickedBy ?? []).map((id) => avatar(players.get(id), 'sm')),
                  ),
                ),
            ),
          ),
        ),
        reveal && v.explanation ? h('p', { class: 'gn-explain' }, v.explanation) : null,
        reveal && v.reference ? h('p', { class: 'gn-source' }, `Source: ${v.reference}`) : null,
        !reveal ? waitingRow(room, v.waiting, 'Still choosing:') : null,
      );
    }
    case 'scores':
    case 'done':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(kicker(v), 'Scores', null, paused),
        scoreList(room, v.scores, v.gained),
      );
  }
}

function phone({ view: v, priv, send, paused, sending }: PhoneCtx<View, Priv>): HTMLElement {
  if (!priv) return phoneNote('⏳', 'One moment…');
  switch (v.phase) {
    case 'lie': {
      if (priv.lie) return phoneNote('🤥', 'Lie locked in', `“${priv.lie}”`, 'lied');
      const key = `bluff-${v.index}`;
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('Write a lie', v.deadline, paused),
        h('p', { class: 'gn-prompt small' }, question(v.question)),
        priv.rejected === 'truth'
          ? h(
              'p',
              { class: 'gn-alert', 'data-testid': 'rejected' },
              'That’s the real answer! Well done, but write a lie instead.',
            )
          : null,
        answerBox({
          input: draftInput(key, {}),
          draft: key,
          placeholder: 'Something believable',
          max: LIE_MAX,
          button: 'Lock in lie',
          disabled: sending,
          testId: 'lie',
          onSubmit: (text) => {
            drafts.delete(key);
            send({ type: 'lie', text });
          },
        }),
      );
    }
    case 'pick': {
      if (priv.pick !== null) return phoneNote('🔍', 'Answer picked', 'Fingers crossed.', 'picked');
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('Find the truth', v.deadline, paused),
        h(
          'div',
          { class: 'gn-choices' },
          (v.options ?? []).map((o, i) =>
            choiceButton(o.text, {
              disabled: priv.own.includes(i) || sending,
              note: priv.own.includes(i) ? 'your lie' : undefined,
              testId: `pick-${i}`,
              onClick: () => send({ type: 'pick', option: i }),
            }),
          ),
        ),
      );
    }
    default:
      return lookUp();
  }
}

export const bluffUi: GameUi = { tv, phone };
