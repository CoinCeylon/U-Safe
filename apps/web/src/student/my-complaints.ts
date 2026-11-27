// Student "My complaints" page (M061).
//
// Lists the complaints this browser has filed, from the encrypted local
// receipts only. Nothing on this page is ever sent to the server: statuses
// refresh through the same public, proof-less complaint endpoint the feed
// and detail pages use, and evidence re-downloads read blobs by their
// public hash. The list itself lives in SecureStore (IndexedDB, encrypted
// with the student secret).
//
// Clearing site data removes the receipts permanently. Restoring the wallet
// does NOT bring them back, because IndexedDB is gone — the page says so.

import type { Status } from '@usafe/shared';
import { statusBadge, badge } from '../ui/badge';
import { button } from '../ui/button';
import { emptyState } from '../ui/emptyState';
import { toast } from '../ui/toast';
import { friendlyError } from '../lib/offline';
import { getStudentSecret } from './unlock';
import { ensureUnlocked } from './session';
import {
  loadFilingReceipts,
  sortReceiptsNewestFirst,
  updateFilingStatus,
  type FilingEvidenceInfo,
  type FilingReceipt,
} from './filings';
import {
  downloadEvidenceFile,
} from './evidenceDownload';
import { formatBytes } from './evidence';

interface ComplaintMetaView {
  id: string;
  status: Status;
  escalated: boolean;
  supportCount: number;
}

const isReceiptEvent = (raw: string): { type: string; id: string } | null => {
  try {
    const data = JSON.parse(raw) as { type?: unknown; id?: unknown };
    if (typeof data.type === 'string' && typeof data.id === 'string') {
      return { type: data.type, id: data.id };
    }
  } catch {
    // Ignore malformed event payloads.
  }
  return null;
};

let eventSource: EventSource | null = null;

const closeEventSource = (): void => {
  if (eventSource !== null) {
    eventSource.close();
    eventSource = null;
  }
};

export async function renderMyComplaints(outlet: HTMLElement): Promise<void> {
  closeEventSource();
  if (getStudentSecret() === null) {
    outlet.replaceChildren(unlockPrompt(outlet));
    return;
  }

  const wrapper = document.createElement('section');
  wrapper.className = 'flex flex-col gap-3 max-w-xl mx-auto py-2';

  const heading = document.createElement('h2');
  heading.className = 'text-lg font-semibold text-slate-900';
  heading.textContent = 'My complaints';

  const storageNote = document.createElement('p');
  storageNote.className = 'rounded-md bg-slate-50 p-3 text-xs text-slate-600';
  storageNote.textContent =
    'This list is stored only in this browser, encrypted with your student secret. ' +
    'Clearing this site\u2019s data removes it permanently: restoring your wallet or ' +
    're-enrolling will not bring it back, because the receipts are not on any server.';

  wrapper.append(heading, storageNote);

  const loading = document.createElement('p');
  loading.className = 'text-sm text-slate-600';
  loading.textContent = 'Opening your receipts…';
  wrapper.append(loading);
  outlet.replaceChildren(wrapper);

  let receipts: FilingReceipt[];
  try {
    receipts = sortReceiptsNewestFirst(await loadFilingReceipts());
  } catch {
    loading.remove();
    const error = document.createElement('p');
    error.className = 'text-sm text-danger';
    error.textContent = 'Could not open your receipts. Please try again.';
    wrapper.append(error);
    return;
  }
  loading.remove();

  if (receipts.length === 0) {
    wrapper.append(
      emptyState(
        'No complaints filed from this browser',
        'Complaints you file here appear in this list so you can follow their progress.',
      ),
    );
    return;
  }

  const statusBadges = new Map<string, HTMLElement>();
  const escalatedBadges = new Map<string, HTMLElement>();

  for (const receipt of receipts) {
    wrapper.append(
      receiptCard(receipt, statusBadges, escalatedBadges),
    );
  }

  const refreshStatus = async (complaintId: string): Promise<void> => {
    const receipt = receipts.find((entry) => entry.complaintId === complaintId);
    if (receipt === undefined) {
      return;
    }
    try {
      const response = await fetch(
        `/api/complaints/${encodeURIComponent(complaintId)}` +
          `?university=${encodeURIComponent(receipt.universityId)}`,
      );
      if (!response.ok) {
        return; // Status stays at the last known value.
      }
      const payload = (await response.json()) as { complaint?: ComplaintMetaView };
      const complaint = payload.complaint;
      if (complaint === undefined) {
        return;
      }
      const badgeElement = statusBadges.get(complaintId);
      if (badgeElement !== undefined) {
        badgeElement.replaceWith(statusBadge(complaint.status));
      }
      const escalatedBadge = escalatedBadges.get(complaintId);
      if (escalatedBadge !== undefined && complaint.escalated) {
        escalatedBadge.classList.remove('hidden');
      }
      // Remember the latest state for the next page load.
      await updateFilingStatus(complaintId, {
        lastStatus: complaint.status,
        escalated: complaint.escalated,
      }).catch(() => {
        // A failed local write must not break the page.
      });
    } catch {
      // Offline or transient failure; the next event retries.
    }
  };

  // One refresh per receipt on load, then live updates via SSE.
  for (const receipt of receipts) {
    void refreshStatus(receipt.complaintId);
  }

  eventSource = new EventSource('/api/events');
  eventSource.onmessage = (event) => {
    const data = isReceiptEvent(String(event.data));
    if (data === null) {
      return;
    }
    if (
      (data.type === 'complaint.status' ||
        data.type === 'complaint.escalated' ||
        data.type === 'complaint.supported') &&
      receipts.some((entry) => entry.complaintId === data.id)
    ) {
      void refreshStatus(data.id);
    }
  };
  eventSource.onerror = () => {
    closeEventSource();
  };
}

function receiptCard(
  receipt: FilingReceipt,
  statusBadges: Map<string, HTMLElement>,
  escalatedBadges: Map<string, HTMLElement>,
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'rounded-lg border border-slate-200 bg-white p-4';

  const heading = document.createElement('h3');
  heading.className = 'text-sm font-semibold text-slate-900';
  const link = document.createElement('a');
  link.href = `#/complaint/${encodeURIComponent(receipt.complaintId)}`;
  link.className = 'text-primary underline';
  link.textContent = `Complaint ${receipt.complaintId}`;
  heading.append(link);
  card.append(heading);

  const meta = document.createElement('p');
  meta.className = 'mt-1 text-xs text-slate-500';
  meta.textContent =
    `${titleCase(receipt.category)} \u00b7 ${receipt.urgency} \u00b7 ` +
    `filed ${formatDate(receipt.filedAt)}` +
    (receipt.staffInvolved ? ' \u00b7 involves staff' : '');
  card.append(meta);

  const badges = document.createElement('p');
  badges.className = 'mt-2 flex flex-wrap gap-2';
  const status = statusBadge(
    (receipt.lastStatus as Status | undefined) ?? 'not_started',
  );
  statusBadges.set(receipt.complaintId, status);
  badges.append(status);
  if (receipt.staffInvolved) {
    badges.append(badge('Handled by the UGC', 'warning'));
  }
  if (receipt.escalated === true) {
    const escalated = badge('Overdue', 'danger');
    escalatedBadges.set(receipt.complaintId, escalated);
    badges.append(escalated);
  } else {
    const escalated = badge('Overdue', 'danger');
    escalated.classList.add('hidden');
    escalatedBadges.set(receipt.complaintId, escalated);
    badges.append(escalated);
  }
  card.append(badges);

  const description = document.createElement('p');
  description.className =
    'mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-sm text-slate-700';
  description.textContent = receipt.description;
  card.append(description);

  if (receipt.evidence.length > 0) {
    card.append(evidenceSection(receipt));
  }
  return card;
}

function evidenceSection(receipt: FilingReceipt): HTMLElement {
  const section = document.createElement('div');
  section.className = 'mt-3';
  const label = document.createElement('p');
  label.className = 'text-xs font-medium text-slate-700';
  label.textContent = `Evidence (${receipt.evidence.length})`;
  section.append(label);

  for (const evidence of receipt.evidence) {
    section.append(evidenceRow(evidence));
  }
  return section;
}

function evidenceRow(evidence: FilingEvidenceInfo): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mt-2 flex items-center justify-between gap-2';
  const info = document.createElement('p');
  info.className = 'min-w-0 truncate text-sm text-slate-700';
  info.textContent = `${evidence.name} (${formatBytes(evidence.size)})`;
  const state = document.createElement('span');
  state.className = 'text-xs text-slate-400';
  state.setAttribute('role', 'status');

  let busy = false;
  const download = button({
    label: 'Download',
    variant: 'secondary',
    onClick: () => {
      if (busy) {
        return;
      }
      busy = true;
      download.disabled = true;
      state.textContent = 'Downloading…';
      state.className = 'text-xs text-primary';
      void (async () => {
        try {
          const bytes = await downloadEvidenceFile(evidence, fetch);
          const blob = new Blob([bytes as unknown as BlobPart], {
            type: evidence.type === '' ? 'application/octet-stream' : evidence.type,
          });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = evidence.name;
          anchor.click();
          // Give the download a moment before releasing the object URL.
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
          state.textContent = 'Integrity verified';
          state.className = 'text-xs text-success';
        } catch (error) {
          const message = friendlyError(error, 'Download failed.');
          state.textContent = message;
          state.className = 'text-xs text-danger';
          toast(message, 'danger');
        } finally {
          busy = false;
          download.disabled = false;
        }
      })();
    },
  });

  row.append(info, state, download);
  return row;
}

function unlockPrompt(outlet: HTMLElement): HTMLElement {
  const wrapper = document.createElement('section');
  wrapper.className = 'flex flex-col gap-3 max-w-md mx-auto py-4';
  const message = document.createElement('p');
  message.className = 'text-sm text-slate-600';
  message.textContent =
    'Unlock your student secret to see the complaints filed from this browser.';
  const unlock = document.createElement('button');
  unlock.type = 'button';
  unlock.className =
    'rounded-md border border-primary bg-primary px-4 py-2 text-sm font-medium text-white';
  unlock.textContent = 'Unlock student secret';
  unlock.addEventListener('click', () => {
    void (async () => {
      const universityId = sessionStorage.getItem('usafe-student-university');
      if (!universityId) {
        toast('Please enrol before opening your complaints.', 'danger');
        return;
      }
      try {
        await ensureUnlocked(universityId);
        await renderMyComplaints(outlet);
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not unlock.', 'danger');
      }
    })();
  });
  wrapper.append(message, unlock);
  return wrapper;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace('_', ' ');
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}
