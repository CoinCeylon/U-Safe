// Student complaint detail page (M055/M056).
//
// Shows the complaint meta, support count, status timeline, escalation notice
// and, when finished, the recorded outcome. UGC-owned complaints show
// "Details restricted to the UGC" instead of text.
//
// M056 adds the Support flow: the student secret is unlocked on demand, the
// credential is refreshed locally, a mock proof is built in the browser, the
// request is delayed through submitQueue, and the supported id is remembered
// in encrypted SecureStore so the button survives a reload.

import type { Status } from '@usafe/shared';
import { friendlyError } from '../lib/offline';
import { getStudentSecret } from './unlock';
import { getCachedCredential, refreshCredential } from './credential';
import { ensureUnlocked } from './session';
import { hasSupported, rememberSupported } from './supported';
import {
  DuplicateSupportError,
  buildSupportProof,
  submitSupport,
} from './support';
import { toast } from '../ui/toast';

interface HistoryEntryView {
  status: Status;
  at: string;
  actorRole: string;
  noteHash: string | null;
}

interface ComplaintView {
  id: string;
  category: string;
  urgency: string;
  status: Status;
  supportCount: number;
  ownerRole: string;
  escalated: boolean;
  outcomeHash: string | null;
  createdAt: string;
}

export async function renderDetail(
  outlet: HTMLElement,
  complaintId: string,
): Promise<void> {
  const secret = getStudentSecret();
  if (secret === null) {
    outlet.replaceChildren(unlockPrompt(outlet, complaintId));
    return;
  }

  const cred = getCachedCredential();
  if (!cred) {
    outlet.innerHTML =
      '<p class="text-sm text-slate-600">Your enrollment credential is not ready yet. Go back to the feed and unlock your student secret again.</p>';
    return;
  }

  const universityId = cred.universityId;

  try {
    const [complaintResponse, historyResponse] = await Promise.all([
      fetch(
        `/api/complaints/${encodeURIComponent(complaintId)}?university=${encodeURIComponent(universityId)}`,
      ),
      fetch(
        `/api/complaints/${encodeURIComponent(complaintId)}/history?university=${encodeURIComponent(universityId)}`,
      ),
    ]);
    if (!complaintResponse.ok) {
      throw new Error('Failed to load complaint');
    }
    if (!historyResponse.ok) {
      throw new Error('Failed to load status history');
    }

    const complaintPayload = (await complaintResponse.json()) as {
      complaint?: ComplaintView;
    };
    const historyPayload = (await historyResponse.json()) as {
      entries?: HistoryEntryView[];
    };
    const complaint = complaintPayload.complaint;
    if (!complaint) {
      throw new Error('Complaint was not found');
    }
    const history = historyPayload.entries ?? [];

    const container = document.createElement('div');
    container.className = 'flex flex-col gap-4 max-w-xl mx-auto py-2';

    const card = document.createElement('section');
    card.className = 'rounded-lg border border-slate-200 bg-white p-4';

    const heading = document.createElement('h2');
    heading.className = 'font-semibold text-slate-900';
    heading.textContent = `Complaint ${complaint.id}`;
    card.append(heading);

    const meta = document.createElement('p');
    meta.className = 'mt-1 text-xs text-slate-500';
    meta.textContent = `${titleCase(complaint.category)} • ${complaint.urgency} • ${statusLabel(complaint.status)} • filed ${formatAge(complaint.createdAt)}`;
    card.append(meta);

    const supportLine = document.createElement('p');
    supportLine.className = 'mt-2 text-sm text-slate-700';
    supportLine.textContent = supportText(complaint.supportCount);
    card.append(supportLine);

    if (complaint.escalated) {
      const notice = document.createElement('p');
      notice.className =
        'mt-3 rounded border border-danger bg-danger-light px-3 py-2 text-sm text-danger';
      notice.textContent =
        'Overdue: this complaint was not moved to investigation in time.';
      card.append(notice);
    }

    const description = document.createElement('p');
    description.className = 'mt-3 text-sm text-slate-600';
    description.textContent =
      complaint.ownerRole === 'ugc'
        ? 'Details restricted to the UGC'
        : 'Description is stored in the encrypted payload and will appear here once submission encryption is enabled.';
    card.append(description);

    if (complaint.status === 'finished' && complaint.outcomeHash) {
      const outcome = document.createElement('p');
      outcome.className = 'mt-3 text-sm text-slate-600';
      outcome.textContent = `Outcome recorded (${complaint.outcomeHash.slice(0, 12)}…)`;
      card.append(outcome);
    }

    const timeline = document.createElement('section');
    timeline.className = 'rounded-lg border border-slate-200 bg-white p-4';
    const timelineHeading = document.createElement('h3');
    timelineHeading.className = 'font-medium text-slate-900';
    timelineHeading.textContent = 'Status timeline';
    timeline.append(timelineHeading);

    if (history.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'mt-2 text-sm text-slate-500';
      empty.textContent = 'No status changes yet.';
      timeline.append(empty);
    } else {
      const list = document.createElement('ol');
      list.className = 'mt-2 space-y-1 text-sm text-slate-600';
      for (const entry of history) {
        const item = document.createElement('li');
        item.textContent = `${formatDate(entry.at)} — ${actorLabel(entry.actorRole)}: ${statusLabel(entry.status)}`;
        list.append(item);
      }
      timeline.append(list);
    }

    const supportButton = document.createElement('button');
    supportButton.type = 'button';
    supportButton.className =
      'w-full rounded-md border border-primary bg-primary px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60';
    supportButton.textContent = 'Checking your support status…';
    supportButton.disabled = true;

    let alreadySupported = await hasSupported(complaintId);
    let busy = false;

    const updateButton = (): void => {
      if (busy) {
        supportButton.textContent = 'Supporting…';
        supportButton.disabled = true;
      } else if (alreadySupported) {
        supportButton.textContent = 'You support this';
        supportButton.disabled = true;
      } else {
        supportButton.textContent = 'Support this complaint';
        supportButton.disabled = false;
      }
    };
    updateButton();

    supportButton.addEventListener('click', () => {
      if (busy || alreadySupported) {
        return;
      }
      busy = true;
      updateButton();

      void (async () => {
        try {
          await ensureUnlocked(universityId);
          const currentSecret = getStudentSecret();
          if (currentSecret === null) {
            throw new Error('Student secret is not available');
          }
          const currentCredential = getCachedCredential() ?? (await refreshCredential(universityId));
          const proof = await buildSupportProof(
            currentSecret,
            universityId,
            complaintId,
            currentCredential,
          );
          const count = await submitSupport(complaintId, proof);
          alreadySupported = true;
          await rememberSupported(complaintId);
          supportLine.textContent = supportText(count);
          toast('Your support was recorded.', 'success');
        } catch (error) {
          if (error instanceof DuplicateSupportError) {
            // A retry or a second click must not look like a failure.
            alreadySupported = true;
            await rememberSupported(complaintId);
            toast('You already support this complaint.', 'info');
          } else {
            // Offline clicks get a friendly offline message; nothing was sent.
            toast(
              friendlyError(error, 'Could not support this complaint.'),
              'danger',
            );
          }
        } finally {
          busy = false;
          updateButton();
        }
      })();
    });

    const back = document.createElement('a');
    back.href = '#/feed';
    back.className = 'text-sm text-primary underline';
    back.textContent = 'Back to community feed';

    container.append(card, supportButton, timeline, back);
    outlet.replaceChildren(container);
  } catch (error) {
    outlet.replaceChildren();
    const message = document.createElement('p');
    message.className = 'text-sm text-danger';
    message.textContent = friendlyError(
      error,
      'Could not load this complaint. Please try again.',
    );
    const back = document.createElement('a');
    back.href = '#/feed';
    back.className = 'text-sm text-primary underline';
    back.textContent = 'Back to community feed';
    outlet.append(message, back);
  }
}

function unlockPrompt(outlet: HTMLElement, complaintId: string): HTMLElement {
  const wrapper = document.createElement('section');
  wrapper.className = 'flex flex-col gap-3 max-w-md mx-auto py-4';
  const message = document.createElement('p');
  message.className = 'text-sm text-slate-600';
  message.textContent = 'Unlock your student secret to view this complaint.';
  const button = document.createElement('button');
  button.type = 'button';
  button.className =
    'rounded-md border border-primary bg-primary px-4 py-2 text-sm font-medium text-white';
  button.textContent = 'Unlock student secret';
  button.addEventListener('click', () => {
    void (async () => {
      const universityId = sessionStorage.getItem('usafe-student-university');
      if (!universityId) {
        toast('Please enrol before opening complaints.', 'danger');
        return;
      }
      try {
        await ensureUnlocked(universityId);
        await refreshCredential(universityId);
        await renderDetail(outlet, complaintId);
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not unlock.', 'danger');
      }
    })();
  });
  wrapper.append(message, button);
  return wrapper;
}

function supportText(count: number): string {
  return `${count} ${count === 1 ? 'student supports' : 'students support'} this complaint`;
}

function statusLabel(status: Status): string {
  const labels: Record<Status, string> = {
    not_started: 'Not started',
    pending_investigation: 'Pending investigation',
    finished: 'Finished',
  };
  return labels[status] ?? status;
}

function actorLabel(role: string): string {
  const labels: Record<string, string> = {
    student: 'Student',
    university: 'University',
    ugc: 'UGC',
    system: 'System',
  };
  return labels[role] ?? role;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace('_', ' ');
}

function formatAge(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    return diffHours === 0 ? 'just now' : `${diffHours}h ago`;
  }
  return `${diffDays}d ago`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}
