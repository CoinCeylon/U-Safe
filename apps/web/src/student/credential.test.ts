import { describe, expect, it } from 'vitest';
import {
  Sha256Adapter,
  computeZeroNodes,
  MerkleTree,
  MERKLE_TREE_DEPTH,
} from '@usafe/crypto';
import { computeCredential } from './credential';

const adapter = new Sha256Adapter();

// Helper: generate a random 32-byte Uint8Array.
const randomBytes = (n: number): Uint8Array => {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Helper: convert a hex string to Uint8Array for the verify call.
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex: odd length');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

describe('computeCredential (M053)', () => {
  it('locates the own commitment and builds a verifiable Merkle path', async () => {
    const zeroNodes = await computeZeroNodes(MERKLE_TREE_DEPTH, adapter);
    const leaves = Array.from({ length: 7 }, () => randomBytes(32));
    const ownCommitment = leaves[3];
    const leavesHex = leaves.map(bytesToHex);

    const credential = await computeCredential(
      'university-demo',
      ownCommitment as Uint8Array,
      leavesHex,
    );

    expect(credential.universityId).toBe('university-demo');
    expect(credential.leafIndex).toBe(3);
    expect(credential.proof.length).toBe(MERKLE_TREE_DEPTH);
    expect(credential.root.length).toBe(64);

    const tree = new MerkleTree(MERKLE_TREE_DEPTH, adapter, zeroNodes);
    for (const leaf of leaves) {
      await tree.insert(leaf);
    }
    const valid = await MerkleTree.verify(
      ownCommitment as Uint8Array,
      credential.proof.map(hexToBytes),
      credential.leafIndex,
      tree.getRoot(),
      adapter,
    );
    expect(valid).toBe(true);
    expect(bytesToHex(tree.getRoot())).toBe(credential.root);
  });

  it('throws when the commitment is not in the leaf list', async () => {
    const leaves = Array.from({ length: 3 }, () => randomBytes(32));
    const leavesHex = leaves.map(bytesToHex);
    const missing = randomBytes(32);

    await expect(
      computeCredential('university-demo', missing, leavesHex),
    ).rejects.toThrow('Own commitment not found in university leaves');
  });

  it('produces the same credential for the same inputs', async () => {
    const leaves = Array.from({ length: 5 }, () => randomBytes(32));
    const leavesHex = leaves.map(bytesToHex);
    const commitment = leaves[1];

    const a = await computeCredential('university-demo', commitment as Uint8Array, leavesHex);
    const b = await computeCredential('university-demo', commitment as Uint8Array, leavesHex);

    expect(a).toEqual(b);
  });
});