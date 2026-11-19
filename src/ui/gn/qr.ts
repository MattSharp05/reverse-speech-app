import { encode } from 'uqr';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A QR code as an `<svg>` (from kart-racer's `src/remote/qr.ts`: `uqr` encodes, we draw). */
export function qrSvg(text: string, label: string): SVGSVGElement {
  const { size, data } = encode(text, { ecc: 'M', border: 2 });
  let d = '';
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.dataset.qr = text;
  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('width', String(size));
  background.setAttribute('height', String(size));
  background.setAttribute('fill', '#fff');
  const modules = document.createElementNS(SVG_NS, 'path');
  modules.setAttribute('d', d);
  modules.setAttribute('fill', '#000');
  svg.append(background, modules);
  return svg;
}
