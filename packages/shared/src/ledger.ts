import { z } from 'zod';
import type {
  Category,
  ComplaintListItem,
  ComplaintViewerRole,
  HistoryEntry,
  OwnerRole,
  Status,
  Urgency,
} from './types';

// ---------------------------------------------------------------------------
// Membership proof
// ---------------------------------------------------------------------------

/**
 * Proof that the caller is an enrolled student of a university.
 *
 * - `universityId`: the university whose enrolled-student tree the caller is a member of.
 * - `root`: the Merkle root the path was computed against (must be within the grace window).
 * - `nullifier`: a one-way derived value that makes the action unique per student per context.
 * - `kind`: `'mock'` in mock mode (the proof carries the commitment and Merkle path), `'zk'` on testnet.
 * - `data`: an opaque string payload. In mock mode this is the serialised Merkle path plus commitment.
 */
export type ProofKind = 'mock' | 'zk';

export interface MembershipProof {
  universityId: string;
  root: string;
  nullifier: string;
  kind: ProofKind;
  data: string;
}

export const membershipProofSchema = z
  .object({
    universityId: z.string().min(1),
    root: z.string().min(1),
    nullifier: z.string().min(1),
    kind: z.enum(['mock', 'zk']),
    data: z.string().min(1),
  })
  .strict() satisfies z.ZodType<MembershipProof>;

// ---------------------------------------------------------------------------
// Enroll commitment
// ---------------------------------------------------------------------------

export interface EnrollCommitmentInput {
  universityId: string;
  commitment: string;
}

export interface EnrollCommitmentResult {
  leafIndex: number;
  path: string[];
  root: string;
}

export const enrollCommitmentInputSchema = z
  .object({
    universityId: z.string().min(1),
    commitment: z.string().min(1),
  })
  .strict() satisfies z.ZodType<EnrollCommitmentInput>;

export const enrollCommitmentResultSchema = z
  .object({
    leafIndex: z.number().int().nonnegative(),
    path: z.array(z.string().min(1)),
    root: z.string().min(1),
  })
  .strict() satisfies z.ZodType<EnrollCommitmentResult>;

// ---------------------------------------------------------------------------
// Get leaves
// ---------------------------------------------------------------------------

export interface GetLeavesInput {
  universityId: string;
}

export interface GetLeavesResult {
  commitments: string[]; // hex-encoded commitments, public list used to compute local paths
}

export const getLeavesInputSchema = z
  .object({
    universityId: z.string().min(1),
  })
  .strict() satisfies z.ZodType<GetLeavesInput>;

export const getLeavesResultSchema = z
  .object({
    commitments: z.array(z.string().min(1)),
  })
  .strict() satisfies z.ZodType<GetLeavesResult>;

// ---------------------------------------------------------------------------
// Get roots
// ---------------------------------------------------------------------------

export interface GetRootsInput {
  universityId: string;
}

export interface GetRootsResult {
  currentRoot: string;
  roots: string[]; // current root plus every root within the grace window
}

export const getRootsInputSchema = z
  .object({
    universityId: z.string().min(1),
  })
  .strict() satisfies z.ZodType<GetRootsInput>;

export const getRootsResultSchema = z
  .object({
    currentRoot: z.string().min(1),
    roots: z.array(z.string().min(1)),
  })
  .strict() satisfies z.ZodType<GetRootsResult>;

// ---------------------------------------------------------------------------
// File a complaint
// ---------------------------------------------------------------------------

export interface FileComplaintInput {
  universityId: string;
  category: Category;
  urgency: Urgency;
  staffInvolved: boolean;
  payloadHash: string;
  payloadLocator: string | null;
  proof: MembershipProof;
}

export interface FileComplaintResult {
  id: string;
}

export const fileComplaintInputSchema = z
  .object({
    universityId: z.string().min(1),
    category: z.enum([
      'verbal',
      'physical',
      'sexual',
      'cyber',
      'financial',
      'other',
    ]),
    urgency: z.enum(['normal', 'urgent']),
    staffInvolved: z.boolean(),
    payloadHash: z.string().min(1),
    payloadLocator: z.string().nullable(),
    proof: membershipProofSchema,
  })
  .strict() satisfies z.ZodType<FileComplaintInput>;

export const fileComplaintResultSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict() satisfies z.ZodType<FileComplaintResult>;

// ---------------------------------------------------------------------------
// Support a complaint
// ---------------------------------------------------------------------------

export interface SupportComplaintInput {
  complaintId: string;
  proof: MembershipProof;
}

export interface SupportComplaintResult {
  supportCount: number;
}

export const supportComplaintInputSchema = z
  .object({
    complaintId: z.string().min(1),
    proof: membershipProofSchema,
  })
  .strict() satisfies z.ZodType<SupportComplaintInput>;

export const supportComplaintResultSchema = z
  .object({
    supportCount: z.number().int().nonnegative(),
  })
  .strict() satisfies z.ZodType<SupportComplaintResult>;

// ---------------------------------------------------------------------------
// Update status
// ---------------------------------------------------------------------------

export interface UpdateStatusInput {
  complaintId: string;
  newStatus: Status;
  outcomeHash: string | null;
  /** Off-chain blob locator for the sealed outcome (M041/M068). */
  outcomeLocator?: string | null;
  ownerRole: 'university' | 'ugc';
}

export interface UpdateStatusResult {
  complaintId: string;
  status: Status;
}

export const updateStatusInputSchema = z
  .object({
    complaintId: z.string().min(1),
    newStatus: z.enum(['not_started', 'pending_investigation', 'finished']),
    outcomeHash: z.string().nullable(),
    outcomeLocator: z.string().min(1).nullable().optional(),
    ownerRole: z.enum(['university', 'ugc']),
  })
  .strict() satisfies z.ZodType<UpdateStatusInput>;

export const updateStatusResultSchema = z
  .object({
    complaintId: z.string().min(1),
    status: z.enum(['not_started', 'pending_investigation', 'finished']),
  })
  .strict() satisfies z.ZodType<UpdateStatusResult>;

// ---------------------------------------------------------------------------
// Mark escalated
// ---------------------------------------------------------------------------

export interface MarkEscalatedInput {
  complaintId: string;
}

export interface MarkEscalatedResult {
  complaintId: string;
  escalated: boolean;
}

export const markEscalatedInputSchema = z
  .object({
    complaintId: z.string().min(1),
  })
  .strict() satisfies z.ZodType<MarkEscalatedInput>;

export const markEscalatedResultSchema = z
  .object({
    complaintId: z.string().min(1),
    escalated: z.boolean(),
  })
  .strict() satisfies z.ZodType<MarkEscalatedResult>;

// ---------------------------------------------------------------------------
// Reopen complaint
// ---------------------------------------------------------------------------

export interface ReopenComplaintInput {
  complaintId: string;
}

export interface ReopenComplaintResult {
  complaintId: string;
  reopened: boolean;
}

export const reopenComplaintInputSchema = z
  .object({
    complaintId: z.string().min(1),
  })
  .strict() satisfies z.ZodType<ReopenComplaintInput>;

export const reopenComplaintResultSchema = z
  .object({
    complaintId: z.string().min(1),
    reopened: z.boolean(),
  })
  .strict() satisfies z.ZodType<ReopenComplaintResult>;

// ---------------------------------------------------------------------------
// List complaints
// ---------------------------------------------------------------------------

export interface ListComplaintsFilter {
  viewerRole: ComplaintViewerRole;
  universityId?: string;
  status?: Status;
  category?: Category;
  ownerRole?: OwnerRole;
  escalated?: boolean;
}

export interface ListComplaintsResult {
  complaints: ComplaintListItem[];
}

export const listComplaintsFilterSchema = z
  .object({
    viewerRole: z.enum(['student', 'university', 'ugc']),
    universityId: z.string().min(1).optional(),
    status: z.enum(['not_started', 'pending_investigation', 'finished']).optional(),
    category: z
      .enum(['verbal', 'physical', 'sexual', 'cyber', 'financial', 'other'])
      .optional(),
    ownerRole: z.enum(['university', 'ugc']).optional(),
    escalated: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<ListComplaintsFilter>;

const complaintRecordResultSchema = z.object({
  id: z.string().min(1),
  universityId: z.string().min(1),
  category: z.enum([
    'verbal',
    'physical',
    'sexual',
    'cyber',
    'financial',
    'other',
  ]),
  urgency: z.enum(['normal', 'urgent']),
  staffInvolved: z.boolean(),
  ownerRole: z.enum(['university', 'ugc']),
  payloadHash: z.string().min(1),
  createdAt: z.string().datetime(),
  deadlineAt: z.string().datetime(),
  status: z.enum(['not_started', 'pending_investigation', 'finished']),
  escalated: z.boolean(),
  reopened: z.boolean(),
  supportCount: z.number().int().nonnegative(),
  outcomeHash: z.string().nullable(),
  lastUpdatedAt: z.string().datetime(),
});

const redactedComplaintRecordResultSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  category: z.enum([
    'verbal',
    'physical',
    'sexual',
    'cyber',
    'financial',
    'other',
  ]),
  supportCount: z.number().int().nonnegative(),
  status: z.enum(['not_started', 'pending_investigation', 'finished']),
});

export const listComplaintsResultSchema = z
  .object({
    complaints: z.array(
      z.union([
        complaintRecordResultSchema,
        redactedComplaintRecordResultSchema,
      ]),
    ),
  })
  .strict() satisfies z.ZodType<ListComplaintsResult>;

// ---------------------------------------------------------------------------
// Get complaint
// ---------------------------------------------------------------------------

export interface GetComplaintInput {
  viewerRole: ComplaintViewerRole;
  universityId?: string;
  complaintId: string;
}

export interface GetComplaintResult {
  complaint: ComplaintListItem;
}

export const getComplaintInputSchema = z
  .object({
    viewerRole: z.enum(['student', 'university', 'ugc']),
    universityId: z.string().min(1).optional(),
    complaintId: z.string().min(1),
  })
  .strict() satisfies z.ZodType<GetComplaintInput>;

export const getComplaintResultSchema = z
  .object({
    complaint: z.union([
      complaintRecordResultSchema,
      redactedComplaintRecordResultSchema,
    ]),
  })
  .strict() satisfies z.ZodType<GetComplaintResult>;

// ---------------------------------------------------------------------------
// Get history
// ---------------------------------------------------------------------------

export interface GetHistoryInput {
  viewerRole: ComplaintViewerRole;
  universityId?: string;
  complaintId: string;
}

export interface GetHistoryResult {
  entries: HistoryEntry[];
}

export const getHistoryInputSchema = z
  .object({
    viewerRole: z.enum(['student', 'university', 'ugc']),
    universityId: z.string().min(1).optional(),
    complaintId: z.string().min(1),
  })
  .strict() satisfies z.ZodType<GetHistoryInput>;

export const getHistoryResultSchema = z
  .object({
    entries: z.array(
      z.object({
        complaintId: z.string().min(1),
        status: z.enum(['not_started', 'pending_investigation', 'finished']),
        at: z.string().datetime(),
        actorRole: z.enum(['student', 'university', 'ugc', 'system']),
        noteHash: z.string().nullable(),
      }),
    ),
  })
  .strict() satisfies z.ZodType<GetHistoryResult>;

// ---------------------------------------------------------------------------
// Get stats
// ---------------------------------------------------------------------------

export interface GetStatsInput {
  viewerRole: ComplaintViewerRole;
  universityId?: string;
}

export type ProtectedCount = number | null;
export type StatsBreakdown<K extends string> = Record<
  K,
  ProtectedCount
> & { other: ProtectedCount };
export type CategoryStatsBreakdown = StatsBreakdown<Exclude<Category, 'other'>>;
export type UrgencyStatsBreakdown = StatsBreakdown<Urgency>;
export type StatusStatsBreakdown = StatsBreakdown<Status>;

export interface GetStatsResult {
  totalComplaints: ProtectedCount;
  byCategory: CategoryStatsBreakdown;
  byUrgency: UrgencyStatsBreakdown;
  byStatus: StatusStatsBreakdown;
  overdue: ProtectedCount;
  staffInvolved: ProtectedCount;
  byUniversity?: Record<string, number>;
}

export const getStatsInputSchema = z
  .object({
    viewerRole: z.enum(['student', 'university', 'ugc']),
    universityId: z.string().min(1).optional(),
  })
  .strict() satisfies z.ZodType<GetStatsInput>;

const protectedCountSchema = z.number().int().nonnegative().nullable();

export const getStatsResultSchema = z
  .object({
    totalComplaints: protectedCountSchema,
    byCategory: z
      .object({
        verbal: protectedCountSchema,
        physical: protectedCountSchema,
        sexual: protectedCountSchema,
        cyber: protectedCountSchema,
        financial: protectedCountSchema,
        other: protectedCountSchema,
      })
      .strict(),
    byUrgency: z
      .object({
        normal: protectedCountSchema,
        urgent: protectedCountSchema,
        other: protectedCountSchema,
      })
      .strict(),
    byStatus: z
      .object({
        not_started: protectedCountSchema,
        pending_investigation: protectedCountSchema,
        finished: protectedCountSchema,
        other: protectedCountSchema,
      })
      .strict(),
    overdue: protectedCountSchema,
    staffInvolved: protectedCountSchema,
    byUniversity: z
      .record(z.string().min(1), z.number().int().nonnegative())
      .optional(),
  })
  .strict() satisfies z.ZodType<GetStatsResult>;
