// Complaint text cache for duplicate suggestions (M059).
//
// The server never holds plaintext complaint descriptions: they live inside
// sealed payloads that only key holders can open. The student portal,
// however, legitimately reads complaint text in the browser (the student's
// own filings from M060 on, and community-key decryption of the feed from
// M065 on). Whenever the portal has read a description, `rememberComplaintText`
// caches it so the duplicate check can compare new text against it.
//
// Privacy rules for this cache:
// - Only community complaints belong here. Staff-involved complaints are
//   owned by the UGC, their text is restricted, and callers must never
//   cache it.
// - The cache lives in localStorage, not SecureStore, because community
//   complaint text is readable by every enrolled student of the university
//   by design (the community key model), and the duplicate check must also
//   work before the student secret is unlocked.
// - Nothing here is ever sent to the server.

import type { ComplaintText } from './similar';

const STORAGE_PREFIX = 'usafe-complaint-text-';
const MAX_TEXTS = 30;

interface StoredText {
  id: string;
  text: string;
  at: number;
}

export interface OpenComplaintMeta {
  id: string;
  category: string;
  status: string;
  ownerRole: string;
  supportCount: number;
}

/** An open, community-readable complaint with its cached description text. */
export interface OpenComplaintText extends OpenComplaintMeta {
  text: string;
}

function storageKey(universityId: string): string {
  return `${STORAGE_PREFIX}${universityId}`;
}

function readStored(universityId: string): StoredText[] {
  try {
    const raw = localStorage.getItem(storageKey(universityId));
    if (raw === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is StoredText =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as StoredText).id === 'string' &&
        typeof (entry as StoredText).text === 'string' &&
        typeof (entry as StoredText).at === 'number',
    );
  } catch {
    return [];
  }
}

/** Caches one description the browser has already read. Newest entries win. */
export function rememberComplaintText(
  universityId: string,
  complaintId: string,
  text: string,
): void {
  if (text.trim() === '') {
    return;
  }
  try {
    const stored = readStored(universityId).filter(
      (entry) => entry.id !== complaintId,
    );
    stored.push({ id: complaintId, text, at: Date.now() });
    // Oldest entries are dropped first so the cache stays small.
    while (stored.length > MAX_TEXTS) {
      stored.shift();
    }
    localStorage.setItem(
      storageKey(universityId),
      JSON.stringify(stored),
    );
  } catch {
    // Quota or privacy-mode failures must never break the form.
  }
}

/** Returns every cached description text for a university. */
export function loadComplaintTexts(universityId: string): ComplaintText[] {
  return readStored(universityId).map((entry) => ({
    id: entry.id,
    text: entry.text,
  }));
}

/** Drops the cached texts for a university. */
export function clearComplaintTexts(universityId: string): void {
  try {
    localStorage.removeItem(storageKey(universityId));
  } catch {
    // ignore
  }
}

/**
 * Joins the open complaints of a university with their cached text.
 * Finished complaints are closed, and UGC-owned (staff-involved) ones are
 * restricted, so neither can be suggested.
 */
export function selectOpenComplaintTexts(
  complaints: OpenComplaintMeta[],
  texts: ComplaintText[],
): OpenComplaintText[] {
  const textById = new Map(texts.map((entry) => [entry.id, entry.text]));
  const open: OpenComplaintText[] = [];
  for (const complaint of complaints) {
    if (complaint.status === 'finished' || complaint.ownerRole === 'ugc') {
      continue;
    }
    const text = textById.get(complaint.id);
    if (text === undefined || text.trim() === '') {
      continue;
    }
    open.push({ ...complaint, text });
  }
  return open;
}

/**
 * Loads the comparison corpus for the duplicate check: the open complaints
 * of one university whose description text is cached in this browser.
 * The list comes from the same student endpoint the feed uses; the texts
 * come only from the local cache. Failures yield an empty corpus so the
 * form still works offline.
 */
export async function loadOpenComplaintTexts(
  universityId: string,
): Promise<OpenComplaintText[]> {
  try {
    const response = await fetch(
      `/api/complaints?university=${encodeURIComponent(universityId)}`,
    );
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as { complaints?: unknown };
    const list: unknown[] = Array.isArray(payload.complaints) ? payload.complaints : [];
    const complaints: OpenComplaintMeta[] = list.filter(
        (entry): entry is OpenComplaintMeta =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as OpenComplaintMeta).id === 'string' &&
          typeof (entry as OpenComplaintMeta).category === 'string' &&
          typeof (entry as OpenComplaintMeta).status === 'string' &&
          typeof (entry as OpenComplaintMeta).ownerRole === 'string' &&
          typeof (entry as OpenComplaintMeta).supportCount === 'number',
      );
    return selectOpenComplaintTexts(complaints, loadComplaintTexts(universityId));
  } catch {
    return [];
  }
}
