// Filing receipts (submission pipeline M060, receipts page M061).
//
// Each submitted complaint stores a local receipt, encrypted with the student
// secret in SecureStore (IndexedDB). Nothing here is sent to the server; the
// receipt lets the student recognise their own complaints later and
// re-download their own evidence.
//
// "Per-file keys wrapped for the student themselves" (M061): the per-file
// AES keys are stored inside this receipt, and SecureStore encrypts every
// value with a key derived from the student secret — that is the wrapping
// layer for the student. An extra AES wrap with the same root secret would
// add no security.
//
// The receipt never contains unwrapped evidence *content*, only keys and
// public blob hashes.

import { IndexedDbStorage, SecureStore, type SecureStore as Store } from '@usafe/crypto';
import { getStudentSecret } from './unlock';

export interface FilingEvidenceInfo {
  hash: string;
  name: string;
  type: string;
  size: number;
  /** Per-file AES-256 key, base64. Only readable via the student secret. */
  fileKey: string;
}

export interface FilingReceipt {
  complaintId: string;
  universityId: string;
  category: string;
  urgency: string;
  staffInvolved: boolean;
  payloadHash: string;
  payloadLocator: string;
  filedAt: string;
  description: string;
  evidence: FilingEvidenceInfo[];
  /** Last status seen on the live feed; updated via SSE events. */
  lastStatus?: string;
  /** Set when the complaint was seen as escalated. */
  escalated?: boolean;
}

const STORE_KEY = 'filings';

function openStore(): Store {
  const secret = getStudentSecret();
  if (secret === null) {
    throw new Error('Student secret is not unlocked');
  }
  return new SecureStore(secret, new IndexedDbStorage('usafe', 'student'));
}

function parseReceipts(raw: string | null): FilingReceipt[] {
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (entry): entry is FilingReceipt =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as FilingReceipt).complaintId === 'string' &&
      typeof (entry as FilingReceipt).filedAt === 'string',
  );
}

export async function loadFilingReceipts(
  store?: Store,
): Promise<FilingReceipt[]> {
  const opened = store ?? openStore();
  return parseReceipts(await opened.get(STORE_KEY));
}

export async function saveFilingReceipt(
  receipt: FilingReceipt,
  store?: Store,
): Promise<void> {
  const opened = store ?? openStore();
  const receipts = await loadFilingReceipts(opened);
  if (receipts.some((entry) => entry.complaintId === receipt.complaintId)) {
    return;
  }
  receipts.push(receipt);
  await opened.put(STORE_KEY, JSON.stringify(receipts));
}

/**
 * Records the latest observed status of a filed complaint so a reload of the
 * My complaints page starts from the last known state.
 */
export async function updateFilingStatus(
  complaintId: string,
  patch: { lastStatus?: string; escalated?: boolean },
  store?: Store,
): Promise<void> {
  const opened = store ?? openStore();
  const receipts = await loadFilingReceipts(opened);
  const receipt = receipts.find((entry) => entry.complaintId === complaintId);
  if (receipt === undefined) {
    return;
  }
  if (patch.lastStatus !== undefined) {
    receipt.lastStatus = patch.lastStatus;
  }
  if (patch.escalated !== undefined) {
    receipt.escalated = patch.escalated;
  }
  await opened.put(STORE_KEY, JSON.stringify(receipts));
}

/**
 * Counts receipts filed in the same local year-month as `date`. Used to show
 * the remaining monthly filing slots (M057) from local receipts only, without
 * asking the server about a student.
 */
export function countFilingsInMonth(
  receipts: FilingReceipt[],
  date: Date = new Date(),
): number {
  // Receipts store `filedAt` as an ISO UTC timestamp and the server enforces
  // filing months in UTC, so use the same period here (M039/M057).
  const yearMonth = date.toISOString().slice(0, 7);
  return receipts.filter((receipt) => receipt.filedAt.slice(0, 7) === yearMonth)
    .length;
}

/** Returns the receipts newest first (by filedAt). */
export function sortReceiptsNewestFirst(receipts: FilingReceipt[]): FilingReceipt[] {
  return [...receipts].sort(
    (a, b) =>
      new Date(b.filedAt).getTime() - new Date(a.filedAt).getTime(),
  );
}
