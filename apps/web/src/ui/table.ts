export const table = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): HTMLTableElement => {
  const element = document.createElement('table');
  element.className = 'min-w-full divide-y divide-slate-200 text-left text-sm';

  const head = document.createElement('thead');
  head.className = 'bg-slate-50 text-xs uppercase tracking-wide text-slate-600';
  const headRow = document.createElement('tr');

  for (const header of headers) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.className = 'whitespace-nowrap px-3 py-2 font-semibold';
    cell.textContent = header;
    headRow.append(cell);
  }

  head.append(headRow);

  const body = document.createElement('tbody');
  body.className = 'divide-y divide-slate-100 bg-white text-slate-700';

  for (const row of rows) {
    const bodyRow = document.createElement('tr');

    for (const value of row) {
      const cell = document.createElement('td');
      cell.className = 'whitespace-nowrap px-3 py-2';
      cell.textContent = value;
      bodyRow.append(cell);
    }

    body.append(bodyRow);
  }

  element.append(head, body);
  return element;
};
