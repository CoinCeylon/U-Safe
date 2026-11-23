// Constant prefix of the message a student signs to derive their wallet-based
// secret. The full message is `U-Safe student secret v1|<universityId>`,
// signed via CIP-30 signData. Because Ed25519 signatures are deterministic,
// restoring the wallet restores the same signature and therefore the same
// student secret (see roadmap section 0.8).
export const STUDENT_SECRET_MESSAGE_PREFIX = 'U-Safe student secret v1|';

// Builds the exact message bytes a student wallet must sign for a given
// university. This is the IKM source context recorded in section 0.8.
export function studentSecretMessage(universityId: string): string {
  return `${STUDENT_SECRET_MESSAGE_PREFIX}${universityId}`;
}

// Derives a 32-byte student secret from a wallet signature and university id
// using HKDF-SHA256.
//
// Input keying material (IKM) is the raw signature bytes produced by signing
// `studentSecretMessage(universityId)`. The university id is used as the HKDF
// salt so the same signature under a different university yields a different
// secret. No additional context info is mixed in.
//
// Returns a 32-byte Uint8Array that never leaves memory and is never written
// to storage (re-derived every session per M051).
export async function deriveStudentSecret(
  signatureBytes: Uint8Array,
  universityId: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const salt = encoder.encode(universityId);
  const info = new Uint8Array(0);

  const key = await crypto.subtle.importKey(
    'raw',
    signatureBytes as unknown as BufferSource,
    { name: 'HKDF', hash: 'SHA-256' },
    false,
    ['deriveBits'],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as unknown as BufferSource,
      info,
    },
    key,
    256, // 32 bytes expressed in bits
  );

  return new Uint8Array(derivedBits);
}
