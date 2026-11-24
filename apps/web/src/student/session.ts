// Returning-student session helpers (M052/M053/M056).
//
// The university id is non-sensitive and is kept in sessionStorage so a page
// reload can ask the wallet to re-derive the secret. The encrypted enrolment
// receipt lives in SecureStore (IndexedDB); the secret itself is memory-only
// and is re-derived on every new session.

import { unlockStudent, getStudentSecret, getUnlockedUniversityId } from './unlock';

const UNIVERSITY_KEY = 'usafe-student-university';

export function rememberUniversity(universityId: string): void {
  try {
    sessionStorage.setItem(UNIVERSITY_KEY, universityId);
  } catch {
    // Storage is optional; the current session still works in memory.
  }
}

export function getRememberedUniversity(): string | null {
  try {
    return sessionStorage.getItem(UNIVERSITY_KEY);
  } catch {
    return null;
  }
}

export function clearRememberedUniversity(): void {
  try {
    sessionStorage.removeItem(UNIVERSITY_KEY);
  } catch {
    // ignore
  }
}

/**
 * Derives the student secret again if needed. Refreshing the page always
 * clears the in-memory secret, so this asks the wallet to sign the fixed
 * message once more.
 */
export async function ensureUnlocked(universityId: string): Promise<void> {
  const secret = getStudentSecret();
  if (secret !== null && getUnlockedUniversityId() === universityId) {
    return;
  }
  await unlockStudent(universityId);
}
