// Remembers which complaints a student has supported (M056).
//
// The list is encrypted with the student secret in SecureStore, so it survives
// a page reload but cannot be read by the server or by another browser
// profile. No complaint content is stored here, only opaque complaint ids.

import { IndexedDbStorage, SecureStore } from '@usafe/crypto';
import { getStudentSecret } from './unlock';

const STORE_KEY = 'supported-complaints';

function openStore(): SecureStore {
  const secret = getStudentSecret();
  if (secret === null) {
    throw new Error('Student secret is not unlocked');
  }
  return new SecureStore(secret, new IndexedDbStorage('usafe', 'student'));
}

export async function loadSupportedIds(): Promise<string[]> {
  const raw = await openStore().get(STORE_KEY);
  if (raw === null) {
    return [];
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((value): value is string => typeof value === 'string');
}

export async function hasSupported(complaintId: string): Promise<boolean> {
  const ids = await loadSupportedIds();
  return ids.includes(complaintId);
}

export async function rememberSupported(complaintId: string): Promise<void> {
  const ids = await loadSupportedIds();
  if (ids.includes(complaintId)) {
    return;
  }
  ids.push(complaintId);
  await openStore().put(STORE_KEY, JSON.stringify(ids));
}
