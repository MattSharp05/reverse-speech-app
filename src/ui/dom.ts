type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string };

/** Makes an element: `h('button', { class: 'btn', onclick }, 'Go')`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key.startsWith('on') && typeof value === 'function')
      el.addEventListener(key.slice(2), value as EventListener);
    else if (key.startsWith('data-') || key.startsWith('aria-') || key === 'role' || key === 'for')
      el.setAttribute(key, String(value));
    else (el as unknown as Record<string, unknown>)[key] = value;
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** Short message at the bottom of the screen. */
export function toast(message: string): void {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}
