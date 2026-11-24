import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  proveMembershipMock,
  verifyMembershipMock,
} from './proof.js';
import { MerkleTree, computeZeroNodes } from './merkle.js';
import { hash, Sha256Adapter } from './hash.js';
import { DOMAIN_TAG_COMMITMENT } from './nullifier.js';

// Helper: compute commitment from a secret (same as proveMembershipMock does).
async function commitmentFromSecret(secret: Uint8Array): Promise<string> {
  const bytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
  return Buffer.from(bytes).toString('hex');
}

// Helper: build a Merkle tree from commitments and return root + path for an index.
async function treeRootAndPath(
  commitments: string[],
  index: number,
): Promise<{ root: string; path: string[] }> {
  const zeroNodes = await computeZeroNodes(20, new Sha256Adapter());
  const tree = new MerkleTree(20, new Sha256Adapter(), zeroNodes);
  for (const hex of commitments) {
    await tree.insert(Buffer.from(hex, 'hex'));
  }
  const path = tree.proof(index);
  return {
    root: Buffer.from(tree.getRoot()).toString('hex'),
    path: path.map((sibling) => Buffer.from(sibling).toString('hex')),
  };
}

describe('proveMembershipMock / verifyMembershipMock (M038)', () => {
  it('produces a mock proof that verifies (filing context)', async () => {
    const secret = randomBytes(32);
    const commitmentHex = await commitmentFromSecret(secret);
    const other = await commitmentFromSecret(randomBytes(32));
    const leaves = [other, commitmentHex];
    const leafIndex = 1;

    const { root, path } = await treeRootAndPath(leaves, leafIndex);

    const proof = await proveMembershipMock(
      secret,
      leaves,
      leafIndex,
      'file|2024-01|0',
    );
    expect(proof.kind).toBe('mock');
    expect(proof.root).toBe(root);
    expect(proof.nullifier).toHaveLength(64);
    expect(proof.universityId).toBe('');

    // data must contain the path, commitment, leafIndex and context
    const data = JSON.parse(proof.data) as {
      commitment: string;
      path: string[];
      leafIndex: number;
      context: string;
    };
    expect(data.commitment).toBe(commitmentHex);
    expect(data.path).toEqual(path);
    expect(data.leafIndex).toBe(leafIndex);
    expect(data.context).toBe('file|2024-01|0');

    const valid = await verifyMembershipMock(proof, {
      roots: [root],
      usedNullifiers: new Set(),
    });
    expect(valid).toBe(true);
  });

  it('produces a mock proof that verifies (support context)', async () => {
    const secret = randomBytes(32);
    const commitmentHex = await commitmentFromSecret(secret);
    const leaves = [commitmentHex];
    const leafIndex = 0;

    const { root } = await treeRootAndPath(leaves, leafIndex);

    const proof = await proveMembershipMock(
      secret,
      leaves,
      leafIndex,
      'support|complaint-abc',
    );
    expect(proof.kind).toBe('mock');
    expect(proof.root).toBe(root);

    const valid = await verifyMembershipMock(proof, {
      roots: [root],
      usedNullifiers: new Set(),
    });
    expect(valid).toBe(true);
  });

  it('rejects a forged proof (wrong secret does not match leaf)', async () => {
    const secret = randomBytes(32);
    const wrongSecret = randomBytes(32);
    const commitmentHex = await commitmentFromSecret(secret);
    const leaves = [commitmentHex];

    await expect(
      proveMembershipMock(wrongSecret, leaves, 0, 'file|2024-01|0'),
    ).rejects.toThrow('secret does not match commitment at leaf index');
  });

  it('rejects an unknown root (not in grace window)', async () => {
    const secret = randomBytes(32);
    const commitmentHex = await commitmentFromSecret(secret);
    const leaves = [commitmentHex];

    const proof = await proveMembershipMock(
      secret,
      leaves,
      0,
      'file|2024-01|0',
    );

    const valid = await verifyMembershipMock(proof, {
      roots: ['0000000000000000000000000000000000000000000000000000000000000000'],
      usedNullifiers: new Set(),
    });
    expect(valid).toBe(false);
  });

  it('rejects a reused nullifier', async () => {
    const secret = randomBytes(32);
    const commitmentHex = await commitmentFromSecret(secret);
    const leaves = [commitmentHex];
    const { root } = await treeRootAndPath(leaves, 0);

    const proof = await proveMembershipMock(
      secret,
      leaves,
      0,
      'file|2024-01|0',
    );

    const used = new Set([proof.nullifier]);
    const valid = await verifyMembershipMock(proof, {
      roots: [root],
      usedNullifiers: used,
    });
    expect(valid).toBe(false);
  });

  it('rejects a tampered path', async () => {
    const secret = randomBytes(32);
    const commitmentHex = await commitmentFromSecret(secret);
    const other = await commitmentFromSecret(randomBytes(32));
    const leaves = [other, commitmentHex];
    const { root } = await treeRootAndPath(leaves, 1);

    const proof = await proveMembershipMock(
      secret,
      leaves,
      1,
      'file|2024-01|0',
    );

    // Tamper with the root so the path no longer recomputes to it.
    const tampered = {
      ...proof,
      root: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    };

    const valid = await verifyMembershipMock(tampered, {
      roots: [root],
      usedNullifiers: new Set(),
    });
    expect(valid).toBe(false);
  });

  it('derives different nullifiers for different contexts', async () => {
    const secret = randomBytes(32);
    const commitmentHex = await commitmentFromSecret(secret);
    const leaves = [commitmentHex];

    const fileProof = await proveMembershipMock(
      secret,
      leaves,
      0,
      'file|2024-01|0',
    );
    const supportProof = await proveMembershipMock(
      secret,
      leaves,
      0,
      'support|complaint-abc',
    );
    const fileProofSlot1 = await proveMembershipMock(
      secret,
      leaves,
      0,
      'file|2024-01|1',
    );

    expect(fileProof.nullifier).not.toBe(supportProof.nullifier);
    expect(fileProof.nullifier).not.toBe(fileProofSlot1.nullifier);
  });

  it('rejects slot other than 0 or 1 for filing context', async () => {
    const secret = randomBytes(32);
    const commitmentHex = await commitmentFromSecret(secret);
    const leaves = [commitmentHex];

    await expect(
      proveMembershipMock(secret, leaves, 0, 'file|2024-01|2'),
    ).rejects.toThrow('filing slot must be 0 or 1');
  });
});
