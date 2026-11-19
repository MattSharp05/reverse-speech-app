import { ANSWER_MAX, FINAL_VOTES } from '../../../games/quip/rules';
import type { PlayerId } from '../../../platform/module';
import { h } from '../../dom';
import { avatar, draftInput, drafts, gainedBadge, nameTag, scoreList, waitingRow } from '../core';
import { answerBox, choiceButton, letter, lookUp, phoneHead, phoneNote, tvHead } from './common';
import type { GameUi, PhoneCtx, TvCtx } from './types';

interface Answer {
  text: string | null;
  author: PlayerId | null;
  votes: PlayerId[] | null;
  points: number | null;
}

interface View {
  phase: 'intro' | 'answer' | 'vote' | 'result' | 'scores' | 'done';
  deadline: number | null;
  round: number;
  rounds: number;
  final: boolean;
  matchupIndex: number;
  matchupCount: number;
  prompt: string | null;
  answers: Answer[] | null;
  sweep: number | null;
  waiting: PlayerId[];
  scores: Record<PlayerId, number>;
  gained: Record<PlayerId, number>;
  votesEach: number;
}

interface Priv {
  prompts: { index: number; text: string; answer: string | null }[];
  canVote: boolean;
  voted: number[] | null;
  own: number[];
}

const roundName = (v: View) => (v.final ? 'Final round' : `Round ${v.round + 1} of ${v.rounds}`);

function tv({ room, view: v, players, paused }: TvCtx<View>): HTMLElement {
  switch (v.phase) {
    case 'intro':
      return h(
        'section',
        { class: 'gn-stage center intro' },
        h('p', { class: 'gn-kicker' }, 'Quip Battle'),
        h('h1', { class: 'gn-huge' }, roundName(v)),
        h(
          'p',
          { class: 'gn-lead' },
          v.final
            ? 'One prompt for everyone. You get three votes, spend them on your favourites.'
            : `Answer two prompts on your phone. Each one goes head to head with another player.${v.round > 0 ? ' Points are doubled!' : ''}`,
        ),
      );
    case 'answer':
      return h(
        'section',
        { class: 'gn-stage' },
        tvHead(roundName(v), 'Answer your prompts on your phone!', v.deadline, paused),
        h('div', { class: 'gn-big-icon', 'aria-hidden': 'true' }, '✍️'),
        waitingRow(room, v.waiting, 'Still writing:'),
      );
    case 'vote':
    case 'result': {
      const result = v.phase === 'result';
      const answers = v.answers ?? [];
      const total = answers.reduce((n, a) => n + (a.votes?.length ?? 0), 0);
      return h(
        'section',
        { class: `gn-stage ${result ? 'reveal' : ''}` },
        tvHead(
          v.final ? 'Final round' : `Matchup ${v.matchupIndex + 1} of ${v.matchupCount}`,
          v.prompt ?? '',
          result ? null : v.deadline,
          paused,
        ),
        h(
          'div',
          { class: `gn-versus${answers.length > 2 ? ' many' : ''}` },
          answers.map((a, i) => {
            const author = a.author ? players.get(a.author) : undefined;
            const share = total ? Math.round(((a.votes?.length ?? 0) / total) * 100) : 0;
            const winner = result && !v.final && (a.points ?? 0) > 0 && answers.every((b) => (b.votes?.length ?? 0) <= (a.votes?.length ?? 0));
            return h(
              'article',
              { class: `gn-answer-card${winner ? ' winner' : ''}${a.text === null ? ' empty' : ''}`, style: `--i:${i}`, 'data-testid': 'answer-card' },
              h('span', { class: 'gn-letter' }, letter(i)),
              h('p', { class: 'gn-answer-text' }, a.text ?? 'No answer!'),
              result &&
                h(
                  'footer',
                  {},
                  author ? h('div', { class: 'gn-by' }, avatar(author, 'sm'), nameTag(author)) : null,
                  h('div', { class: 'gn-votes' }, (a.votes ?? []).map((id) => avatar(players.get(id), 'sm'))),
                  h('div', { class: 'gn-share' }, `${share}%`, gainedBadge(a.points ?? 0)),
                ),
            );
          }),
        ),
        result && v.sweep !== null ? h('div', { class: 'gn-banner' }, 'Clean sweep! Bonus points!') : null,
        !result ? waitingRow(room, v.waiting, 'Votes to come:') : null,
      );
    }
    case 'scores':
    case 'done':
      return h('section', { class: 'gn-stage' }, tvHead(roundName(v), 'Scores', null, paused), scoreList(room, v.scores, v.gained));
  }
}

function phone({ view: v, priv, send, paused, sending }: PhoneCtx<View, Priv>): HTMLElement {
  if (!priv) return phoneNote('⏳', 'One moment…');
  switch (v.phase) {
    case 'intro':
      return phoneNote('🎤', roundName(v), 'Get your thumbs ready.');
    case 'answer': {
      const todo = priv.prompts.find((p) => p.answer === null);
      if (!priv.prompts.length) return lookUp('Sit tight. Watch the TV');
      if (!todo) return phoneNote('✅', 'All answered!', 'Now wait for everyone else.', 'answered');
      const number = priv.prompts.indexOf(todo) + 1;
      const key = `quip-${v.round}-${todo.index}`;
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead(`Prompt ${number} of ${priv.prompts.length}`, v.deadline, paused),
        h('p', { class: 'gn-prompt', 'data-testid': 'prompt' }, todo.text),
        answerBox({
          input: draftInput(key, { multiline: true }),
          draft: key,
          placeholder: 'Your funniest answer',
          max: ANSWER_MAX,
          button: 'Send',
          disabled: sending,
          onSubmit: (text) => {
            drafts.delete(key);
            send({ type: 'answer', matchup: todo.index, text });
          },
        }),
      );
    }
    case 'vote': {
      if (priv.voted) return phoneNote('🗳️', 'Vote in!', 'Watch the TV.', 'voted');
      if (!priv.canVote) {
        return priv.own.length ? phoneNote('🙈', 'That’s yours up there!', 'Everyone else is voting.') : lookUp();
      }
      const answers = v.answers ?? [];
      if (v.final) return finalVote(v, priv, send);
      return h(
        'div',
        { class: 'gn-phone-stack' },
        phoneHead('Pick the funnier answer', v.deadline, paused),
        h('p', { class: 'gn-prompt small' }, v.prompt),
        h(
          'div',
          { class: 'gn-choices' },
          answers.map((a, i) =>
            choiceButton(a.text ?? '—', {
              disabled: a.text === null || sending,
              testId: `vote-${i}`,
              onClick: () => send({ type: 'vote', choice: i }),
            }),
          ),
        ),
      );
    }
    default:
      return lookUp();
  }
}

/** Final round: pick up to three answers (not your own), then send. */
const picks = new Map<string, Set<number>>();
function finalVote(v: View, priv: Priv, send: (a: unknown) => void): HTMLElement {
  const key = `final-${v.round}`;
  const chosen = picks.get(key) ?? new Set<number>();
  picks.set(key, chosen);
  const submit = h('button', { class: 'gn-btn primary', type: 'button', 'data-testid': 'vote-submit' }, '');
  const sync = () => {
    submit.disabled = chosen.size === 0;
    submit.textContent = chosen.size ? `Send ${chosen.size} vote${chosen.size > 1 ? 's' : ''}` : `Pick up to ${FINAL_VOTES}`;
  };
  submit.addEventListener('click', () => send({ type: 'vote', choices: [...chosen] }));
  const buttons = (v.answers ?? []).map((a, i) => {
    const own = priv.own.includes(i);
    const b = choiceButton(a.text ?? '—', {
      disabled: own || a.text === null,
      note: own ? 'yours' : undefined,
      testId: `vote-${i}`,
      onClick: () => {
        if (chosen.has(i)) chosen.delete(i);
        else if (chosen.size < FINAL_VOTES) chosen.add(i);
        b.classList.toggle('selected', chosen.has(i));
        sync();
      },
    });
    b.classList.toggle('selected', chosen.has(i));
    return b;
  });
  sync();
  return h(
    'div',
    { class: 'gn-phone-stack' },
    phoneHead(`Your ${FINAL_VOTES} votes`, v.deadline, false),
    h('p', { class: 'gn-prompt small' }, v.prompt),
    h('div', { class: 'gn-choices' }, buttons),
    submit,
  );
}

export const quipUi: GameUi = { tv, phone };
