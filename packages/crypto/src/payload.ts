// Community key and payload encryption. The community key is an AES-256
// symmetric key handed to enrolled students so they can read complaint
// descriptions of their own university. Evidence files use separate per-file
// keys wrapped to the university and UGC public keys (M016).

import { encryptBytes, decryptBytes, AES_KEY_SIZE } from './file';

// Generates a random 256-bit community key for a university.
export function generateCommunityKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(AES_KEY_SIZE));
}

// A sealed payload: AES-256-GCM encryption of the JSON payload plus the
// SHA-256 hash of the exact sealed bytes (`iv || ciphertext`). Hashing the
// bytes that are actually stored, rather than the plaintext, means the hash
// on the ledger always matches the stored blob (M017).
export interface SealedPayload {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  payloadHash: Uint8Array;
}

// Concatenates `iv || ciphertext` into the exact sealed byte sequence. The
// hash and the decryption both use these bytes.
export function sealedPayloadBytes(sealed: {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}): Uint8Array {
  const bytes = new Uint8Array(sealed.iv.length + sealed.ciphertext.length);
  bytes.set(sealed.iv);
  bytes.set(sealed.ciphertext, sealed.iv.length);
  return bytes;
}

// Serializes a payload object to JSON, encrypts it with the community key,
// and returns the sealed payload together with the SHA-256 of the exact sealed
// bytes. Tampering with the ciphertext changes the hash and also fails the
// GCM authentication check in openPayload.
//
// sealPayload(payload, communityKey) -> { iv, ciphertext, payloadHash }
export async function sealPayload(
  payload: unknown,
  communityKey: Uint8Array,
): Promise<SealedPayload> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(payload));
  const sealed = await encryptBytes(plaintext, communityKey);
  const iv = sealed.subarray(0, 12);
  const ciphertext = sealed.subarray(12);
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    sealedPayloadBytes({ iv, ciphertext }) as unknown as BufferSource,
  );
  return {
    iv,
    ciphertext,
    payloadHash: new Uint8Array(hashBuffer),
  };
}

// Decrypts a sealed payload with the community key, verifies the SHA-256 of
// the sealed bytes matches payloadHash, and returns the parsed JSON object.
// Throws if the key is wrong or the payload was tampered with.
export async function openPayload(
  sealed: SealedPayload,
  communityKey: Uint8Array,
): Promise<unknown> {
  const sealedBytes = sealedPayloadBytes(sealed);

  // Verify the sealed bytes before attempting decryption, so a tampered hash
  // is reported as a hash mismatch rather than a generic GCM failure.
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    sealedBytes as unknown as BufferSource,
  );
  const expectedHash = new Uint8Array(hashBuffer);
  if (
    expectedHash.length !== sealed.payloadHash.length ||
    expectedHash.some((byte, i) => byte !== sealed.payloadHash[i])
  ) {
    throw new Error('payload hash mismatch: payload may have been tampered');
  }

  const plaintext = await decryptBytes(sealedBytes, communityKey);
  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json);
}
