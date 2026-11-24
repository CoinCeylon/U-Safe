// Student community feed page (M054).
//
// Shows cards with complaint urgency badge, status badge, support count,
// and whether the description is restricted (UGC-owned). Includes live updates
// via SSE from /api/events.
//
// After enrolment, the student's community key is stored in SecureStore
// (encrypted with the student secret). UGC-owned complaints show
// "Details restricted to the UGC" instead of text.
//
// Live updates: the portal subscribes to /api/events and re-renders new
// complaints without a page refresh. A toast appears when a new complaint
// arrives from another student.

import { toast } from '../ui/toast';
import { getStudentSecret } from './unlock';
import { getCachedCredential } from './credential';

// --- helpers ---

const severityClass = (urgency: string): string => {
  const map: Record<string, string> = {
    normal: 'primary',
    urgent: 'danger',
  };
  return map[urgency] ?? 'primary';
};

const statusBadgeClass = (status: string): string => {
  const map: Record<string, string> = {
    not_started: 'warning',
    pending_investigation: 'primary',
    finished: 'success',
  };
  return map[status] ?? 'neutral';
};

export async function renderFeed(outlet: HTMLElement): Promise<void> {
  const secret = getStudentSecret();
  if (secret === null) {
    outlet.innerHTML = '<p class="text-slate-600">Please enrol first.</p>';
    return;
  }

  const cred = getCachedCredential();
  if (!cred) {
    outlet.innerHTML = '<p class="text-slate-600">Credential not cached.</p>';
    return;
  }

  const universityId = cred.universityId;
  const univParam = encodeURIComponent(universityId);

  // ---- fetch complaint list ----
  async function loadComplaints(): Promise<void> {
    try {
      const res = await fetch(`/api/complaints?${univParam}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        complaints: Array<{ id: string; urgency: string; status: string; supportCount: number; ownerRole: string }>;
      };
      const complaintsLocal = (data.complaints || []).map((c) => ({
        id: c.id,
        urgency: c.urgency ?? 'normal',
        status: c.status ?? 'not_started',
        supportCount: c.supportCount ?? 0,
        restricted: (c.ownerRole ?? '') === 'ugc',
      }));

      // render
      const container = document.createElement('div');
      container.className = 'space-y-3';
      if (complaintsLocal.length === 0) {
        container.innerHTML = '<p class="text-slate-600">No complaints found.</p>';
      } else {
        for (const c of complaintsLocal) {
          const card = document.createElement('div');
          card.className = 'p-3 border rounded-lg border-slate-200';
          card.innerHTML = `
            <div class="flex items-center justify-between mb-1">
              <h3 class="font-medium text-slate-900">Complaint #${c.id}</h3>
              <span class="text-xs text-slate-500">
                <span class="${severityClass(c.urgency)} urgency"></span>
                <span class="text-${statusBadgeClass(c.status)}-600 status"></span>
                <span class="ml-2">• ${c.supportCount} support${c.supportCount !== 1 ? 's' : ''}</span>
              </span>
            </div>
            <p class="text-sm text-slate-600 desc">
              ${c.restricted ? 'Details restricted to the UGC' : 'Loading description…'}
            </p>
            <button class="mt-2 text-primary underline text-xs show-detail">
              ${c.restricted ? 'Show details' : 'Close'}
            </button>
          `;
          container.append(card);
        }
      }
      outlet.innerHTML = '';
      outlet.append(container);
    } catch (e) {
      outlet.innerHTML = `<p class="text-danger">Failed to load complaints: ${e instanceof Error ? e.message : String(e)}</p>`;
    }
  }

  // ---- subscribe to SSE ----
  function subscribeEvents(): void {
    const evtSource = new EventSource(`/api/events?${univParam}`);
    evtSource.onmessage = (event) => {
      try {
        const data: { type: string; id?: string } = JSON.parse(event.data as string /* eslint-disable-line @typescript-eslint/no-unsafe-assignment */);
        if (data.type === 'complaint.created' as string) {
          void loadComplaints();
          toast('A new complaint was filed.', 'info');
        }
      } catch {
        // ignore malformed messages
      }
    };
    evtSource.onerror = () => evtSource.close();
  }

  // ---- init ----
  await loadComplaints();
  subscribeEvents();
}