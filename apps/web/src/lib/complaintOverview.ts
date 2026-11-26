// Shared read-only complaint overview for the university and UGC portals
// (M060).
//
// M063+/M073+ replace these portals with full role-aware workflows. This
// milestone only needs a complaint filed in the student portal to be visible
// on every portal with its correct (zero) support count, so the shared view
// fetches the same public, proof-less list endpoint the student feed uses and
// renders metadata only.

interface OverviewComplaint {
  id: string;
  category: string;
  urgency?: string;
  status: string;
  supportCount: number;
  ownerRole?: string;
  escalated?: boolean;
  createdAt: string;
}

interface OverviewUniversity {
  id: string;
  name: string;
}

async function fetchUniversities(): Promise<OverviewUniversity[]> {
  const response = await fetch('/api/universities');
  if (!response.ok) {
    throw new Error('Could not load universities');
  }
  const payload = (await response.json()) as { id?: unknown }[];
  return (Array.isArray(payload) ? payload : [])
    .filter(
      (entry): entry is OverviewUniversity =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as OverviewUniversity).id === 'string' &&
        typeof (entry as OverviewUniversity).name === 'string',
    )
    .map((entry) => ({ id: entry.id, name: entry.name }));
}

async function fetchComplaints(
  universityId: string,
): Promise<OverviewComplaint[]> {
  const response = await fetch(
    `/api/complaints?university=${encodeURIComponent(universityId)}`,
  );
  if (!response.ok) {
    throw new Error('Could not load complaints');
  }
  const payload = (await response.json()) as { complaints?: unknown };
  const list = Array.isArray(payload.complaints) ? payload.complaints : [];
  return list.filter(
    (entry): entry is OverviewComplaint =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as OverviewComplaint).id === 'string' &&
      typeof (entry as OverviewComplaint).category === 'string' &&
      typeof (entry as OverviewComplaint).status === 'string' &&
      typeof (entry as OverviewComplaint).supportCount === 'number',
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    not_started: 'Not started',
    pending_investigation: 'Pending investigation',
    finished: 'Finished',
  };
  return labels[status] ?? status;
}

function complaintCard(complaint: OverviewComplaint): HTMLElement {
  const card = document.createElement('article');
  card.className = 'rounded-lg border border-slate-200 bg-white p-3';
  const heading = document.createElement('h3');
  heading.className = 'font-medium text-slate-900';
  heading.textContent = `Complaint ${complaint.id}`;
  const meta = document.createElement('p');
  meta.className = 'mt-1 text-xs text-slate-500';
  meta.textContent = `${complaint.category} • ${statusLabel(complaint.status)} • ${complaint.supportCount} ${
    complaint.supportCount === 1 ? 'support' : 'supports'
  }`;
  card.append(heading, meta);
  if (complaint.escalated === true) {
    const badge = document.createElement('span');
    badge.className =
      'mt-2 inline-block rounded bg-danger-light px-2 py-1 text-xs text-danger';
    badge.textContent = 'Overdue';
    card.append(badge);
  }
  return card;
}

function renderComplaintGroup(
  outlet: HTMLElement,
  title: string,
  complaints: OverviewComplaint[],
): void {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-2';
  const heading = document.createElement('h2');
  heading.className = 'text-base font-semibold text-slate-900';
  heading.textContent = title;
  section.append(heading);
  if (complaints.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-sm text-slate-500';
    empty.textContent = 'No complaints yet.';
    section.append(empty);
  } else {
    for (const complaint of complaints) {
      section.append(complaintCard(complaint));
    }
  }
  outlet.append(section);
}

/**
 * University portal overview: choose a university, then see its complaints.
 */
export async function renderUniversityComplaintOverview(
  outlet: HTMLElement,
): Promise<void> {
  const wrapper = document.createElement('section');
  wrapper.className = 'flex flex-col gap-4 max-w-xl mx-auto py-2';
  const label = document.createElement('label');
  label.htmlFor = 'overview-university';
  label.className = 'text-sm font-medium text-slate-700';
  label.textContent = 'University';
  const select = document.createElement('select');
  select.id = 'overview-university';
  select.className =
    'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm';
  const groups = document.createElement('div');
  groups.className = 'flex flex-col gap-4';
  wrapper.append(label, select, groups);
  outlet.replaceChildren(wrapper);

  const universities = await fetchUniversities();
  for (const university of universities) {
    const option = document.createElement('option');
    option.value = university.id;
    option.textContent = university.name;
    select.append(option);
  }
  if (universities.length === 0) {
    groups.textContent = 'No universities configured.';
    return;
  }

  const load = async (): Promise<void> => {
    groups.replaceChildren();
    try {
      const complaints = await fetchComplaints(select.value);
      renderComplaintGroup(groups, 'Complaints', complaints);
    } catch (error) {
      groups.textContent =
        error instanceof Error ? error.message : 'Could not load complaints.';
    }
  };
  select.addEventListener('change', () => void load());
  await load();
}

/**
 * UGC portal overview: every university's complaints, aggregated in the
 * browser from the public per-university list endpoint.
 */
export async function renderUgcComplaintOverview(
  outlet: HTMLElement,
): Promise<void> {
  const wrapper = document.createElement('section');
  wrapper.className = 'flex flex-col gap-4 max-w-xl mx-auto py-2';
  outlet.replaceChildren(wrapper);
  try {
    const universities = await fetchUniversities();
    for (const university of universities) {
      const complaints = await fetchComplaints(university.id);
      renderComplaintGroup(wrapper, university.name, complaints);
    }
    if (universities.length === 0) {
      wrapper.textContent = 'No universities configured.';
    }
  } catch (error) {
    wrapper.textContent =
      error instanceof Error ? error.message : 'Could not load complaints.';
  }
}
