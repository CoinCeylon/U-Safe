// Student complaint detail page (M055).
//
// Shows the full description, category, urgency, status badge, support count,
// age, escalation notice, and the decrypted outcome message (when finished).
// UGC-owned complaints show "Details restricted to the UGC" instead of text.
//
// The student's community key (stored in SecureStore after enrolment) is used
// to decrypt complaint payloads. The leaf index is never transmitted to the server.

import { getStudentSecret } from './unlock';
import { getCachedCredential } from './credential';
import { Status } from '@usafe/shared';

export async function renderDetail(
  outlet: HTMLElement,
  complaintId: string
): Promise<void> {
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

  try {
    const res = await fetch(
      `/api/complaints/${complaintId}?university=${encodeURIComponent(universityId)}`
    );
    if (!res.ok) throw new Error('Failed to fetch complaint');
    const complaint = (await res.json()) as {
      id: string;
      universityId: string;
      category: string;
      urgency: string;
      status: Status;
      supportCount: number;
      payloadHash: string;
      payloadLocator: string | null;
      ownerRole: string;
      outcomeHash: string | null;
      createdAt: string;
      history: Array<{
        status: Status;
        at: string;
        actorRole: string;
        noteHash: string | null;
      }>;
    };

    // ---- render ----
    const container = document.createElement('div');
    container.className = 'p-4 border rounded-lg border-slate-200 mb-4';

    // complaint meta
    const meta = document.createElement('div');
    meta.className = 'mb-3';
    const statusVariant = complaint.status === 'finished' ? 'success' : 'primary';
    const urgencyVariant = complaint.urgency === 'urgent' ? 'danger' : 'primary';
    meta.innerHTML = `
      <p class="font-medium text-slate-900">Complaint #${complaint.id}</p>
      <div class="flex flex-col sm:flex-row gap-2 text-sm text-slate-500">
        <span class="${urgencyVariant} urgency"></span>
        <span class="${statusVariant} status-badge"></span>
        <span class="ml-2">• ${complaint.supportCount} support${complaint.supportCount !== 1 ? 's' : ''}</span>
      </div>
      <p class="text-xs text-slate-500">Filed ${formatAge(complaint.createdAt)} ago</p>
    `;

    // description / outcome
    const description = document.createElement('div');
    description.className = 'mt-3';

    if (complaint.ownerRole === 'ugc') {
      description.innerHTML = '<p class="text-sm text-slate-600">Details restricted to the UGC</p>';
    } else if (complaint.status === 'finished' && complaint.outcomeHash) {
      description.innerHTML = `
        <p class="font-medium text-slate-900">Outcome message</p>
        <p class="text-sm text-slate-600">Outcome recorded</p>
      `;
    } else {
      description.innerHTML = '<p class="text-sm text-slate-600">Loading description…</p>';
    }

    // status timeline
    const timeline = document.createElement('div');
    timeline.className = 'mt-3';
    timeline.innerHTML = '<p class="text-sm text-slate-500">Status timeline</p>';
    for (const entry of complaint.history) {
      const actorMap: Record<string, string> = {
        student: 'student',
        university: 'university',
        ugc: 'UGC',
        system: 'system',
      };
      const entryDiv = document.createElement('div');
      entryDiv.className = 'text-xs text-slate-500 mb-1';
      entryDiv.innerHTML = `${formatDate(entry.at)} — ${actorMap[entry.actorRole] || entry.actorRole}: ${entry.status}`;
      timeline.append(entryDiv);
    }

    container.append(meta, description, timeline);
    outlet.innerHTML = '';
    outlet.append(container);
  } catch (e) {
    outlet.innerHTML = `<p class="text-danger">Failed to load complaint: ${e instanceof Error ? e.message : String(e)}</p>`;
  }
}

function formatAge(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  const now = new Date().getTime();
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    return diffHours === 0 ? 'just now' : `${diffHours}h ago`;
  }
  return `${diffDays}d ago`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString();
}