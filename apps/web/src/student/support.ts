// Student support flow (M056).
//
// Builds a mock membership proof from the credential cached in the browser,
// submits it through the anonymity queue, and turns a reused support nullifier
// into a quiet duplicate result for the UI.
//
// Privacy notes:
// - The student secret never leaves the browser.
// - The proof carries the commitment, Merkle path, root and context; the server
//   verifies the path and then discards everything except the support nullifier.
// - The leaf index is not sent as a separate field.
// - The random delay prevents a support action being correlated with the click
//   that triggered it.

import {
  SubmitQueue,
  commitment,
  supportNullifier,
  type MockProofData,
} from '@usafe/crypto';
import type { MembershipProof } from '@usafe/shared';
import { bytesToHex, type CachedCredential } from './credential';

export const SUPPORT_DELAY_MIN_MS = 2_000;
export const SUPPORT_DELAY_MAX_MS = 12_000;

// A repeated support is not an error for the student: the button simply stays
// in the "You support this" state and the count is not changed.
export class DuplicateSupportError extends Error {
  constructor() {
    super('Support already recorded');
    this.name = 'DuplicateSupportError';
  }
}

/**
 * Builds a `support|<complaintId>` membership proof from data that was computed
 * locally by `refreshCredential`. The Merkle path is reused from the cache, so
 * no leaf index needs to be looked up on the server.
 */
export async function buildSupportProof(
  secret: Uint8Array,
  universityId: string,
  complaintId: string,
  credential: CachedCredential,
): Promise<MembershipProof> {
  const commitmentBytes = await commitment(secret);
  const nullifier = await supportNullifier(secret, complaintId);
  const context = `support|${complaintId}`;

  const data: MockProofData = {
    commitment: bytesToHex(commitmentBytes),
    path: credential.proof,
    leafIndex: credential.leafIndex,
    context,
  };

  return {
    universityId,
    root: credential.root,
    nullifier: bytesToHex(nullifier),
    kind: 'mock',
    data: JSON.stringify(data),
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : '';
  } catch {
    return '';
  }
}

/**
 * Sends one support request. HTTP errors that mean "already supported" are
 * converted into DuplicateSupportError so callers can handle them quietly.
 */
export async function postSupport(
  complaintId: string,
  proof: MembershipProof,
): Promise<number> {
  const response = await fetch(
    `/api/complaints/${encodeURIComponent(complaintId)}/support`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ complaintId, proof }),
    },
  );

  if (!response.ok) {
    const message = await readErrorMessage(response);
    if (
      response.status === 400 ||
      response.status === 409 ||
      message.includes('nullifier already used')
    ) {
      throw new DuplicateSupportError();
    }
    throw new Error(message || `Could not support complaint (HTTP ${response.status})`);
  }

  const payload = (await response.json()) as { supportCount?: unknown };
  if (typeof payload.supportCount !== 'number') {
    throw new Error('Server did not return a support count');
  }
  return payload.supportCount;
}

/**
 * Queues a support action behind a random 2–12 second delay and returns the
 * confirmed support count. One queue is created per click; the caller disables
 * the button while an action is pending, so submissions cannot pile up.
 */
export async function submitSupport(
  complaintId: string,
  proof: MembershipProof,
): Promise<number> {
  const queue = new SubmitQueue(
    SUPPORT_DELAY_MIN_MS,
    SUPPORT_DELAY_MAX_MS,
    async () => await postSupport(complaintId, proof),
  );
  return (await queue.submit()) as number;
}
