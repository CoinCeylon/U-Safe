import { STATUSES } from '@usafe/shared';
import {
  badge,
  button,
  card,
  emptyState,
  input,
  modal,
  select,
  spinner,
  statusBadge,
  table,
  textarea,
  toast,
} from './index';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root');
}

const page = document.createElement('main');
page.className = 'mx-auto flex w-full max-w-3xl flex-col gap-4 p-4';

const heading = document.createElement('h1');
heading.className = 'text-2xl font-bold text-slate-900';
heading.textContent = 'UI primitives';

const dialog = modal({
  id: 'demo-modal',
  title: 'Modal',
  content: 'A modal built on the native dialog element.',
});
document.body.append(dialog);

const buttonRow = document.createElement('div');
buttonRow.className = 'flex flex-wrap gap-2';
buttonRow.append(
  button({ label: 'Primary' }),
  button({ label: 'Secondary', variant: 'secondary' }),
  button({ label: 'Danger', variant: 'danger' }),
  button({ label: 'Disabled', disabled: true }),
  button({ label: 'Open modal', variant: 'secondary', onClick: () => dialog.showModal() }),
);

const badgeRow = document.createElement('div');
badgeRow.className = 'flex flex-wrap items-center gap-2';
for (const variant of ['neutral', 'primary', 'success', 'warning', 'danger'] as const) {
  badgeRow.append(badge(variant, variant));
}
for (const status of STATUSES) {
  badgeRow.append(statusBadge(status));
}

const formFields = document.createElement('div');
formFields.className = 'flex flex-col gap-3';
formFields.append(
  input({
    id: 'demo-input',
    label: 'University email',
    type: 'email',
    placeholder: 'student@university.edu',
  }),
  textarea({
    id: 'demo-textarea',
    label: 'Description',
    placeholder: 'What happened?',
  }),
  select({
    id: 'demo-select',
    label: 'Urgency',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'urgent', label: 'Urgent' },
    ],
  }),
);

const feedback = document.createElement('div');
feedback.className = 'flex flex-col gap-3';
feedback.append(spinner('Loading example'), emptyState('Nothing here yet', 'New items will appear here.'));

const toastHost = document.createElement('div');
toastHost.className = 'flex flex-col gap-2';

const toastRow = document.createElement('div');
toastRow.className = 'flex flex-wrap gap-2';
for (const tone of ['info', 'success', 'warning', 'danger'] as const) {
  toastRow.append(
    button({
      label: tone,
      variant: 'secondary',
      onClick: () => {
        toastHost.append(toast(`${tone} toast`, tone));
      },
    }),
  );
}

const toastArea = document.createElement('div');
toastArea.className = 'flex flex-col gap-3';
toastArea.append(toastRow, toastHost);

const tableWrapper = document.createElement('div');
tableWrapper.className = 'overflow-x-auto';
tableWrapper.append(
  table(
    ['ID', 'University', 'Status', 'Supports'],
    [
      ['C-001', 'Example University', 'not_started', '0'],
      ['C-002', 'Another University With A Long Name', 'pending_investigation', '12'],
    ],
  ),
);

page.append(
  heading,
  card('Buttons', buttonRow),
  card('Badges', badgeRow),
  card('Form controls', formFields),
  card('Feedback', feedback),
  card('Toasts', toastArea),
  card('Table', tableWrapper),
);
root.append(page);
