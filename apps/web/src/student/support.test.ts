import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MembershipProof } from '@usafe/shared';
import {
  commitment,
  mockNullifier,
  verifyMembershipMock,
} from '@usafe/crypto';
import { computeCredential, bytesToHex } from './credential';
import {
  buildSupportProof,
  DuplicateSupportError,
  postSupport,
} from './support';

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

const proof: MembershipProof = {
  universityId: 'uni-1',
  root: 'cd'.repeat(32),
  nullifier: 'ef'.repeat(32),
  kind: 'mock',
  data: JSON.stringify({
    commitment: 'ab'.repeat(32),
    path: [],
    context: 'support|complaint-7',
  }),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

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
      bytesToHex(await mockNullifier(ownCommitment, 'support|complaint-7')),
    );

    const data = JSON.parse(proof.data) as {
      commitment: string;
      path: string[];
      leafIndex?: number;
      context: string;
    };
    expect(data.commitment).toBe(bytesToHex(ownCommitment));
    // The leaf index is never included in the proof (M053).
    expect(data.leafIndex).toBeUndefined();
    expect(data.path).toEqual(credential.proof);
    expect(data.context).toBe('support|complaint-7');

    const valid = await verifyMembershipMock(proof, {
      roots: [credential.root],
      usedNullifiers: new Set<string>(),
      leafIndex: credential.leafIndex,
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

  it('maps only the reused support nullifier to the duplicate error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'support nullifier already used' }),
          { status: 400 },
        ),
      ),
    );

    await expect(postSupport('complaint-7', proof)).rejects.toBeInstanceOf(
      DuplicateSupportError,
    );
  });

  it('surfaces other 400 responses as real errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid membership proof' }), {
          status: 400,
        }),
      ),
    );

    try {
      await postSupport('complaint-7', proof);
      throw new Error('expected postSupport to reject');
    } catch (error) {
      expect(error).not.toBeInstanceOf(DuplicateSupportError);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('invalid membership proof');
    }
  });

  it('returns the confirmed support count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ supportCount: 4 }), { status: 200 }),
      ),
    );

    await expect(postSupport('complaint-7', proof)).resolves.toBe(4);
  });
});
