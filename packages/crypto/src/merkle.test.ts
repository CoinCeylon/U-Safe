import { describe, it, expect } from 'vitest';
import { Sha256Adapter, hash } from './hash';
import {
  computeZeroNodes,
  MerkleTree,
} from './merkle';

const enc = new TextEncoder();

async function makeTree(depth: number) {
  const adapter = new Sha256Adapter();
  const zeroNodes = await computeZeroNodes(depth, adapter);
  return new MerkleTree(depth, adapter, zeroNodes);
}

describe('computeZeroNodes', () => {
  it('produces deterministic zero nodes', async () => {
    const adapter = new Sha256Adapter();
    const a = await computeZeroNodes(5, adapter);
    const b = await computeZeroNodes(5, adapter);
    expect(a).toHaveLength(6);
    expect(a[0]!).toEqual(b[0]);
    expect(a[5]!).toEqual(b[5]);
  });

  it('depth 0 zero node is 32 zero bytes', async () => {
    const adapter = new Sha256Adapter();
    const nodes = await computeZeroNodes(0, adapter);
    expect(nodes[0]!).toHaveLength(32);
    for (const byte of nodes[0]!) {
      expect(byte).toBe(0);
    }
  });

  it('each deeper zero node is the inner hash of the previous with itself', async () => {
    const adapter = new Sha256Adapter();
    const nodes = await computeZeroNodes(3, adapter);
    const expected = await adapter.hash(
      'merkle-inner',
      nodes[0]!,
      nodes[0]!,
    );
    expect(nodes[1]!).toEqual(expected);
  });
});

describe('MerkleTree insert and root', () => {
  it('root of an empty tree is the depth zero node', async () => {
    const tree = await makeTree(5);
    const adapter = new Sha256Adapter();
    const zeroNodes = await computeZeroNodes(5, adapter);
    expect(tree.getRoot()).toEqual(zeroNodes[5]!);
    expect(tree.getLeafCount()).toBe(0);
  });

  it('inserting one leaf changes the root', async () => {
    const tree = await makeTree(5);
    const before = tree.getRoot();
    await tree.insert(enc.encode('leaf-a'));
    const after = tree.getRoot();
    expect(tree.getLeafCount()).toBe(1);
    expect(after).not.toEqual(before);
  });

  it('inserting the same leaf twice gives different roots (different indices)', async () => {
    const tree = await makeTree(5);
    await tree.insert(enc.encode('same-leaf'));
    const rootAfterOne = tree.getRoot();
    await tree.insert(enc.encode('same-leaf'));
    const rootAfterTwo = tree.getRoot();
    expect(rootAfterTwo).not.toEqual(rootAfterOne);
  });
});

describe('MerkleTree proof and verify', () => {
  it('verifies a proof for a single leaf', async () => {
    const tree = await makeTree(10);
    await tree.insert(enc.encode('only-leaf'));
    const proof = tree.proof(0);
    expect(proof).toHaveLength(10);
    const ok = await MerkleTree.verify(
      enc.encode('only-leaf'),
      proof,
      0,
      tree.getRoot(),
      new Sha256Adapter(),
    );
    expect(ok).toBe(true);
  });

  it('verifies proofs for leaves at different positions', async () => {
    const tree = await makeTree(10);
    const leaves = ['leaf-0', 'leaf-1', 'leaf-2', 'leaf-3'].map((s) =>
      enc.encode(s),
    );
    for (const leaf of leaves) {
      await tree.insert(leaf);
    }
    const root = tree.getRoot();
    for (let i = 0; i < leaves.length; i += 1) {
      const proof = tree.proof(i);
      expect(proof).toHaveLength(10);
      const ok = await MerkleTree.verify(
        leaves[i]!,
        proof,
        i,
        root,
        new Sha256Adapter(),
      );
      expect(ok).toBe(true);
    }
  });

  it('rejects a tampered proof', async () => {
    const tree = await makeTree(10);
    await tree.insert(enc.encode('real-leaf'));
    const proof = tree.proof(0);
    // Flip a byte in the first sibling.
    const tampered = new Uint8Array(proof[0]!);
    tampered[0]! ^= 0xff;
    const tamperedProof = [tampered, ...proof.slice(1)];
    const ok = await MerkleTree.verify(
      enc.encode('real-leaf'),
      tamperedProof,
      0,
      tree.getRoot(),
      new Sha256Adapter(),
    );
    expect(ok).toBe(false);
  });

  it('rejects a proof for the wrong leaf', async () => {
    const tree = await makeTree(10);
    await tree.insert(enc.encode('leaf-a'));
    await tree.insert(enc.encode('leaf-b'));
    const proofA = tree.proof(0);
    const ok = await MerkleTree.verify(
      enc.encode('leaf-b'),
      proofA,
      0,
      tree.getRoot(),
      new Sha256Adapter(),
    );
    expect(ok).toBe(false);
  });

  it('throws proof() for an out-of-range index', async () => {
    const tree = await makeTree(10);
    await tree.insert(enc.encode('only-leaf'));
    expect(() => tree.proof(1)).toThrow('leaf index out of range');
  });

  it('handles 1000 leaves with consistent roots and proofs', async () => {
    const tree = await makeTree(20);
    const leafCount = 1000;
    const leaves: Uint8Array[] = [];
    for (let i = 0; i < leafCount; i += 1) {
      leaves.push(enc.encode(`leaf-${i}`));
    }
    const rootBefore = tree.getRoot();
    for (const leaf of leaves) {
      await tree.insert(leaf);
    }
    expect(tree.getLeafCount()).toBe(leafCount);
    const rootAfter = tree.getRoot();
    expect(rootAfter).not.toEqual(rootBefore);

    // Verify a few leaves at different positions.
    for (const i of [0, 1, 500, 999]) {
      const proof = tree.proof(i);
      expect(proof).toHaveLength(20);
      const ok = await MerkleTree.verify(
        leaves[i]!,
        proof,
        i,
        rootAfter,
        new Sha256Adapter(),
      );
      expect(ok).toBe(true);
    }
  });
});

describe('MerkleTree domain separation', () => {
  it('inner node hashes differ from leaf hashes for the same bytes', async () => {
    const adapter = new Sha256Adapter();
    const leafHash = await hash('commitment', enc.encode('same-bytes'));
    const innerHash = await adapter.hash(
      'merkle-inner',
      enc.encode('same-bytes'),
      enc.encode('same-bytes'),
    );
    expect(leafHash).not.toEqual(innerHash);
  });
});
