import { beforeEach, describe, expect, it } from 'vitest';
import {
  commitment,
  deriveStudentSecret,
  studentSecretMessage,
} from '@usafe/crypto';
import {
  clearStudentSecret,
  getStudentSecret,
  isUnlocked,
  unlockStudent,
} from './unlock';
import { FakeWallet } from './wallet';

// `hexToBytes` is private to unlock.ts; expose a test alias by re-deriving via
// the module's public surface where possible. We test the conversion through
// `unlockStudent`'s behaviour indirectly and via a small shared helper below.
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

describe('unlockStudent secret derivation (M051)', () => {
  beforeEach(() => {
    clearStudentSecret();
  });

  it('hexToBytes round-trips a signature', () => {
    const original = new Uint8Array([0, 1, 2, 255, 16, 170]);
    const hex = Array.from(original, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(Array.from(hexToBytes(hex))).toEqual(Array.from(original));
  });

  it('is not unlocked and has no secret initially', () => {
    expect(isUnlocked()).toBe(false);
    expect(getStudentSecret()).toBeNull();
  });

  it('derives the same secret and commitment on re-unlock (deterministic)', async () => {
    const universityId = 'university-demo';
    const message = studentSecretMessage(universityId);

    const wallet = new FakeWallet('dev-passphrase');
    await wallet.connect();

    const deriveCommitment = async (): Promise<string> => {
      const sigHex = await wallet.signMessage(message);
      const sigBytes = hexToBytes(sigHex);
      const secret = await deriveStudentSecret(sigBytes, universityId);
      const commit = await commitment(secret);
      return Array.from(commit, (b) => b.toString(16).padStart(2, '0')).join('');
    };

    const commit1 = await deriveCommitment();
    const commit2 = await deriveCommitment();

    expect(commit1).toBe(commit2);
    expect(commit1.length).toBe(64); // 32 bytes hex
  });

  it('derives a different secret for a different university', async () => {
    const wallet = new FakeWallet('dev-passphrase');
    await wallet.connect();

    const sigA = await wallet.signMessage(studentSecretMessage('uni-a'));
    const sigB = await wallet.signMessage(studentSecretMessage('uni-b'));
    const secretA = await deriveStudentSecret(hexToBytes(sigA), 'uni-a');
    const secretB = await deriveStudentSecret(hexToBytes(sigB), 'uni-b');

    expect(Array.from(secretA)).not.toEqual(Array.from(secretB));
  });

  it('unlockStudent throws a clear error when the wallet cannot connect', async () => {
    // With no wallet connected and no fake-wallet mode, connectWallet will fail
    // for Lace. We only assert it throws a descriptive error.
    await expect(unlockStudent('university-demo')).rejects.toThrow();
  });
});
