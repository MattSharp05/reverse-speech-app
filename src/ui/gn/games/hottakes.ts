import type { PlayerId } from '../../../platform/module';
import { h } from '../../dom';
import { avatar, gainedBadge, nameTag, scoreList, waitingRow } from '../core';
import { buzz, play } from '../sound';
import { choiceButton, lookUp, phoneHead, phoneNote, tvHead } from './common';
import type { GameUi, PhoneCtx, TvCtx } from './types';

interface View {
  phase: 'answer' | 'reveal' | 'done';
  deadline: number | null;
  index: number;
  count: number;
  question: { kind: 'who' | 'scale'; text: string; low: string | null; high: string | null };
  picks: Record<PlayerId, PlayerId> | null;
  top: PlayerId[] | null;
  ratings: Record<PlayerId, { own: number; guess: number }> | null;
  average: number | null;
  waiting: PlayerId[];
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
}

interface Priv {
  picked: PlayerId | null;
  rated: { own: number; guess: number } | null;
}

const kicker = (v: View) => `Question ${v.index + 1} of ${v.count}`;
const SCALE = Array.from({ length: 11 }, (_, i) => i);

function scaleLabels(v: View): HTMLElement {
  return h(
    'div',
    { class: 'gn-scale-labels' },
    h('span', {}, `0 · ${v.question.low ?? 'No'}`),
    h('span', {}, `${v.question.high ?? 'Yes'} · 10`),
  );
}

function tv({ room, view: v, players, paused }: TvCtx<View>): HTMLElement {
  if (v.phase === 'done')
    return h(
      'section',
      { class: 'gn-stage' },
      tvHead('Hot Takes', 'Scores', null, paused),
      scoreList(room, v.scores, v.gained),
    );
  const ids = room.game?.players ?? [];
  if (v.phase === 'answer') {
    return h(
      'section',
      { class: 'gn-stage' },
      tvHead(kicker(v), v.question.text, v.deadline, paused),
      v.question.kind === 'who'
        ? h('p', { class: 'gn-lead' }, 'Pick someone on your phone. Score by picking who the group picks.')
        : h(
            'div',
            { class: 'gn-stack' },
            scaleLabels(v),
            h('p', { class: 'gn-lead' }, 'Rate it yourself, then guess the group’s average.'),
          ),
      waitingRow(room, v.waiting, 'Still answering:'),
    );
  }
  // Reveal.
  if (v.question.kind === 'who') {
    const counts = ids
      .map((id) => ({
        id,
        voters: Object.entries(v.picks ?? {})
          .filter(([, t]) => t === id)
          .map(([voter]) => voter),
      }))
      .filter((r) => r.voters.length)
      .sort((a, b) => b.voters.length - a.voters.length);
    const top = (v.top ?? []).map((id) => players.get(id));
    return h(
      'section',
      { class: 'gn-stage reveal' },
      tvHead(kicker(v), v.question.text, null, paused),
      top.length
        ? h(
            'div',
            { class: 'gn-banner', 'data-testid': 'hot-top' },
            'The group says: ',
            top.map((p) => p?.name).join(' & '),
          )
        : h('p', { class: 'gn-lead' }, 'Nobody picked anyone!'),
      h(
        'div',
        { class: 'gn-bars' },
        counts.map((r, i) =>
          h(
            'div',
            {
              class: `gn-bar-row${v.top?.includes(r.id) ? ' top' : ''}`,
              style: `--i:${i}; --n:${r.voters.length}; --total:${ids.length}`,
            },
            h('div', { class: 'gn-by' }, avatar(players.get(r.id), 'md'), nameTag(players.get(r.id))),
            h('div', { class: 'gn-bar-fill' }, h('span', {}, String(r.voters.length))),
            h(
              'div',
              { class: 'gn-votes' },
              r.voters.map((voter) => avatar(players.get(voter), 'sm')),
            ),
          ),
        ),
      ),
    );
  }
  const ratings = v.ratings ?? {};
  return h(
    'section',
    { class: 'gn-stage reveal' },
    tvHead(kicker(v), v.question.text, null, paused),
    h(
      'div',
      { class: 'gn-scale' },
      SCALE.map((n) =>
        h(
          'div',
          { class: 'gn-scale-col' },
          h(
            'div',
            { class: 'gn-scale-stack' },
            Object.entries(ratings)
              .filter(([, r]) => r.own === n)
              .map(([id]) => avatar(players.get(id), 'sm')),
          ),
          h('span', { class: 'gn-scale-n' }, String(n)),
        ),
      ),
      v.average !== null
        ? h(
            'div',
            { class: 'gn-scale-avg', style: `--avg:${v.average}` },
            h('span', {}, `avg ${v.average.toFixed(1)}`),
          )
        : null,
    ),
    scaleLabels(v),
    h(
      'ul',
      { class: 'gn-guesses' },
      Object.entries(ratings)
        .sort((a, b) => Math.abs(a[1].guess - (v.average ?? 0)) - Math.abs(b[1].guess - (v.average ?? 0)))
        .map(([id, r]) =>
          h('li', {}, nameTag(players.get(id)), ` guessed ${r.guess}`, gainedBadge(v.gained[id])),
        ),
    ),
  );
}

/** This phone's slider values while answering, by question. */
const sliders = new Map<number, { own: number; guess: number }>();

function slider(label: string, value: number, onInput: (n: number) => void, testId: string): HTMLElement {
  const out = h('b', { class: 'gn-slider-value' }, String(value));
  const input = h('input', {
    type: 'range',
    min: 0,
    max: 10,
    step: 1,
    value: String(value),
    class: 'gn-slider',
    'data-testid': testId,
  });
  input.addEventListener('input', () => {
    out.textContent = input.value;
    onInput(Number(input.value));
  });
  return h('label', { class: 'gn-slider-field' }, h('span', {}, label, out), input);
}

function phone({
  view: v,
  priv,
  send,
  paused,
  sending,
  room,
  players,
  me,
}: PhoneCtx<View, Priv>): HTMLElement {
  if (!priv) return phoneNote('⏳', 'One moment…');
  if (v.phase !== 'answer') {
    const gained = v.gained[me.id];
    return v.phase === 'reveal' && gained
      ? phoneNote('🔥', `+${gained} points`, 'Look at the TV!', 'hot-gained')
      : lookUp();
  }
  if (priv.picked)
    return phoneNote(
      '✅',
      'Locked in',
      h('span', {}, 'You picked ', nameTag(players.get(priv.picked))),
      'answered',
    );
  if (priv.rated)
    return phoneNote(
      '✅',
      'Locked in',
      `You: ${priv.rated.own} · group guess: ${priv.rated.guess}`,
      'answered',
    );
  if (v.question.kind === 'who') {
    return h(
      'div',
      { class: 'gn-phone-stack' },
      phoneHead('Pick someone', v.deadline, paused),
      h('p', { class: 'gn-prompt small' }, v.question.text),
      h(
        'div',
        { class: 'gn-choices grid' },
        (room.game?.players ?? []).map((id) =>
          choiceButton(id === me.id ? `${players.get(id)?.name} (me)` : (players.get(id)?.name ?? '?'), {
            disabled: sending,
            testId: `hot-pick-${players.get(id)?.name ?? id}`,
            onClick: () => send({ type: 'pick', player: id }),
          }),
        ),
      ),
    );
  }
  const values = sliders.get(v.index) ?? { own: 5, guess: 5 };
  sliders.set(v.index, values);
  const submit = h(
    'button',
    { class: 'gn-btn primary', type: 'button', disabled: sending, 'data-testid': 'hot-rate' },
    'Lock in',
  );
  submit.addEventListener('click', () => {
    play('submit');
    buzz();
    send({ type: 'rate', own: values.own, guess: values.guess });
  });
  return h(
    'div',
    { class: 'gn-phone-stack' },
    phoneHead('Rate it', v.deadline, paused),
    h('p', { class: 'gn-prompt small' }, v.question.text),
    h('p', { class: 'gn-hint' }, `0 = ${v.question.low ?? 'No'} · 10 = ${v.question.high ?? 'Yes'}`),
    slider('Your take: ', values.own, (n) => (values.own = n), 'hot-own'),
    slider('Group average guess: ', values.guess, (n) => (values.guess = n), 'hot-guess'),
    submit,
  );
}

export const hotTakesUi: GameUi = { tv, phone };
