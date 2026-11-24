import { createHash } from 'node:crypto';
import type {
  FileComplaintInput,
  FileComplaintResult,
  GetComplaintInput,
  GetComplaintResult,
  GetLeavesInput,
  GetLeavesResult,
  GetRootsInput,
  GetRootsResult,
  GetStatsInput,
  GetStatsResult,
  ListComplaintsFilter,
  ListComplaintsResult,
  MembershipProof,
  ReopenComplaintInput,
  ReopenComplaintResult,
  SupportComplaintInput,
  SupportComplaintResult,
  UpdateStatusInput,
  UpdateStatusResult,
} from '@usafe/shared';
import { MERKLE_TREE_DEPTH } from '@usafe/shared';

export interface EnrollmentReceipt {
  leafIndex: number;
  path: string[];
  root: string;
}

export interface EnrollCommitmentInput {
  universityId: string;
  commitment: string;
}

export interface EnrollmentLedger {
  enrollCommitment(
    input: EnrollCommitmentInput,
  ): EnrollmentReceipt | Promise<EnrollmentReceipt>;
  verifyEnrollmentProof?(proof: unknown): boolean | Promise<boolean>;
}

export interface ComplaintLedger {
  verifyMembershipMock(proof: MembershipProof): Promise<boolean>;
  fileComplaint(input: FileComplaintInput): Promise<FileComplaintResult>;
  supportComplaint(
    input: SupportComplaintInput,
  ): Promise<SupportComplaintResult>;
  updateStatus(input: UpdateStatusInput): Promise<UpdateStatusResult>;
  reopenComplaint(input: ReopenComplaintInput): Promise<ReopenComplaintResult>;
  listComplaints(filter: ListComplaintsFilter): Promise<ListComplaintsResult>;
  getComplaint(input: GetComplaintInput): Promise<GetComplaintResult>;
  getStats(input: GetStatsInput): Promise<GetStatsResult>;
  getLeaves(input: GetLeavesInput): Promise<GetLeavesResult>;
  getRoots(input: GetRootsInput): Promise<GetRootsResult>;
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

  enrollCommitment(input: EnrollCommitmentInput): EnrollmentReceipt {
    const leaf: Bytes = Buffer.from(input.commitment, 'hex');
    if (leaf.length !== 32) {
      throw new Error('invalid commitment');
    }

    let state = this.trees.get(input.universityId);
    if (state === undefined) {
      state = { leaves: [], nodes: [] };
      this.trees.set(input.universityId, state);
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
        index % 2 === 0
          ? hashPair(current, sibling)
          : hashPair(sibling, current);
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

    const root = (
      state.nodes[MERKLE_TREE_DEPTH]?.[0] ?? zeros[MERKLE_TREE_DEPTH]!
    ).toString('hex');
    return { leafIndex, path, root };
  }

  verifyEnrollmentProof(): boolean {
    return true;
  }
}
