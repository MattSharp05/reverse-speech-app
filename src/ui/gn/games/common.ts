import { h } from '../../dom';
import { timer } from '../core';
import { buzz, play } from '../sound';

/** A big phone message: emoji, title, line. */
export function phoneNote(emoji: string, title: string, line?: string | Node | null, testId?: string): HTMLElement {
  return h(
    'div',
    { class: 'gn-note', 'data-testid': testId },
    h('div', { class: 'gn-note-emoji' }, emoji),
    h('h2', {}, title),
    line ? h('p', {}, line) : null,
  );
}

export const lookUp = (line = 'Look at the TV!') => phoneNote('📺', line, null, 'look-up');

/** The phone's header for a phase: what to do, and the time left. */
export function phoneHead(title: string, deadline: number | null, paused: boolean): HTMLElement {
  return h('div', { class: 'gn-phone-head' }, h('h2', {}, title), timer(deadline, paused));
}

/** The TV's header for a phase: big instruction, a subtitle, the countdown. */
export function tvHead(kicker: string, title: string | Node, deadline: number | null, paused: boolean): HTMLElement {
  return h(
    'header',
    { class: 'gn-tv-head' },
    h('div', {}, h('p', { class: 'gn-kicker' }, kicker), h('h1', { class: 'gn-tv-title' }, title)),
    timer(deadline, paused, true),
  );
}

/** A text box with a submit button; Enter submits. */
export function answerBox(options: {
  draft: string;
  placeholder: string;
  max: number;
  button: string;
  disabled?: boolean;
  multiline?: boolean;
  testId?: string;
  onSubmit(text: string): void;
  input: HTMLInputElement | HTMLTextAreaElement;
}): HTMLElement {
  const { input } = options;
  input.placeholder = options.placeholder;
  input.maxLength = options.max;
  input.setAttribute('enterkeyhint', 'send');
  input.setAttribute('data-testid', `${options.testId ?? 'answer'}-input`);
  const counter = h('span', { class: 'gn-counter' }, '');
  const button = h(
    'button',
    { class: 'gn-btn primary', type: 'button', disabled: options.disabled, 'data-testid': `${options.testId ?? 'answer'}-submit` },
    options.button,
  );
  const sync = () => {
    counter.textContent = `${input.value.length}/${options.max}`;
    button.disabled = Boolean(options.disabled) || !input.value.trim();
  };
  const submit = () => {
    const text = input.value.trim();
    if (!text || options.disabled) return;
    play('submit');
    buzz();
    options.onSubmit(text);
  };
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' && !(e as KeyboardEvent).shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  button.addEventListener('click', submit);
  sync();
  return h('div', { class: 'gn-answer' }, input, h('div', { class: 'gn-answer-row' }, counter, button));
}

/** A tall choice button for votes and picks. */
export function choiceButton(label: string, options: { disabled?: boolean; note?: string; selected?: boolean; testId?: string; onClick(): void }): HTMLButtonElement {
  const button = h(
    'button',
    {
      class: `gn-choice${options.selected ? ' selected' : ''}`,
      type: 'button',
      disabled: options.disabled,
      'data-testid': options.testId,
    },
    h('span', {}, label),
    options.note ? h('small', {}, options.note) : null,
  );
  button.addEventListener('click', () => {
    play('submit');
    buzz();
    options.onClick();
  });
  return button;
}

export const letter = (i: number) => String.fromCharCode(65 + i);
