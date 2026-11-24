import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import {
  computeZeroNodes,
  MERKLE_TREE_DEPTH,
  MerkleTree,
  Sha256Adapter,
  type MockProofData,
  verifyMembershipMock,
} from '@usafe/crypto';
import {
  DEMO_SLA_SECONDS,
  NORMAL_DEADLINE_SECONDS,
  URGENT_DEADLINE_SECONDS,
} from '@usafe/shared';
import type {
  EnrollCommitmentInput,
  EnrollCommitmentResult,
  FileComplaintInput,
  FileComplaintResult,
  GetLeavesInput,
  GetLeavesResult,
  GetRootsInput,
  GetRootsResult,
  MembershipProof,
} from '@usafe/shared';
import { LedgerAdapter } from './ledger.js';

const GRACE_WINDOW_DAYS = 14;

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

type TreeEntry = {
  tree: MerkleTree;
  leafCount: number;
};

/**
 * In-memory/SQLite mock implementation of `LedgerAdapter` for Groups 1-7.
 *
 * The mock is intentionally not anonymous: the proof carries the commitment and
 * Merkle path so the server can check membership, then discards it. Persistence
 * uses the `ml_*` tables created in M036.
 *
 * Methods not yet implemented in this milestone throw so that later milestones
 * (M038-M047) can fill them in one at a time.
 */
export class MockLedger implements LedgerAdapter {
  private readonly db: Database.Database;
  private readonly hashAdapter = new Sha256Adapter();
  private readonly zeroNodesPromise: Promise<Uint8Array[]>;
  private readonly trees = new Map<string, TreeEntry>();

  constructor(db: Database.Database) {
    this.db = db;
    this.zeroNodesPromise = computeZeroNodes(MERKLE_TREE_DEPTH, this.hashAdapter);
  }

  // ------------------------------------------------------------------
  // Enroll commitment (M037)
  // ------------------------------------------------------------------

  async enrollCommitment(
    input: EnrollCommitmentInput,
  ): Promise<EnrollCommitmentResult> {
    const university = this.getUniversity(input.universityId);
    if (university === null) {
      throw new Error(`unknown university: ${input.universityId}`);
    }

    const commitmentBytes = Buffer.from(input.commitment, 'hex');
    if (commitmentBytes.length !== 32) {
      throw new Error('commitment must be a 32-byte hex value');
    }

    const existing = this.getLeavesInternal(input.universityId);
    if (existing.includes(input.commitment)) {
      throw new Error('duplicate commitment');
    }

    if (existing.length >= university.enrollmentCeiling) {
      throw new Error('enrollment ceiling reached');
    }

    const zeroNodes = await this.zeroNodesPromise;
    const tree = new MerkleTree(MERKLE_TREE_DEPTH, this.hashAdapter, zeroNodes);
    for (const hex of existing) {
      await tree.insert(Buffer.from(hex, 'hex'));
    }

    const leafIndex = await tree.insert(commitmentBytes);
    const proof = tree.proof(leafIndex);
    const root = tree.getRoot();

    const now = new Date().toISOString();
    const insertLeaf = this.db.prepare(
      `INSERT INTO ml_leaves (university_id, leaf_index, commitment) VALUES (?, ?, ?)`,
    );
    const insertRoot = this.db.prepare(
      `INSERT INTO ml_roots (university_id, root, created_at) VALUES (?, ?, ?)`,
    );

    const transaction = this.db.transaction(() => {
      insertLeaf.run(input.universityId, leafIndex, input.commitment);
      insertRoot.run(input.universityId, toHex(root), now);
    });
    transaction();

    this.trees.delete(input.universityId);

    return {
      leafIndex,
      path: proof.map((sibling) => Buffer.from(sibling).toString('hex')),
      root: toHex(root),
    };
  }

  // ------------------------------------------------------------------
  // Get leaves (M037)
  // ------------------------------------------------------------------

  getLeaves(input: GetLeavesInput): Promise<GetLeavesResult> {
    const rows = this.db
      .prepare(
        `SELECT commitment FROM ml_leaves
         WHERE university_id = ?
         ORDER BY leaf_index ASC`,
      )
      .all(input.universityId) as Array<{ commitment: string }>;
    return Promise.resolve({ commitments: rows.map((row) => row.commitment) });
  }

  // ------------------------------------------------------------------
  // Get roots (M037)
  // ------------------------------------------------------------------

  async getRoots(input: GetRootsInput): Promise<GetRootsResult> {
    const rows = this.db
      .prepare(
        `SELECT root, created_at FROM ml_roots
         WHERE university_id = ?
         ORDER BY created_at DESC`,
      )
      .all(input.universityId) as Array<{ root: string; created_at: string }>;

    const zeroNodes = await this.zeroNodesPromise;
    const zeroRoot = toHex(zeroNodes[MERKLE_TREE_DEPTH]!);

    const currentRoot =
      rows.length > 0 ? rows[0]!.root : zeroRoot;

    const cutoff = new Date(
      Date.now() - GRACE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const roots = rows.filter((row) => row.created_at >= cutoff);

    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const row of roots) {
      if (!seen.has(row.root)) {
        seen.add(row.root);
        deduped.push(row.root);
      }
    }

    return { currentRoot, roots: deduped };
  }

  // ------------------------------------------------------------------
  // Verify membership proof (M038)
  // ------------------------------------------------------------------

  /**
   * Server-side verification of a mock membership proof. Checks that the root
   * is within the grace window, the Merkle path is valid, and the nullifier
   * has not been used before. Does not persist anything from the proof.
   */
  async verifyMembershipMock(
    proof: MembershipProof,
  ): Promise<boolean> {
    const { roots } = await this.getRoots({ universityId: proof.universityId });

    const usedRows = this.db
      .prepare(`SELECT value FROM ml_nullifiers WHERE kind = 'membership'`)
      .all() as Array<{ value: string }>;
    const usedNullifiers = new Set(usedRows.map((row) => row.value));

    return verifyMembershipMock(proof, { roots, usedNullifiers });
  }

  // ------------------------------------------------------------------
  // File a complaint (M039)
  // ------------------------------------------------------------------

  async fileComplaint(
    input: FileComplaintInput,
  ): Promise<FileComplaintResult> {
    // 1. Verify the membership proof (root in grace window, valid Merkle path,
    //    nullifier not already used).
    const proofValid = await this.verifyMembershipMock(input.proof);
    if (!proofValid) {
      throw new Error('invalid membership proof');
    }

    // 2. Parse the proof data to extract the filing context.
    const data = JSON.parse(input.proof.data) as MockProofData;
    const contextParts = data.context.split('|');
    if (contextParts[0] !== 'file' || contextParts.length !== 3) {
      throw new Error('proof context must be a filing context: file|<yearMonth>|<slot>');
    }
    const slot = Number(contextParts[2]);
    if (slot !== 0 && slot !== 1) {
      throw new Error('filing slot must be 0 or 1');
    }

    // 3. Reject a reused filing nullifier. With only two slots (0 and 1) per
    //    year-month, a third filing would have to reuse one of them, so
    //    nullifier uniqueness enforces the per-student monthly filing limit.
    const existing = this.db
      .prepare(
        `SELECT value FROM ml_nullifiers WHERE kind = 'filing' AND value = ?`,
      )
      .get(input.proof.nullifier) as { value: string } | undefined;
    if (existing !== undefined) {
      throw new Error('filing nullifier already used');
    }

    // 4. Assign a sequential id.
    const id = `c-${Date.now()}-${randomBytes(8).toString('hex')}`;

    // 5. Set deadlineAt from urgency (DEMO_SLA_SECONDS override for demos).
    const now = Date.now();
    let deadlineSeconds: number;
    if (DEMO_SLA_SECONDS !== undefined && DEMO_SLA_SECONDS !== null) {
      deadlineSeconds = DEMO_SLA_SECONDS;
    } else if (input.urgency === 'urgent') {
      deadlineSeconds = URGENT_DEADLINE_SECONDS;
    } else {
      deadlineSeconds = NORMAL_DEADLINE_SECONDS;
    }
    const createdAt = new Date(now).toISOString();
    const deadlineAt = new Date(now + deadlineSeconds * 1000).toISOString();

    // 6. Determine owner role: staff-involved complaints are owned by the UGC.
    const ownerRole = input.staffInvolved ? 'ugc' : 'university';

    // 7. Store the complaint record, the first history row, and the nullifier
    //    in a single transaction.
    const insertComplaint = this.db.prepare(`
      INSERT INTO ml_complaints (
        id, university_id, category, urgency, staff_involved, owner_role,
        payload_hash, payload_locator, created_at, deadline_at, status,
        escalated, reopened, support_count, outcome_hash, last_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', 0, 0, 0, NULL, ?)
    `);
    const insertHistory = this.db.prepare(`
      INSERT INTO ml_history (complaint_id, status, at, actor_role, note_hash)
      VALUES (?, 'not_started', ?, 'student', NULL)
    `);
    const insertNullifier = this.db.prepare(`
      INSERT INTO ml_nullifiers (kind, value) VALUES ('filing', ?)
    `);

    const transaction = this.db.transaction(() => {
      insertComplaint.run(
        id,
        input.universityId,
        input.category,
        input.urgency,
        input.staffInvolved ? 1 : 0,
        ownerRole,
        input.payloadHash,
        input.payloadLocator ?? null,
        createdAt,
        deadlineAt,
        createdAt,
      );
      insertHistory.run(id, createdAt);
      insertNullifier.run(input.proof.nullifier);
    });
    transaction();

    return { id };
  }

  // ------------------------------------------------------------------
  // Not yet implemented (M040-M047)
  // ------------------------------------------------------------------

  supportComplaint(): Promise<import('@usafe/shared').SupportComplaintResult> {
    throw new Error('supportComplaint is not yet implemented (M040)');
  }
  updateStatus(): Promise<import('@usafe/shared').UpdateStatusResult> {
    throw new Error('updateStatus is not yet implemented (M041)');
  }
  markEscalated(): Promise<import('@usafe/shared').MarkEscalatedResult> {
    throw new Error('markEscalated is not yet implemented (M042)');
  }
  reopenComplaint(): Promise<import('@usafe/shared').ReopenComplaintResult> {
    throw new Error('reopenComplaint is not yet implemented (M043)');
  }
  listComplaints(): Promise<import('@usafe/shared').ListComplaintsResult> {
    throw new Error('listComplaints is not yet implemented (M045)');
  }
  getComplaint(): Promise<import('@usafe/shared').GetComplaintResult> {
    throw new Error('getComplaint is not yet implemented (M045)');
  }
  getHistory(): Promise<import('@usafe/shared').GetHistoryResult> {
    throw new Error('getHistory is not yet implemented (M045)');
  }
  getStats(): Promise<import('@usafe/shared').GetStatsResult> {
    throw new Error('getStats is not yet implemented (M046)');
  }

  // ------------------------------------------------------------------
  // Not yet implemented (M040-M047)
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private getUniversity(universityId: string): {
    id: string;
    enrollmentCeiling: number;
  } | null {
    const row = this.db
      .prepare('SELECT id, enrollment_ceiling FROM universities WHERE id = ?')
      .get(universityId) as
      | { id: string; enrollment_ceiling: number }
      | undefined;
    if (row === undefined) {
      return null;
    }
    return { id: row.id, enrollmentCeiling: Number(row.enrollment_ceiling) };
  }

  private getLeavesInternal(universityId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT commitment FROM ml_leaves
         WHERE university_id = ?
         ORDER BY leaf_index ASC`,
      )
      .all(universityId) as Array<{ commitment: string }>;
    return rows.map((row) => row.commitment);
  }
}

export type { MembershipProof };
