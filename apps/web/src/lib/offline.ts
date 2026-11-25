// Offline handling helpers (M062).
//
// `fetch` rejects with a TypeError when the network is unreachable, and the
// browser reports `navigator.onLine === false` while offline. Together they
// give a friendly, actionable message instead of a raw stack of failures.
//
// Privacy: nothing here logs or transmits anything.

export const OFFLINE_MESSAGE =
  'You appear to be offline. Nothing was sent — check your connection and try again.';

/** True when the error looks like a network failure rather than a server response. */
export function isOfflineError(error: unknown): boolean {
  if (
    typeof navigator !== 'undefined' &&
    navigator.onLine === false
  ) {
    return true;
  }
  return error instanceof TypeError;
}

/**
 * Maps an error to a friendly, non-technical message. Offline errors get the
 * offline wording; anything else keeps its own message or the fallback.
 */
export function friendlyError(error: unknown, fallback: string): string {
  if (isOfflineError(error)) {
    return OFFLINE_MESSAGE;
  }
  return error instanceof Error && error.message !== ''
    ? error.message
    : fallback;
}
