import { createHash } from 'node:crypto';
import { MERKLE_TREE_DEPTH } from '@usafe/shared';

export interface EnrollmentReceipt {
  leafIndex: number;
  path: string[];
  root: string;
}

export interface EnrollmentLedger {
  enrollCommitment(universityId: string, commitment: string): EnrollmentReceipt;
}

const DOMAIN_TAG_MERKLE_INNER = 'merkle-inner';

type Bytes = Buffer<ArrayBufferLike>;

const lengthPrefix = (bytes: Uint8Array): Bytes => {
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64BE(BigInt(bytes.length));
  return Buffer.concat([prefix, Buffer.from(bytes)]);
};

const hashPair = (left: Bytes, right: Bytes): Bytes =>
  createHash('sha256')
    .update(lengthPrefix(Buffer.from(DOMAIN_TAG_MERKLE_INNER, 'utf8')))
    .update(lengthPrefix(left))
    .update(lengthPrefix(right))
    .digest();

const zeros: Bytes[] = [Buffer.alloc(32)];
for (let level = 1; level <= MERKLE_TREE_DEPTH; level += 1) {
  const previous = zeros[level - 1]!;
  zeros.push(hashPair(previous, previous));
}

interface TreeState {
  leaves: Bytes[];
  nodes: Bytes[][];
}

// Temporary in-memory stand-in for the mock ledger defined in M035/M037.
export class StubLedger implements EnrollmentLedger {
  private readonly trees = new Map<string, TreeState>();

  enrollCommitment(universityId: string, commitment: string): EnrollmentReceipt {
    const leaf: Bytes = Buffer.from(commitment, 'hex');
    if (leaf.length !== 32) {
      throw new Error('invalid commitment');
    }

    let state = this.trees.get(universityId);
    if (state === undefined) {
      state = { leaves: [], nodes: [] };
      this.trees.set(universityId, state);
    }
    if (state.leaves.some((existing) => existing.equals(leaf))) {
      throw new Error('duplicate commitment');
    }

    const leafIndex = state.leaves.length;
    state.leaves.push(leaf);
    state.nodes[0] ??= [];
    state.nodes[0][leafIndex] = leaf;

    let current = leaf;
    let index = leafIndex;
    for (let level = 0; level < MERKLE_TREE_DEPTH; level += 1) {
      const sibling = state.nodes[level]?.[index ^ 1] ?? zeros[level]!;
      state.nodes[level + 1] ??= [];
      const parentIndex = Math.floor(index / 2);
      const parent =
        index % 2 === 0 ? hashPair(current, sibling) : hashPair(sibling, current);
      state.nodes[level + 1]![parentIndex] = parent;
      current = parent;
      index = parentIndex;
    }

    const path: string[] = [];
    index = leafIndex;
    for (let level = 0; level < MERKLE_TREE_DEPTH; level += 1) {
      const sibling = state.nodes[level]?.[index ^ 1] ?? zeros[level]!;
      path.push(sibling.toString('hex'));
      index = Math.floor(index / 2);
    }

    const root = (state.nodes[MERKLE_TREE_DEPTH]?.[0] ?? zeros[MERKLE_TREE_DEPTH]!).toString(
      'hex',
    );
    return { leafIndex, path, root };
  }
}
