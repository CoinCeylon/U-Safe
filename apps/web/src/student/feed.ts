// Student community feed (M054/M056).
//
// Lists complaints for the student's university with filters and sorting, and
// listens to /api/events so complaints filed in another browser appear without
// a refresh. Cards link to the detail page where the support button lives.

import { toast } from '../ui/toast';
import { button } from '../ui/button';
import { friendlyError } from '../lib/offline';
import { getStudentSecret, getUnlockedUniversityId } from './unlock';
import {
  getCachedCredential,
  refreshCredential,
  stopWatchingRoots,
  watchRoots,
} from './credential';
import { ensureUnlocked } from './session';
import { getCommunityKey } from './submit';
import { loadComplaintDescription } from './complaintContent';
import { rememberComplaintText } from './complaint-text';

interface FeedComplaint {
  id: string;
  category: string;
  urgency: string;
  status: string;
  supportCount: number;
  ownerRole: string;
  payloadHash: string;
  createdAt: string;
  escalated: boolean;
}

type SortMode = 'newest' | 'supported';

let eventSource: EventSource | null = null;

export async function renderFeed(outlet: HTMLElement): Promise<void> {
  if (eventSource !== null) {
    eventSource.close();
    eventSource = null;
  }
  // Stop any previous root watcher before starting a new one for this view.
  stopWatchingRoots();

  if (getStudentSecret() === null) {
    outlet.replaceChildren(unlockPrompt(outlet));
    return;
  }

  // The credential cache is in memory only. After a fresh enrolment (or a
  // module reload) it can be empty even though the student is unlocked, so
  // rebuild it here instead of telling the student to "go back to the feed".
  let cred = getCachedCredential();
  if (!cred) {
    const universityId =
      getUnlockedUniversityId() ??
      sessionStorage.getItem('usafe-student-university');
    if (universityId === null) {
      outlet.innerHTML =
        '<p class="text-sm text-slate-600">Your enrollment credential is not ready yet. Go back to the feed and unlock your student secret again.</p>';
      return;
    }
    try {
      cred = await refreshCredential(universityId);
    } catch {
      outlet.innerHTML =
        '<p class="text-sm text-slate-600">Could not rebuild your enrollment credential. Unlock your student secret and try again.</p>';
      return;
    }
  }

  const universityId = cred.universityId;
  const univParam = encodeURIComponent(universityId);
  const secret = getStudentSecret();

  // Fetch the community key once for this view so cards can decrypt their
  // sealed payloads. A missing key leaves descriptions unavailable rather
  // than showing a misleading placeholder.
  let communityKey: Uint8Array | null = null;
  if (secret !== null) {
    try {
      communityKey = await getCommunityKey(fetch, secret, universityId, cred);
    } catch {
      communityKey = null;
    }
  }

  const wrapper = document.createElement('section');
  wrapper.className = 'flex flex-col gap-3 max-w-xl mx-auto py-2';

  const controls = document.createElement('div');
  controls.className = 'flex flex-col sm:flex-row gap-2';

  const statusFilter = selectControl(
    'Filter by status',
    [
      ['', 'All statuses'],
      ['not_started', 'Not started'],
      ['pending_investigation', 'Pending investigation'],
      ['finished', 'Finished'],
    ],
    '',
  );
  const categoryFilter = selectControl(
    'Filter by category',
    [
      ['', 'All categories'],
      ['verbal', 'Verbal'],
      ['physical', 'Physical'],
      ['sexual', 'Sexual'],
      ['cyber', 'Cyber'],
      ['financial', 'Financial'],
      ['other', 'Other'],
    ],
    '',
  );
  const sort = selectControl(
    'Sort complaints',
    [
      ['newest', 'Newest first'],
      ['supported', 'Most supported'],
    ],
    'newest',
  );
  controls.append(statusFilter, categoryFilter, sort);

  const list = document.createElement('div');
  list.className = 'flex flex-col gap-3';

  wrapper.append(controls, list);
  outlet.replaceChildren(wrapper);

  const loadComplaints = async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/complaints?university=${univParam}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { complaints?: FeedComplaint[] };
      const complaints = (payload.complaints ?? []).filter((complaint) => {
        const statusOk = statusFilter.value === '' || complaint.status === statusFilter.value;
        const categoryOk = categoryFilter.value === '' || complaint.category === categoryFilter.value;
        return statusOk && categoryOk;
      });

      const mode = sort.value as SortMode;
      complaints.sort((a, b) => {
        if (mode === 'supported') {
          return b.supportCount - a.supportCount;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      renderList(list, complaints, universityId, communityKey);
      return true;
    } catch (error) {
      // Error details are deliberately not shown to the student, but the
      // message says whether it looks like an offline failure.
      renderLoadError(list, error, async () => {
        const reloaded = await loadComplaints();
        if (reloaded) {
          connectEvents();
        }
      });
      return false;
    }
  };

  const connectEvents = (): void => {
    if (eventSource !== null) {
      eventSource.close();
      eventSource = null;
    }
    eventSource = new EventSource(`/api/events?university=${univParam}`);
    eventSource.onmessage = (event) => {
      try {
        const data = awaitSafeJson(String(event.data)) as { type?: unknown };
        if (
          data.type === 'complaint.created' ||
          data.type === 'complaint.supported' ||
          data.type === 'complaint.status' ||
          data.type === 'complaint.escalated'
        ) {
          void loadComplaints();
          if (data.type === 'complaint.created') {
            toast('A new complaint was filed.', 'info');
          }
        }
      } catch {
        // Ignore malformed event data; live updates are best-effort.
      }
    };
    // A dropped connection closes the stream; the next successful load or
    // the retry button reconnects it.
    eventSource.onerror = () => {
      if (eventSource !== null) {
        eventSource.close();
        eventSource = null;
      }
    };
  };

  statusFilter.addEventListener('change', () => void loadComplaints());
  categoryFilter.addEventListener('change', () => void loadComplaints());
  sort.addEventListener('change', () => void loadComplaints());

  if (await loadComplaints()) {
    connectEvents();
    // Refresh the local credential when the university root changes, so a
    // student who enrolled before newer students can still support (M053).
    watchRoots(universityId);
  }
}

function renderLoadError(
  outlet: HTMLElement,
  error: unknown,
  retry: () => Promise<void>,
): void {
  outlet.replaceChildren();
  const message = document.createElement('p');
  message.className = 'text-sm text-danger';
  message.textContent = friendlyError(
    error,
    'Could not load complaints. Please try again.',
  );
  const retryButton = button({
    label: 'Try again',
    variant: 'secondary',
    onClick: () => void retry(),
  });
  outlet.append(message, retryButton);
}

function renderList(
  outlet: HTMLElement,
  complaints: FeedComplaint[],
  universityId: string,
  communityKey: Uint8Array | null,
): void {
  outlet.replaceChildren();
  if (complaints.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-sm text-slate-600';
    empty.textContent = 'No complaints match these filters.';
    outlet.append(empty);
    return;
  }

  for (const complaint of complaints) {
    const card = document.createElement('article');
    card.className = 'rounded-lg border border-slate-200 bg-white p-4';

    const heading = document.createElement('h3');
    heading.className = 'font-medium text-slate-900';
    heading.textContent = `Complaint ${complaint.id}`;
    card.append(heading);

    const meta = document.createElement('p');
    meta.className = 'mt-1 text-xs text-slate-500';
    meta.textContent = `${titleCase(complaint.category)} • ${complaint.urgency} • ${statusLabel(complaint.status)} • ${formatAge(complaint.createdAt)}`;
    card.append(meta);

    const supports = document.createElement('p');
    supports.className = 'mt-2 text-sm text-slate-700';
    supports.textContent = `${complaint.supportCount} ${complaint.supportCount === 1 ? 'support' : 'supports'}`;
    card.append(supports);

    if (complaint.escalated) {
      const badge = document.createElement('span');
      badge.className = 'mt-2 inline-block rounded bg-danger-light px-2 py-1 text-xs text-danger';
      badge.textContent = 'Overdue';
      card.append(badge);
    }

    const description = document.createElement('p');
    description.className = 'mt-2 text-sm text-slate-600';
    if (complaint.ownerRole === 'ugc') {
      description.textContent = 'Details restricted to the UGC';
    } else {
      description.textContent = 'Loading description…';
      void loadComplaintDescription({
        payloadHash: complaint.payloadHash,
        ownerRole: complaint.ownerRole,
        communityKey,
      }).then((content) => {
        if (content.kind === 'text') {
          description.textContent = content.text;
          // Feed text is legitimately readable, so it also feeds the M059
          // duplicate-suggestion cache.
          rememberComplaintText(universityId, complaint.id, content.text);
        } else if (content.kind === 'restricted') {
          description.textContent = 'Details restricted to the UGC';
        } else {
          description.textContent = 'Description unavailable.';
        }
      });
    }
    card.append(description);

    const link = document.createElement('a');
    link.href = `#/complaint/${encodeURIComponent(complaint.id)}`;
    link.className = 'mt-2 inline-block text-sm text-primary underline';
    link.textContent = 'View details and support';
    card.append(link);

    outlet.append(card);
  }
}

function selectControl(
  label: string,
  options: Array<[string, string]>,
  value: string,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.className =
    'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:ring-2 focus:ring-primary-light';
  select.setAttribute('aria-label', label);
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    select.append(option);
  }
  select.value = value;
  return select;
}

function unlockPrompt(outlet: HTMLElement): HTMLElement {
  const wrapper = document.createElement('section');
  wrapper.className = 'flex flex-col gap-3 max-w-md mx-auto py-4';
  const message = document.createElement('p');
  message.className = 'text-sm text-slate-600';
  message.textContent = 'Unlock your student secret to see your community feed.';
  const button = document.createElement('button');
  button.type = 'button';
  button.className =
    'rounded-md border border-primary bg-primary px-4 py-2 text-sm font-medium text-white';
  button.textContent = 'Unlock student secret';
  button.addEventListener('click', () => {
    void (async () => {
      const universityId = sessionStorage.getItem('usafe-student-university');
      if (!universityId) {
        toast('Please enrol before opening the feed.', 'danger');
        return;
      }
      try {
        await ensureUnlocked(universityId);
        await refreshCredential(universityId);
        await renderFeed(outlet);
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not unlock.', 'danger');
      }
    })();
  });
  wrapper.append(message, button);
  return wrapper;
}

function awaitSafeJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    not_started: 'Not started',
    pending_investigation: 'Pending investigation',
    finished: 'Finished',
  };
  return labels[status] ?? status;
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
