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
// SHA-256 hash of the plaintext for integrity verification.
export interface SealedPayload {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  payloadHash: Uint8Array;
}

// Serializes a payload object to JSON, computes its SHA-256 hash, encrypts it
// with the community key, and returns the sealed payload together with the
// hash. Tampering with the ciphertext or the hash causes openPayload to fail.
//
// sealPayload(payload, communityKey) -> { iv, ciphertext, payloadHash }
export async function sealPayload(
  payload: unknown,
  communityKey: Uint8Array,
): Promise<SealedPayload> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(payload));
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    plaintext as unknown as BufferSource, // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion
  );
  const payloadHash = new Uint8Array(hashBuffer);
  const sealed = await encryptBytes(plaintext, communityKey);
  return {
    iv: sealed.subarray(0, 12),
    ciphertext: sealed.subarray(12),
    payloadHash,
  };
}

// Decrypts a sealed payload with the community key, verifies the SHA-256
// hash of the plaintext matches payloadHash, and returns the parsed JSON
// object. Throws if the key is wrong or the payload was tampered with.
export async function openPayload(
  sealed: SealedPayload,
  communityKey: Uint8Array,
): Promise<unknown> {
  const sealedBytes = new Uint8Array(
    sealed.iv.length + sealed.ciphertext.length,
  );
  sealedBytes.set(sealed.iv);
  sealedBytes.set(sealed.ciphertext, sealed.iv.length);

  const plaintext = await decryptBytes(sealedBytes, communityKey);
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    plaintext as unknown as BufferSource,
  );
  const expectedHash = new Uint8Array(hashBuffer);
  if (
    expectedHash.length !== sealed.payloadHash.length ||
    expectedHash.some((byte, i) => byte !== sealed.payloadHash[i])
  ) {
    throw new Error('payload hash mismatch: payload may have been tampered');
  }

  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json);
}
