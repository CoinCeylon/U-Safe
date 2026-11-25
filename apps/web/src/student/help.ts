// Student help page (M062).
//
// A calm, plain-language page that explains how anonymity works and what to
// do in an emergency. Fully static: it makes no requests, so it also works
// offline. Helpline numbers come from the configurable HELPLINES constant in
// packages/shared (JSON in the HELPLINES environment variable).
//
// Privacy: this page never sends anything anywhere.

import { HELPLINES } from '@usafe/shared';

function callout(title: string, className: string): {
  box: HTMLElement;
  heading: HTMLElement;
} {
  const box = document.createElement('div');
  box.className = `rounded-lg p-4 ${className}`;
  const heading = document.createElement('h3');
  heading.className = 'text-sm font-semibold';
  heading.textContent = title;
  box.append(heading);
  return { box, heading };
}

function paragraph(parent: HTMLElement, text: string): void {
  const p = document.createElement('p');
  p.className = 'mt-2 text-sm text-slate-700';
  p.textContent = text;
  parent.append(p);
}

function bulletList(
  parent: HTMLElement,
  items: string[],
): void {
  const list = document.createElement('ul');
  list.className = 'mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    list.append(li);
  }
  parent.append(list);
}

export function renderHelpPage(outlet: HTMLElement): void {
  const wrapper = document.createElement('section');
  wrapper.className = 'flex flex-col gap-4 max-w-md mx-auto py-4';

  const heading = document.createElement('h2');
  heading.className = 'text-lg font-semibold text-slate-900';
  heading.textContent = 'Help and privacy';
  wrapper.append(heading);

  // ---- Emergency guidance ----
  const emergency = callout(
    'If you are in immediate danger',
    'border border-danger bg-danger-light text-slate-900',
  );
  paragraph(
    emergency.box,
    'U-Safe is not an emergency service. If you or someone else is in danger right now, ' +
      'contact your campus security desk or the police emergency line (in Sri Lanka, dial 119) ' +
      'before doing anything else.',
  );
  wrapper.append(emergency.box);

  // ---- Helplines ----
  const helplinesBox = document.createElement('div');
  helplinesBox.className = 'rounded-lg border border-slate-200 bg-white p-4';
  const helplinesHeading = document.createElement('h3');
  helplinesHeading.className = 'text-sm font-semibold text-slate-900';
  helplinesHeading.textContent = 'Helplines';
  helplinesBox.append(helplinesHeading);

  if (HELPLINES.length === 0) {
    const note = document.createElement('p');
    note.className = 'mt-2 text-sm text-slate-600';
    note.textContent =
      'No helpline numbers have been configured for your university yet. ' +
      'In the meantime, reach out to your student affairs office or campus security.';
    helplinesBox.append(note);
  } else {
    const list = document.createElement('ul');
    list.className = 'mt-2 flex flex-col gap-3';
    for (const helpline of HELPLINES) {
      const item = document.createElement('li');
      const name = document.createElement('p');
      name.className = 'text-sm font-medium text-slate-900';
      name.textContent = helpline.name;
      const phone = document.createElement('p');
      phone.className = 'text-sm text-primary';
      phone.textContent = helpline.phone;
      item.append(name, phone);
      if (helpline.description !== undefined) {
        const description = document.createElement('p');
        description.className = 'text-xs text-slate-500';
        description.textContent = helpline.description;
        item.append(description);
      }
      list.append(item);
    }
    helplinesBox.append(list);
  }
  wrapper.append(helplinesBox);

  // ---- Anonymity ----
  const anonymity = callout(
    'How your anonymity works',
    'border border-primary-light bg-primary-light text-primary-dark',
  );
  bulletList(anonymity.box, [
    'You never log in. Every action carries only a cryptographic proof that you are enrolled.',
    'Your name, email and wallet address are never attached to a complaint.',
    'Complaint text of your university can be read by its students, the university and the UGC. Evidence files can only be opened by the university and the UGC — and by you, from your own receipts.',
    'If you say a staff member is involved, only the UGC can read the details.',
    'Submissions wait a random few seconds, so nobody can link the moment you pressed a button to your complaint.',
    'What you type stays in your browser until you submit; the server only ever sees encrypted data.',
  ]);
  wrapper.append(anonymity.box);

  // ---- After filing ----
  const after = document.createElement('div');
  after.className = 'rounded-lg border border-slate-200 bg-white p-4';
  const afterHeading = document.createElement('h3');
  afterHeading.className = 'text-sm font-semibold text-slate-900';
  afterHeading.textContent = 'What happens after you file';
  after.append(afterHeading);
  bulletList(after, [
    'The university has 7 days to start an investigation, or 24 hours if you marked the complaint urgent.',
    'If the deadline passes, the complaint is flagged as overdue automatically.',
    'You can file up to 2 complaints per month. Supporting a complaint is unlimited — one support per complaint.',
    'The My complaints list lives only in this browser. Clearing site data removes it permanently; restoring your wallet does not bring it back.',
  ]);
  wrapper.append(after);

  // ---- Where to go next ----
  const links = document.createElement('p');
  links.className = 'flex flex-wrap gap-3 text-sm';
  const fileLink = document.createElement('a');
  fileLink.href = '#/file-complaint';
  fileLink.className = 'text-primary underline';
  fileLink.textContent = 'File a complaint';
  const feedLink = document.createElement('a');
  feedLink.href = '#/feed';
  feedLink.className = 'text-primary underline';
  feedLink.textContent = 'Open the community feed';
  const mineLink = document.createElement('a');
  mineLink.href = '#/my-complaints';
  mineLink.className = 'text-primary underline';
  mineLink.textContent = 'Open My complaints';
  links.append(fileLink, feedLink, mineLink);
  wrapper.append(links);

  // Small reassurance that this page is purely informational.
  const offlineNote = document.createElement('p');
  offlineNote.className = 'text-xs text-slate-500';
  offlineNote.textContent =
    'This page is purely informational and works without an internet connection.';
  wrapper.append(offlineNote);

  outlet.replaceChildren(wrapper);
}
