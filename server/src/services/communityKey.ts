// Community key delivery to enrolled students (submission pipeline, M060).
//
// The server stores each university's community key wrapped under
// COMMUNITY_DELIVERY_SECRET (`universities.community_key_wrapped_for_delivery`,
// written by `npm run seed:keys` / M065's key creation flow). This service
// unwraps that copy and returns the raw key over TLS, but only to callers
// that attach a valid enrollment proof (the route runs behind
// requireEnrollmentProof).
//
// Privacy notes:
// - The delivery secret and the unwrapped key are never logged.
// - The route logs only path, status and duration via the shared onResponse
//   hook, like every other route.
// - The key value is the one documented limitation of the design: the server
//   operator can read complaint descriptions (specification section 15).

import type Database from 'better-sqlite3';
import { SecureStore } from '@usafe/crypto';

export class CommunityKeyError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CommunityKeyError';
  }
}

interface UniversityKeyRow {
  community_key_wrapped_for_delivery: string | null;
}

/** Returns the university's raw community key, base64-encoded. */
export async function deliverCommunityKey(
  db: Database.Database,
  universityId: string,
  deliverySecret: string,
): Promise<string> {
  const row = db
    .prepare(
      'SELECT community_key_wrapped_for_delivery FROM universities WHERE id = ?',
    )
    .get(universityId) as UniversityKeyRow | undefined;

  if (row === undefined) {
    throw new CommunityKeyError('unknown university', 404);
  }
  if (row.community_key_wrapped_for_delivery === null) {
    throw new CommunityKeyError(
      'community key not available for this university',
      503,
    );
  }
  if (deliverySecret.length === 0) {
    throw new CommunityKeyError('community key delivery not configured', 503);
  }

  let parsed: Record<string, string>;
  try {
    parsed = await SecureStore.importBackup(
      row.community_key_wrapped_for_delivery,
      deliverySecret,
    );
  } catch {
    throw new CommunityKeyError('community key backup unreadable', 503);
  }

  const encoded = parsed['communityKey'];
  if (typeof encoded !== 'string') {
    throw new CommunityKeyError('community key backup unreadable', 503);
  }

  // Validate that the stored value is 32 bytes of base64 (an AES-256 key).
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length !== 32) {
    throw new CommunityKeyError('community key backup unreadable', 503);
  }
  return encoded;
}
