// Complaint content decryption (M054/M055).
//
// The server only ever stores a sealed payload blob under its hash. A student
// portal can read a complaint description by downloading that blob and opening
// it with the university community key (normal complaints) or by showing
// "Details restricted to the UGC" for staff-involved (ugc-only) envelopes.
//
// Nothing here sends plaintext anywhere: decryption happens in the browser and
// the result is only rendered and (for open community complaints) cached for
// the M059 duplicate-suggestion comparison.

import {
  openSealedEnvelope,
  parseSealedEnvelope,
  type SealedEnvelope,
} from '../lib/sealedEnvelope';

export type ComplaintContent =
  | { kind: 'text'; text: string }
  | { kind: 'restricted' }
  | { kind: 'unavailable' };

export interface ComplaintContentOptions {
  payloadHash: string;
  ownerRole: string;
  communityKey: Uint8Array | null;
  fetchImpl?: typeof fetch;
}

async function fetchEnvelope(
  hash: string,
  fetchImpl: typeof fetch,
): Promise<SealedEnvelope | null> {
  try {
    const response = await fetchImpl(`/api/blobs/${encodeURIComponent(hash)}`);
    if (!response.ok) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return parseSealedEnvelope(bytes);
  } catch {
    return null;
  }
}

function descriptionFromPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const description = (payload as { description?: unknown }).description;
  return typeof description === 'string' && description.trim() !== ''
    ? description
    : null;
}

/**
 * Downloads and decrypts a complaint's sealed payload.
 *
 * - `ugc-only` envelopes are restricted to the UGC, so students see the
 *   restricted message even if they somehow hold another key.
 * - A missing blob, a missing community key or a failed decrypt returns
 *   `unavailable` so the UI never pretends to have read the text.
 */
export async function loadComplaintDescription(
  options: ComplaintContentOptions,
): Promise<ComplaintContent> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const envelope = await fetchEnvelope(options.payloadHash, fetchImpl);
  if (envelope === null) {
    return { kind: 'unavailable' };
  }
  if (envelope.kind === 'ugc-only' || options.ownerRole === 'ugc') {
    return { kind: 'restricted' };
  }
  if (options.communityKey === null) {
    return { kind: 'unavailable' };
  }
  try {
    const payload = await openSealedEnvelope(envelope, options.communityKey);
    const text = descriptionFromPayload(payload);
    return text === null ? { kind: 'unavailable' } : { kind: 'text', text };
  } catch {
    return { kind: 'unavailable' };
  }
}

/**
 * Downloads and decrypts a finished complaint's outcome message. Outcomes are
 * sealed with the university community key (M041) and stored under the hash
 * the ledger records as `outcomeHash`.
 */
export async function loadOutcomeMessage(
  outcomeHash: string,
  communityKey: Uint8Array | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ComplaintContent> {
  const envelope = await fetchEnvelope(outcomeHash, fetchImpl);
  if (envelope === null) {
    return { kind: 'unavailable' };
  }
  if (envelope.kind === 'ugc-only' || communityKey === null) {
    return { kind: 'restricted' };
  }
  try {
    const payload = await openSealedEnvelope(envelope, communityKey);
    if (typeof payload === 'string') {
      return { kind: 'text', text: payload };
    }
    if (typeof payload === 'object' && payload !== null) {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim() !== '') {
        return { kind: 'text', text: message };
      }
      const description = (payload as { description?: unknown }).description;
      if (typeof description === 'string' && description.trim() !== '') {
        return { kind: 'text', text: description };
      }
    }
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
