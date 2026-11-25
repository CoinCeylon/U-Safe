// Community key delivery helpers (M065).
//
// A community key is a 32-byte AES-256 key. The server never stores it in
// plaintext: the copy for the UGC is wrapped with the UGC RSA public key by
// the admin browser, and the copy for student delivery is wrapped with
// COMMUNITY_DELIVERY_SECRET using the same PBKDF2 + AES-256-GCM backup format
// as the demo key seed. Enrollment unwraps the delivery copy and sends the
// key to the student over TLS.

import type Database from 'better-sqlite3';
import { AES_KEY_SIZE, SecureStore } from '@usafe/crypto';

export const encodeBase64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64');

export const decodeBase64 = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value, 'base64'));

/** True when `value` is canonical base64 that decodes to a 32-byte AES key. */
export const isValidCommunityKey = (value: string): boolean => {
  if (value.length === 0) {
    return false;
  }
  const decoded = Buffer.from(value, 'base64');
  return (
    decoded.length === AES_KEY_SIZE &&
    decoded.toString('base64') === value
  );
};

/** True for a non-empty base64 string that is at least one RSA block long. */
export const isValidWrappedKey = (value: string): boolean => {
  if (value.length === 0) {
    return false;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.length >= 128 && decoded.toString('base64') === value;
};

/**
 * Academic year label for a key creation date. The academic year starts in
 * July: a key made in July 2026 or later belongs to 2026/2027.
 */
export const academicYearFor = (date: Date): string => {
  const year = date.getUTCFullYear();
  return date.getUTCMonth() >= 6
    ? `${year}/${year + 1}`
    : `${year - 1}/${year}`;
};

/** Wraps the raw community key for delivery under the server secret. */
export const wrapForDelivery = (
  communityKeyBase64: string,
  deliverySecret: string,
): Promise<string> =>
  SecureStore.exportBackup({ communityKey: communityKeyBase64 }, deliverySecret);

/**
 * Unwraps the delivery copy. Returns null when no delivery secret is
 * configured or the stored blob cannot be opened with it.
 */
export const unwrapForDelivery = async (
  wrappedForDelivery: string | null,
  deliverySecret: string | undefined,
): Promise<string | null> => {
  if (
    wrappedForDelivery === null ||
    deliverySecret === undefined ||
    deliverySecret === ''
  ) {
    return null;
  }
  try {
    const keys = await SecureStore.importBackup(
      wrappedForDelivery,
      deliverySecret,
    );
    const value = keys.communityKey;
    return typeof value === 'string' && isValidCommunityKey(value)
      ? value
      : null;
  } catch {
    return null;
  }
};

/**
 * The UGC public key used to wrap every university community key. The UGC
 * officers share one key pair, seeded on a staff row with no university.
 */
export const getUgcPublicKeyJwk = (
  db: Database.Database,
): string | null => {
  const row = db
    .prepare(
      `SELECT public_key_jwk FROM staff
       WHERE university_id IS NULL
         AND role IN ('ugc', 'ugc_officer')
         AND public_key_jwk IS NOT NULL
       ORDER BY id ASC LIMIT 1`,
    )
    .get() as { public_key_jwk: string } | undefined;
  return row?.public_key_jwk ?? null;
};
