// Filing receipts (submission pipeline, M060).
//
// Each submitted complaint stores a local receipt, encrypted with the student
// secret in SecureStore (IndexedDB). Nothing here is sent to the server; the
// receipt lets the student recognise their own complaints later (the "My
// complaints" page is M061) and keeps a copy of what was filed.
//
// The receipt deliberately contains no unwrapped evidence keys. M061 extends
// it with per-file keys wrapped for the student themselves.

import { IndexedDbStorage, SecureStore, type SecureStore as Store } from '@usafe/crypto';
import { getStudentSecret } from './unlock';

export interface FilingEvidenceInfo {
  hash: string;
  name: string;
  type: string;
  size: number;
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
