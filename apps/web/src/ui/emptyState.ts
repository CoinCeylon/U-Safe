export const emptyState = (title: string, description?: string): HTMLDivElement => {
  const element = document.createElement('div');
  element.className = 'flex flex-col items-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center';

  const heading = document.createElement('p');
  heading.className = 'text-sm font-semibold text-slate-900';
  heading.textContent = title;
  element.append(heading);

  if (description !== undefined) {
    const text = document.createElement('p');
    text.className = 'text-sm text-slate-600';
    text.textContent = description;
    element.append(text);
  }

  return element;
};
