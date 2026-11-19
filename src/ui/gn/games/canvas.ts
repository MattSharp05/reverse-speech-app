import {
  CANVAS_H,
  CANVAS_W,
  COLORS,
  MAX_COORDS,
  MAX_STROKES,
  SIZES,
  type Drawing,
  type Stroke,
} from '../../../games/sketch/rules';
import { h, toast } from '../../dom';

/** Draws `strokes` on a canvas whose size is the drawing space scaled to the element. */
export function paint(canvas: HTMLCanvasElement, strokes: Drawing, live?: Stroke): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const scale = canvas.width / CANVAS_W;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of live ? [...strokes, live] : strokes) {
    const p = stroke.p;
    ctx.strokeStyle = COLORS[stroke.c] ?? '#000';
    ctx.lineWidth = SIZES[stroke.s] ?? 6;
    ctx.beginPath();
    ctx.moveTo(p[0]!, p[1]!);
    if (p.length === 2) {
      ctx.lineTo(p[0]! + 0.1, p[1]!);
    } else {
      // Smooth: curve through the midpoints.
      for (let i = 2; i < p.length - 2; i += 2) {
        const mx = (p[i]! + p[i + 2]!) / 2;
        const my = (p[i + 1]! + p[i + 3]!) / 2;
        ctx.quadraticCurveTo(p[i]!, p[i + 1]!, mx, my);
      }
      ctx.lineTo(p[p.length - 2]!, p[p.length - 1]!);
    }
    ctx.stroke();
  }
}

/** A drawing for the TV (fills its box, 4:3). */
export function drawingView(strokes: Drawing | null, testId = 'drawing'): HTMLElement {
  const canvas = h('canvas', {
    class: 'gn-drawing',
    width: CANVAS_W * 1.5,
    height: CANVAS_H * 1.5,
    'data-testid': testId,
  });
  if (strokes) paint(canvas, strokes);
  return canvas;
}

const pads = new Map<string, { strokes: Drawing; color: number; size: number }>();

const coordCount = (strokes: Drawing) => strokes.reduce((n, s) => n + s.p.length, 0);

/**
 * The phone's drawing pad: pen, three sizes, six colours, undo and clear. Kept per `key`, so
 * a re-render (or a reconnect) keeps the drawing. Strokes are simplified as they're drawn and
 * sent only on submit.
 */
export function drawPad(key: string, onSubmit: (drawing: Drawing) => void, disabled: boolean): HTMLElement {
  const pad = pads.get(key) ?? { strokes: [], color: 0, size: 1 };
  pads.set(key, pad);
  const canvas = h('canvas', {
    class: 'gn-pad-canvas',
    width: CANVAS_W,
    height: CANVAS_H,
    'data-testid': 'pad',
  });
  let live: Stroke | null = null;
  const redraw = () => paint(canvas, pad.strokes, live ?? undefined);
  const point = (e: PointerEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * CANVAS_W);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * CANVAS_H);
    return [Math.max(0, Math.min(CANVAS_W, x)), Math.max(0, Math.min(CANVAS_H, y))];
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (disabled) return;
    if (pad.strokes.length >= MAX_STROKES || coordCount(pad.strokes) >= MAX_COORDS - 200)
      return toast('That’s a lot of ink! Submit or undo a bit.');
    canvas.setPointerCapture(e.pointerId);
    live = { c: pad.color, s: pad.size, p: point(e) };
    redraw();
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!live) return;
    const [x, y] = point(e);
    const p = live.p;
    const dx = x - p[p.length - 2]!;
    const dy = y - p[p.length - 1]!;
    if (dx * dx + dy * dy < 9) return; // skip points closer than 3 units
    if (coordCount(pad.strokes) + p.length >= MAX_COORDS - 2) return;
    p.push(x, y);
    redraw();
  });
  const end = () => {
    if (!live) return;
    pad.strokes.push(live);
    live = null;
    redraw();
    sync();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const swatches = COLORS.map((color, i) =>
    h('button', {
      class: `gn-swatch${pad.color === i ? ' on' : ''}`,
      type: 'button',
      style: `--sw:${color}`,
      'aria-label': `Colour ${i + 1}`,
      onclick: () => {
        pad.color = i;
        swatches.forEach((s, j) => s.classList.toggle('on', j === i));
      },
    }),
  );
  const sizes = SIZES.map((size, i) =>
    h(
      'button',
      {
        class: `gn-size${pad.size === i ? ' on' : ''}`,
        type: 'button',
        'aria-label': `Brush ${['small', 'medium', 'large'][i]}`,
        onclick: () => {
          pad.size = i;
          sizes.forEach((s, j) => s.classList.toggle('on', j === i));
        },
      },
      h('span', { style: `width:${Math.max(6, size)}px;height:${Math.max(6, size)}px` }),
    ),
  );
  const undo = h('button', { class: 'gn-btn small', type: 'button', 'data-testid': 'undo' }, '↶ Undo');
  const clear = h('button', { class: 'gn-btn small', type: 'button', 'data-testid': 'clear' }, 'Clear');
  const submit = h(
    'button',
    { class: 'gn-btn primary', type: 'button', 'data-testid': 'draw-submit' },
    'Submit drawing',
  );
  const sync = () => {
    undo.disabled = clear.disabled = submit.disabled = disabled || pad.strokes.length === 0;
  };
  undo.addEventListener('click', () => {
    pad.strokes.pop();
    redraw();
    sync();
  });
  clear.addEventListener('click', () => {
    if (pad.strokes.length > 3 && !confirm('Clear your drawing?')) return;
    pad.strokes = [];
    redraw();
    sync();
  });
  submit.addEventListener('click', () => {
    if (pad.strokes.length) onSubmit(pad.strokes.map((s) => ({ ...s, p: [...s.p] })));
  });
  redraw();
  sync();
  return h(
    'div',
    { class: 'gn-pad' },
    canvas,
    h(
      'div',
      { class: 'gn-pad-tools' },
      h('div', { class: 'gn-swatches' }, swatches),
      h('div', { class: 'gn-sizes' }, sizes),
    ),
    h('div', { class: 'gn-pad-actions' }, undo, clear, submit),
  );
}
