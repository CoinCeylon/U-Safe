export const card = (title: string, ...content: Node[]): HTMLDivElement => {
  const element = document.createElement('div');
  element.className = 'rounded-lg border border-slate-200 bg-white p-4 shadow-sm';

  const heading = document.createElement('h2');
  heading.className = 'mb-3 text-base font-semibold text-slate-900';
  heading.textContent = title;

  element.append(heading, ...content);
  return element;
};
