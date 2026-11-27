import type Database from 'better-sqlite3';
import {
  bucketCount,
  computeZeroNodes,
  MERKLE_TREE_DEPTH,
  MerkleTree,
  Sha256Adapter,
  type MockProofData,
  verifyMembershipMock,
} from '@usafe/crypto';
import {
  CATEGORIES,
  DEMO_SLA_SECONDS,
  MIN_GROUP_SIZE,
  NORMAL_DEADLINE_SECONDS,
  STATUSES,
  URGENT_DEADLINE_SECONDS,
  URGENCIES,
} from '@usafe/shared';
import type {
  Category,
  ComplaintListItem,
  ComplaintRecord,
  ComplaintViewerRole,
  EnrollCommitmentInput,
  EnrollCommitmentResult,
  FileComplaintInput,
  FileComplaintResult,
  GetComplaintInput,
  GetComplaintResult,
  GetHistoryInput,
  GetHistoryResult,
  GetLeavesInput,
  GetLeavesResult,
  GetRootsInput,
  GetRootsResult,
  GetStatsInput,
  GetStatsResult,
  HistoryActorRole,
  ListComplaintsFilter,
  ListComplaintsResult,
  MarkEscalatedInput,
  MarkEscalatedResult,
  MembershipProof,
  OwnerRole,
  RedactedComplaintRecord,
  Status,
  StatsBreakdown,
  SupportComplaintInput,
  SupportComplaintResult,
  Urgency,
  UpdateStatusInput,
  UpdateStatusResult,
} from '@usafe/shared';
import { LedgerAdapter, LedgerAuthorizationError } from './ledger.js';

const GRACE_WINDOW_DAYS = 14;

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

type TreeEntry = {
  tree: MerkleTree;
  leafCount: number;
};

type ComplaintRow = {
  id: string;
  university_id: string;
  category: string;
  urgency: string;
  staff_involved: number;
  owner_role: string;
  payload_hash: string;
  created_at: string;
  deadline_at: string;
  status: string;
  escalated: number;
  reopened: number;
  support_count: number;
  outcome_hash: string | null;
  last_updated_at: string;
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
  private readonly publish: (event: { type: string; id: string }) => void;

  constructor(
    db: Database.Database,
    options?: { publish?: (event: { type: string; id: string }) => void },
  ) {
    this.db = db;
    this.publish = options?.publish ?? (() => {});
    this.zeroNodesPromise = computeZeroNodes(MERKLE_TREE_DEPTH, this.hashAdapter);
  }

  private publishEvent(event: { type: string; id: string }): void {
    try {
      this.publish(event);
    } catch {
      // Event publishing failures must not fail the action.
    }
  }

  // ------------------------------------------------------------------
  // Enroll commitment (M037)
  // ------------------------------------------------------------------

  /**
   * Computes everything an enrollment needs (leaf index, path, root) without
   * writing anything. `commit()` then performs the leaf/root inserts inside
   * the caller's SQLite transaction (M029), so ticket burn, ceiling check,
   * roster update and ledger writes all commit or roll back together.
   */
  async prepareEnrollment(input: EnrollCommitmentInput): Promise<{
    receipt: EnrollCommitmentResult;
    commit: () => void;
  }> {
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

    return {
      receipt: {
        leafIndex,
        path: proof.map((sibling) => Buffer.from(sibling).toString('hex')),
        root: toHex(root),
      },
      commit: () => {
        // Re-check under the caller's transaction: another request may have
        // enrolled between prepareEnrollment and commit.
        const current = this.getLeavesInternal(input.universityId);
        if (current.includes(input.commitment)) {
          throw new Error('duplicate commitment');
        }
        if (current.length !== leafIndex) {
          throw new Error('enrollment state changed, please retry');
        }
        insertLeaf.run(input.universityId, leafIndex, input.commitment);
        insertRoot.run(input.universityId, toHex(root), now);
        this.trees.delete(input.universityId);
      },
    };
  }

  async enrollCommitment(
    input: EnrollCommitmentInput,
  ): Promise<EnrollCommitmentResult> {
    const prepared = await this.prepareEnrollment(input);
    const transaction = this.db.transaction(() => prepared.commit());
    transaction();
    return prepared.receipt;
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
    const recentRoots = rows.filter((row) => row.created_at >= cutoff);

    // The current root is always valid, even when the university has had no
    // new enrollment for longer than the grace window (M037). Without this,
    // every existing student would be locked out after 14 quiet days.
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const root of [currentRoot, ...recentRoots.map((row) => row.root)]) {
      if (!seen.has(root)) {
        seen.add(root);
        deduped.push(root);
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

    // Cryptographic validity only. Nullifier reuse is action-specific: the
    // request guard must let a duplicate through so fileComplaint /
    // supportComplaint can return the specific "already used" error (the UI
    // treats a duplicate support as a quiet success). Those methods check the
    // relevant kind against ml_nullifiers themselves.
    const usedNullifiers = new Set<string>();

    // Resolve the leaf index from the public leaf list. The client never sends
    // it (M053); this also binds the commitment to the claimed university.
    const leaves = this.getLeavesInternal(proof.universityId);
    let leafIndex = -1;
    try {
      const data = JSON.parse(proof.data) as MockProofData;
      leafIndex = leaves.indexOf(data.commitment);
    } catch {
      return false;
    }

    return verifyMembershipMock(proof, { roots, usedNullifiers, leafIndex });
  }

  // ------------------------------------------------------------------
  // File a complaint (M039)
  // ------------------------------------------------------------------

  async fileComplaint(
    input: FileComplaintInput,
  ): Promise<FileComplaintResult> {
    // 0. The proof must belong to the same university the complaint is filed
    //    against; the commitment is looked up in that university's leaves.
    if (input.proof.universityId !== input.universityId) {
      throw new Error('proof university does not match complaint university');
    }

    // 1. Reject a reused filing nullifier first, so the client can tell a
    //    used monthly slot (and try the other one) from a forged proof.
    const existing = this.db
      .prepare(
        `SELECT value FROM ml_nullifiers WHERE kind = 'filing' AND value = ?`,
      )
      .get(input.proof.nullifier) as { value: string } | undefined;
    if (existing !== undefined) {
      throw new Error('filing nullifier already used');
    }

    // 2. Verify the membership proof (root in grace window, valid Merkle path,
    //    nullifier bound to the commitment and context, not already used).
    const proofValid = await this.verifyMembershipMock(input.proof);
    if (!proofValid) {
      throw new Error('invalid membership proof');
    }

    // 3. Parse the proof data to extract the filing context.
    const data = JSON.parse(input.proof.data) as MockProofData;
    const contextParts = data.context.split('|');
    if (contextParts[0] !== 'file' || contextParts.length !== 3) {
      throw new Error('proof context must be a filing context: file|<yearMonth>|<slot>');
    }
    const slot = Number(contextParts[2]);
    if (slot !== 0 && slot !== 1) {
      throw new Error('filing slot must be 0 or 1');
    }

    // The month is part of the nullifier input, so the server must enforce it
    // rather than trusting the client. Without this check a caller could file
    // against arbitrary historical/future months and bypass the monthly limit.
    const yearMonth = contextParts[1];
    const currentYearMonth = new Date().toISOString().slice(0, 7);
    if (yearMonth === undefined || yearMonth !== currentYearMonth) {
      throw new Error('filing context month is not the current month');
    }

    // 4. With only two slots (0 and 1) per year-month, a third filing would
    //    have to reuse one of them, so nullifier uniqueness enforces the
    //    per-student monthly filing limit.

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

    let id = '';
    const transaction = this.db.transaction(() => {
      // Assign a sequential id from a dedicated sequence row inside the same
      // transaction as the insert (M039).
      const sequence = this.db
        .prepare('SELECT next_value FROM ml_complaint_sequence WHERE id = 1')
        .get() as { next_value: number } | undefined;
      if (sequence === undefined) {
        throw new Error('complaint id sequence is missing');
      }
      const nextValue = Number(sequence.next_value);
      id = `c-${String(nextValue).padStart(6, '0')}`;
      this.db
        .prepare('UPDATE ml_complaint_sequence SET next_value = ? WHERE id = 1')
        .run(nextValue + 1);

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

    // Live feeds listen for complaint.created (M054).
    this.publishEvent({ type: 'complaint.created', id });

    return { id };
  }

  // ------------------------------------------------------------------
  // Support a complaint (M040)
  // ------------------------------------------------------------------

  async supportComplaint(
    input: SupportComplaintInput,
  ): Promise<SupportComplaintResult> {
    // 1. Reject a reused support nullifier first, with the specific message
    //    the UI treats as a quiet duplicate.
    const existing = this.db
      .prepare(
        `SELECT value FROM ml_nullifiers WHERE kind = 'support' AND value = ?`,
      )
      .get(input.proof.nullifier) as { value: string } | undefined;
    if (existing !== undefined) {
      throw new Error('support nullifier already used');
    }

    // 2. Verify the membership proof (root in grace window, valid Merkle path,
    //    nullifier bound to commitment + context, not already used).
    const proofValid = await this.verifyMembershipMock(input.proof);
    if (!proofValid) {
      throw new Error('invalid membership proof');
    }

    // 3. Parse the proof data to extract the support context.
    const data = JSON.parse(input.proof.data) as MockProofData;
    const contextParts = data.context.split('|');
    if (contextParts[0] !== 'support' || contextParts.length !== 2) {
      throw new Error(
        'proof context must be a support context: support|<complaintId>',
      );
    }
    const complaintId = contextParts[1];
    if (complaintId === undefined || complaintId !== input.complaintId) {
      throw new Error(
        'proof context must be a support context: support|<complaintId>',
      );
    }

    // 3. Look up the complaint.
    const complaint = this.db
      .prepare('SELECT * FROM ml_complaints WHERE id = ?')
      .get(complaintId) as Record<string, unknown> | undefined;
    if (complaint === undefined) {
      throw new Error('complaint not found');
    }

    // 4. Verify that the proof's university matches the complaint's university.
    if (input.proof.universityId !== complaint.university_id) {
      throw new Error('proof university does not match complaint university');
    }

    // 6. Increment supportCount atomically and record the nullifier.
    const now = new Date().toISOString();
    const insertNullifier = this.db.prepare(
      `INSERT INTO ml_nullifiers (kind, value) VALUES ('support', ?)`,
    );

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE ml_complaints
           SET support_count = support_count + 1, last_updated_at = ?
           WHERE id = ?`,
        )
        .run(now, complaintId);
      insertNullifier.run(input.proof.nullifier);
    });
    transaction();

    // 7. Read back the new support count and publish an event.
    const updated = this.db
      .prepare('SELECT support_count FROM ml_complaints WHERE id = ?')
      .get(complaintId) as { support_count: number };
    this.publishEvent({ type: 'complaint.supported', id: complaintId });

    return { supportCount: updated.support_count };
  }

  // ------------------------------------------------------------------
  // Update status (M041)
  // ------------------------------------------------------------------

  async updateStatus(
    input: UpdateStatusInput,
  ): Promise<UpdateStatusResult> {
    await Promise.resolve();
    // 1. Look up the complaint.
    const complaint = this.db
      .prepare('SELECT * FROM ml_complaints WHERE id = ?')
      .get(input.complaintId) as Record<string, unknown> | undefined;
    if (complaint === undefined) {
      throw new Error('complaint not found');
    }

    // 2. Only the owner role may change the status. The caller's role must
    //    match the complaint's stored owner_role, so a university cannot
    //    touch a UGC-owned complaint and vice versa.
    if (input.ownerRole !== complaint.owner_role) {
      throw new LedgerAuthorizationError(
        'insufficient role to update this complaint',
      );
    }

    // 3. Transitions only go forward.
    const order: Record<string, number> = {
      not_started: 0,
      pending_investigation: 1,
      finished: 2,
    };
    const current = String(complaint.status);
    const next = input.newStatus;
    if (!(current in order) || !(next in order)) {
      throw new Error('invalid status');
    }
    if (order[next]! !== order[current]! + 1) {
      throw new Error('status can only move forward');
    }

    // 4. Finished requires a non-empty outcomeHash.
    if (next === 'finished' && (!input.outcomeHash || input.outcomeHash === '')) {
      throw new Error('finished requires a non-empty outcomeHash');
    }

    // 5. Store the status change and append a history row. When finishing,
    //    the outcome hash is recorded (the outcome text itself is stored
    //    off-chain as a sealed blob by the portal).
    const now = new Date().toISOString();
    const outcomeHash = next === 'finished' ? input.outcomeHash : null;
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE ml_complaints
           SET status = ?, outcome_hash = ?, last_updated_at = ?
           WHERE id = ?`,
        )
        .run(next, outcomeHash, now, input.complaintId);
      this.db
        .prepare(
          `INSERT INTO ml_history (complaint_id, status, at, actor_role, note_hash)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .run(input.complaintId, next, now, input.ownerRole);
    });
    transaction();

    // 6. Publish an event.
    this.publishEvent({ type: 'complaint.status', id: input.complaintId });

    return { complaintId: input.complaintId, status: next };
  }

  // ------------------------------------------------------------------
  // Not yet implemented (M043-M047)
  // ------------------------------------------------------------------
  async markEscalated(
    input: MarkEscalatedInput,
  ): Promise<MarkEscalatedResult> {
    await Promise.resolve();
    // 1. Look up the complaint.
    const complaint = this.db
      .prepare('SELECT * FROM ml_complaints WHERE id = ?')
      .get(input.complaintId) as Record<string, unknown> | undefined;
    if (complaint === undefined) {
      throw new Error('complaint not found');
    }

    const status = String(complaint.status);
    const alreadyEscalated = Number(complaint.escalated) === 1;
    const deadlineAt = String(complaint.deadline_at);
    const now = new Date().toISOString();

    // 2. Already escalated: idempotent, no-op.
    if (alreadyEscalated) {
      return { complaintId: input.complaintId, escalated: true };
    }

    // 3. Only escalate complaints that are still not_started and past their deadline.
    if (status !== 'not_started' || deadlineAt > now) {
      return { complaintId: input.complaintId, escalated: false };
    }

    // 4. Set escalated=true, append a history row (actor 'system'), publish event.
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE ml_complaints SET escalated = 1, last_updated_at = ? WHERE id = ?`,
        )
        .run(now, input.complaintId);
      this.db
        .prepare(
          `INSERT INTO ml_history (complaint_id, status, at, actor_role, note_hash)
           VALUES (?, ?, ?, 'system', NULL)`,
        )
        .run(input.complaintId, status, now);
    });
    transaction();

    this.publishEvent({ type: 'complaint.escalated', id: input.complaintId });

    return { complaintId: input.complaintId, escalated: true };
  }
  reopenComplaint(): Promise<import('@usafe/shared').ReopenComplaintResult> {
    throw new Error('reopenComplaint is not yet implemented (M079)');
  }
  listComplaints(
    filter: ListComplaintsFilter,
  ): Promise<ListComplaintsResult> {
    const universityId = this.resolveViewerUniversity(
      filter.viewerRole,
      filter.universityId,
    );
    const clauses: string[] = [];
    const parameters: Array<string | number> = [];

    if (universityId !== null) {
      clauses.push('university_id = ?');
      parameters.push(universityId);
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?');
      parameters.push(filter.status);
    }
    if (filter.category !== undefined) {
      clauses.push('category = ?');
      parameters.push(filter.category);
    }
    if (filter.ownerRole !== undefined) {
      clauses.push('owner_role = ?');
      parameters.push(filter.ownerRole);
    }
    if (filter.escalated !== undefined) {
      clauses.push('escalated = ?');
      parameters.push(filter.escalated ? 1 : 0);
    }

    const rows = this.db
      .prepare(
        `SELECT id, university_id, category, urgency, staff_involved, owner_role,
                payload_hash, created_at, deadline_at, status, escalated, reopened,
                support_count, outcome_hash, last_updated_at
         FROM ml_complaints
         ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
         ORDER BY created_at DESC, id DESC`,
      )
      .all(...parameters) as ComplaintRow[];

    const complaints: ComplaintListItem[] = rows.map((row) =>
      this.complaintForViewer(filter.viewerRole, row),
    );

    return Promise.resolve({ complaints });
  }
  getComplaint(input: GetComplaintInput): Promise<GetComplaintResult> {
    const universityId = this.resolveViewerUniversity(
      input.viewerRole,
      input.universityId,
    );
    const row = this.getComplaintRow(input.complaintId);
    if (row === undefined) {
      return Promise.reject(new Error('complaint not found'));
    }
    if (universityId !== null && row.university_id !== universityId) {
      return Promise.reject(
        new LedgerAuthorizationError('viewer cannot access this complaint'),
      );
    }

    return Promise.resolve({
      complaint: this.complaintForViewer(input.viewerRole, row),
    });
  }
  getHistory(input: GetHistoryInput): Promise<GetHistoryResult> {
    const universityId = this.resolveViewerUniversity(
      input.viewerRole,
      input.universityId,
    );
    const complaint = this.getComplaintRow(input.complaintId);
    if (complaint === undefined) {
      return Promise.reject(new Error('complaint not found'));
    }
    if (universityId !== null && complaint.university_id !== universityId) {
      return Promise.reject(
        new LedgerAuthorizationError('viewer cannot access this complaint'),
      );
    }

    const rows = this.db
      .prepare(
        `SELECT complaint_id, status, at, actor_role, note_hash
         FROM ml_history WHERE complaint_id = ? ORDER BY at ASC`,
      )
      .all(input.complaintId) as Array<{
      complaint_id: string;
      status: string;
      at: string;
      actor_role: string;
      note_hash: string | null;
    }>;

    return Promise.resolve({
      entries: rows.map((row) => ({
        complaintId: row.complaint_id,
        status: row.status as Status,
        at: row.at,
        actorRole: row.actor_role as HistoryActorRole,
        noteHash: row.note_hash,
      })),
    });
  }
  getStats(input: GetStatsInput): Promise<GetStatsResult> {
    const universityId = this.resolveViewerUniversity(
      input.viewerRole,
      input.universityId,
    );
    const rows = this.db
      .prepare(
        `SELECT university_id, category, urgency, status, deadline_at, staff_involved
         FROM ml_complaints
         ${universityId === null ? '' : 'WHERE university_id = ?'}`,
      )
      .all(...(universityId === null ? [] : [universityId])) as Array<{
      university_id: string;
      category: string;
      urgency: string;
      status: string;
      deadline_at: string;
      staff_involved: number;
    }>;

    const byCategory = Object.fromEntries(
      CATEGORIES.map((category) => [category, 0]),
    ) as Record<Category, number>;
    const byUrgency = Object.fromEntries(
      URGENCIES.map((urgency) => [urgency, 0]),
    ) as Record<Urgency, number>;
    const byStatus = Object.fromEntries(
      STATUSES.map((status) => [status, 0]),
    ) as Record<Status, number>;
    const byUniversity: Record<string, number> = {};
    const now = new Date().toISOString();
    let overdue = 0;
    let staffInvolved = 0;

    for (const row of rows) {
      byCategory[row.category as Category] += 1;
      byUrgency[row.urgency as Urgency] += 1;
      byStatus[row.status as Status] += 1;
      byUniversity[row.university_id] =
        (byUniversity[row.university_id] ?? 0) + 1;
      if (row.deadline_at <= now && row.status !== 'finished') {
        overdue += 1;
      }
      if (row.staff_involved === 1) {
        staffInvolved += 1;
      }
    }

    const isUgc = input.viewerRole === 'ugc';
    return Promise.resolve({
      totalComplaints: isUgc
        ? rows.length
        : bucketCount(rows.length, MIN_GROUP_SIZE),
      byCategory: this.protectBreakdown(byCategory),
      byUrgency: this.protectBreakdown(byUrgency),
      byStatus: this.protectBreakdown(byStatus),
      overdue: isUgc ? overdue : bucketCount(overdue, MIN_GROUP_SIZE),
      staffInvolved: isUgc
        ? staffInvolved
        : bucketCount(staffInvolved, MIN_GROUP_SIZE),
      ...(isUgc ? { byUniversity } : {}),
    });
  }

  // ------------------------------------------------------------------
  // Not yet implemented (M041-M047)
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private protectBreakdown<K extends string>(
    counts: Record<K, number>,
  ): StatsBreakdown<K> {
    const protectedCounts: Record<string, number | null> = {};
    let other = 0;

    for (const [key, value] of Object.entries(counts) as Array<[K, number]>) {
      if (key === 'other') {
        other += value;
        continue;
      }
      const protectedCount = bucketCount(value, MIN_GROUP_SIZE);
      protectedCounts[key] = protectedCount;
      if (protectedCount === null) {
        other += value;
      }
    }

    protectedCounts.other = bucketCount(other, MIN_GROUP_SIZE);
    return protectedCounts as StatsBreakdown<K>;
  }

  private resolveViewerUniversity(
    viewerRole: ComplaintViewerRole,
    universityId: string | undefined,
  ): string | null {
    if (viewerRole === 'ugc') {
      return universityId ?? null;
    }
    if (universityId === undefined || universityId.length === 0) {
      throw new Error('universityId is required for this viewer role');
    }
    return universityId;
  }

  private getComplaintRow(complaintId: string): ComplaintRow | undefined {
    return this.db
      .prepare(
        `SELECT id, university_id, category, urgency, staff_involved, owner_role,
                payload_hash, created_at, deadline_at, status, escalated, reopened,
                support_count, outcome_hash, last_updated_at
         FROM ml_complaints WHERE id = ?`,
      )
      .get(complaintId) as ComplaintRow | undefined;
  }

  private rowToComplaint(row: ComplaintRow): ComplaintRecord {
    return {
      id: row.id,
      universityId: row.university_id,
      category: row.category as Category,
      urgency: row.urgency as Urgency,
      staffInvolved: row.staff_involved === 1,
      ownerRole: row.owner_role as OwnerRole,
      payloadHash: row.payload_hash,
      createdAt: row.created_at,
      deadlineAt: row.deadline_at,
      status: row.status as Status,
      escalated: row.escalated === 1,
      reopened: row.reopened === 1,
      supportCount: row.support_count,
      outcomeHash: row.outcome_hash,
      lastUpdatedAt: row.last_updated_at,
    };
  }

  private rowToRedactedComplaint(row: ComplaintRow): RedactedComplaintRecord {
    return {
      id: row.id,
      createdAt: row.created_at,
      category: row.category as Category,
      supportCount: row.support_count,
      status: row.status as Status,
    };
  }

  private complaintForViewer(
    viewerRole: ComplaintViewerRole,
    row: ComplaintRow,
  ): ComplaintListItem {
    if (viewerRole === 'university' && row.staff_involved === 1) {
      return this.rowToRedactedComplaint(row);
    }
    return this.rowToComplaint(row);
  }

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
