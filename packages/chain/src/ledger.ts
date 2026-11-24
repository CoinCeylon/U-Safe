import type {
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
  ListComplaintsFilter,
  ListComplaintsResult,
  MarkEscalatedInput,
  MarkEscalatedResult,
  MembershipProof,
  ReopenComplaintInput,
  ReopenComplaintResult,
  SupportComplaintInput,
  SupportComplaintResult,
  UpdateStatusInput,
  UpdateStatusResult,
} from '@usafe/shared';

/**
 * Which chain backend the adapter is talking to.
 *
 * - `'mock'`: an in-memory/SQLite mock used for Groups 1-7. The mock proof contains
 *   the student's commitment and Merkle path so the server can check membership; the
 *   server verifies it and immediately discards it, never persisting or logging it.
 * - `'testnet'`: the real Midnight contract accessed through the indexer and proof server.
 */
export type LedgerMode = 'mock' | 'testnet';

export class LedgerAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerAuthorizationError';
  }
}

/**
 * Abstraction over the chain so Groups 1-7 work in mock mode and Group 9 can swap in
 * the real Midnight contract without touching the portals.
 *
 * Every method documents who may call it and what it reveals, per M035.
 */
export interface LedgerAdapter {
  /**
   * Registers a student's commitment in the university's enrolled-student Merkle tree.
   *
   * Who may call: the enrollment endpoint (and, on testnet, the registrar authority).
   * Reveals: `universityId` and the commitment. The commitment is never linked to any
   * email or identity in any stored record.
   */
  enrollCommitment(
    input: EnrollCommitmentInput,
  ): Promise<EnrollCommitmentResult>;

  /**
   * Returns the public list of commitments for a university, used by students to
   * compute their own Merkle path locally.
   *
   * Who may call: anyone (public). Used by the student portal during credential refresh.
   * Reveals: only commitments (hashes); no identities, emails or wallet addresses.
   */
  getLeaves(input: GetLeavesInput): Promise<GetLeavesResult>;

  /**
   * Returns the current Merkle root plus every root within the grace window (last 14 days),
   * used by students to verify their path is still valid.
   *
   * Who may call: anyone (public).
   * Reveals: only roots (hashes); no identities.
   */
  getRoots(input: GetRootsInput): Promise<GetRootsResult>;

  /**
   * Files a new complaint on behalf of an enrolled student.
   *
   * Who may call: a student holding a valid membership proof (verified via `requireEnrollmentProof`).
   * Reveals: nothing about the student's identity. The proof's nullifier is checked for
   * reuse; the complaint is stored with status `not_started` and a deadline.
   * The input carries only universityId, category, urgency, staffInvolved, payloadHash,
   * payloadLocator and the proof. Complaint text and evidence are stored off-chain.
   */
  fileComplaint(input: FileComplaintInput): Promise<FileComplaintResult>;

  /**
   * Supports a complaint on behalf of an enrolled student of the same university.
   *
   * Who may call: a student holding a valid membership proof whose university matches
   * the complaint's university.
   * Reveals: nothing about the student's identity. A reused support nullifier is rejected
   * so a student can support a given complaint only once.
   */
  supportComplaint(input: SupportComplaintInput): Promise<SupportComplaintResult>;

  /**
   * Moves a complaint forward through its lifecycle.
   *
   * Who may call: staff of the owner role — university staff for university-owned
   * complaints, UGC staff when `ownerRole === 'ugc'`. University staff cannot touch
   * UGC-owned complaints.
   * Reveals: nothing about any student. Transitions only go forward
   * (`not_started` -> `pending_investigation` -> `finished`); `finished` requires a
   * non-empty `outcomeHash`. Every change appends a history row.
   */
  updateStatus(input: UpdateStatusInput): Promise<UpdateStatusResult>;

  /**
   * Marks a complaint as escalated when its deadline has passed.
   *
   * Who may call: anyone (no student proof required) — typically the escalation job.
   * Reveals: nothing about any student. Sets `escalated = true` only when the status is
   * `not_started` and the deadline has passed; idempotent.
   */
  markEscalated(input: MarkEscalatedInput): Promise<MarkEscalatedResult>;

  /**
   * Reopens a complaint.
   *
   * Who may call: UGC staff only.
   * Reveals: nothing about any student. Sets `reopened = true` and status back to
   * `pending_investigation`, appending a history row with actor `ugc`.
   */
  reopenComplaint(input: ReopenComplaintInput): Promise<ReopenComplaintResult>;

  /**
   * Lists complaints with role-aware filtering.
   *
   * Who may call: students (by university id only, no login), university staff (their
   * own university), UGC staff (all universities).
   * Reveals: complaint records shaped for the caller's role. Student responses never
   * include evidence locators; staff-involved records are redacted for the university role.
   */
  listComplaints(filter: ListComplaintsFilter): Promise<ListComplaintsResult>;

  /**
   * Returns a single complaint by id, role-filtered.
   *
   * Who may call: the same role rules as `listComplaints`.
   * Reveals: the complaint record (without evidence locators for students; redacted for
   * staff-involved records under the university role).
   */
  getComplaint(input: GetComplaintInput): Promise<GetComplaintResult>;

  /**
   * Returns the status-change history for a complaint.
   *
   * Who may call: the same role rules as `listComplaints`.
   * Reveals: history rows (complaint id, status, time, actor role, note hash) — no
   * student identity or complaint text.
   */
  getHistory(input: GetHistoryInput): Promise<GetHistoryResult>;

  /**
   * Returns aggregate statistics for dashboards.
   *
   * Who may call: students, university staff (their own university) and UGC staff (all).
   * Reveals: counts only — total, breakdowns by category/urgency/status, overdue and
   * staff-involved counts. Small-group protection is applied to breakdowns.
   */
  getStats(input: GetStatsInput): Promise<GetStatsResult>;
}

export type { MembershipProof };
