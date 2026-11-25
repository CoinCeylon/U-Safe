// Student secret derivation step (M051).
//
// `unlockStudent(universityId)` asks the connected wallet to sign the fixed
// message `U-Safe student secret v1|<universityId>` (CIP-30 signData), then
// derives the 32-byte student secret from that signature via HKDF-SHA256.
//
// The secret is kept in memory only. It is never written to storage and is
// re-derived on every new session (page refresh clears it). Because Ed25519
// signatures are deterministic, re-unlocking with the same wallet and
// university id produces the same secret, and therefore the same commitment.
//
// Imports:
//   @usafe/crypto  -> deriveStudentSecret, studentSecretMessage, commitment
//   ./wallet       -> connectWallet, isConnected, signMessage

import {
  commitment,
  deriveStudentSecret,
  studentSecretMessage,
} from '@usafe/crypto';
import {
  connectWallet,
  getAddress,
  isConnected,
  signMessage,
} from './wallet';

let studentSecret: Uint8Array | null = null;
let unlockedUniversityId: string | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Unlock the student secret for the given university.
 *
 * Connects the wallet (if not already connected), asks it to sign the
 * enrolment message, derives the secret, and holds it in memory.
 *
 * Returns the derived 32-byte secret.
 */
export async function unlockStudent(
  universityId: string,
): Promise<Uint8Array> {
  if (!isConnected()) {
    await connectWallet();
  }
  if (!isConnected()) {
    throw new Error('Wallet is not connected. Connect your wallet first.');
  }

  const message = studentSecretMessage(universityId);
  const signatureHex = await signMessage(message);
  const signatureBytes = hexToBytes(signatureHex);

  const secret = await deriveStudentSecret(signatureBytes, universityId);
  studentSecret = secret;
  unlockedUniversityId = universityId;
  return secret;
}

/**
 * Returns the in-memory student secret, or null if not yet unlocked.
 *
 * The secret never leaves memory and is never written to storage.
 */
export function getStudentSecret(): Uint8Array | null {
  return studentSecret;
}

/**
 * Returns the university id the secret was unlocked for, or null.
 */
export function getUnlockedUniversityId(): string | null {
  return unlockedUniversityId;
}

/**
 * Returns true if a student secret is currently held in memory.
 */
export function isUnlocked(): boolean {
  return studentSecret !== null;
}

/**
 * Computes the public commitment (Merkle leaf value) from the held secret.
 *
 * This is the only value that leaves the browser at enrollment. Returns null
 * if the student is not unlocked.
 */
export async function getCommitment(): Promise<Uint8Array | null> {
  if (studentSecret === null) {
    return null;
  }
  return commitment(studentSecret);
}

/**
 * Clears the held secret from memory. Call on logout or session end.
 */
export function clearStudentSecret(): void {
  studentSecret = null;
  unlockedUniversityId = null;
}

/**
 * Returns the connected wallet address, or null if not connected.
 */
export function getWalletAddress(): string | null {
  return getAddress();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid signature hex: odd length');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}
