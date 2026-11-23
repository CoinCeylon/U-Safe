const svgNamespace = 'http://www.w3.org/2000/svg';

export const spinner = (label = 'Loading'): HTMLSpanElement => {
  const element = document.createElement('span');
  element.className = 'inline-flex items-center gap-2 text-sm text-slate-600';

  const icon = document.createElementNS(svgNamespace, 'svg');
  icon.setAttribute('class', 'h-4 w-4 animate-spin text-primary');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('aria-hidden', 'true');

  const track = document.createElementNS(svgNamespace, 'circle');
  track.setAttribute('class', 'opacity-25');
  track.setAttribute('cx', '12');
  track.setAttribute('cy', '12');
  track.setAttribute('r', '10');
  track.setAttribute('stroke', 'currentColor');
  track.setAttribute('stroke-width', '4');

  const arc = document.createElementNS(svgNamespace, 'path');
  arc.setAttribute('class', 'opacity-75');
  arc.setAttribute('fill', 'currentColor');
  arc.setAttribute('d', 'M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z');

  icon.append(track, arc);

  const text = document.createElement('span');
  text.className = 'sr-only';
  text.textContent = label;

  element.append(icon, text);
  return element;
};
