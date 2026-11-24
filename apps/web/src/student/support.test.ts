import { describe, expect, it } from 'vitest';
import {
  commitment,
  supportNullifier,
  verifyMembershipMock,
} from '@usafe/crypto';
import { computeCredential, bytesToHex } from './credential';
import { buildSupportProof, DuplicateSupportError } from './support';

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

describe('student support flow (M056)', () => {
  it('builds a proof that verifies against the locally cached credential', async () => {
    const secret = randomBytes(32);
    const ownCommitment = await commitment(secret);
    const leaves = [randomBytes(32), ownCommitment, randomBytes(32)].map(bytesToHex);
    const credential = await computeCredential('uni-1', ownCommitment, leaves);

    const proof = await buildSupportProof(
      secret,
      'uni-1',
      'complaint-7',
      credential,
    );

    expect(proof.kind).toBe('mock');
    expect(proof.universityId).toBe('uni-1');
    expect(proof.root).toBe(credential.root);
    expect(proof.nullifier).toBe(
      bytesToHex(await supportNullifier(secret, 'complaint-7')),
    );

    const data = JSON.parse(proof.data) as {
      commitment: string;
      path: string[];
      leafIndex: number;
      context: string;
    };
    expect(data.commitment).toBe(bytesToHex(ownCommitment));
    expect(data.leafIndex).toBe(credential.leafIndex);
    expect(data.path).toEqual(credential.proof);
    expect(data.context).toBe('support|complaint-7');

    const valid = await verifyMembershipMock(proof, {
      roots: [credential.root],
      usedNullifiers: new Set<string>(),
    });
    expect(valid).toBe(true);
  });

  it('binds the nullifier to the complaint id', async () => {
    const secret = randomBytes(32);
    const ownCommitment = await commitment(secret);
    const leaves = [ownCommitment, randomBytes(32)].map(bytesToHex);
    const credential = await computeCredential('uni-1', ownCommitment, leaves);

    const first = await buildSupportProof(secret, 'uni-1', 'one', credential);
    const second = await buildSupportProof(secret, 'uni-1', 'two', credential);

    expect(first.nullifier).not.toBe(second.nullifier);
    expect(JSON.parse(first.data)).toMatchObject({ context: 'support|one' });
    expect(JSON.parse(second.data)).toMatchObject({ context: 'support|two' });
  });

  it('exposes a duplicate error type for quiet handling', () => {
    expect(new DuplicateSupportError().name).toBe('DuplicateSupportError');
  });
});
