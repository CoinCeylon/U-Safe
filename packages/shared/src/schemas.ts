import { z } from 'zod';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_STATUSES,
  DEFAULT_URGENCIES,
} from './constants';
import type {
  Category,
  ComplaintRecord,
  HistoryActorRole,
  HistoryEntry,
  OwnerRole,
  Status,
  UniversityRecord,
  UniversityStatus,
  Urgency,
} from './types';

export const categorySchema = z.enum(DEFAULT_CATEGORIES) satisfies z.ZodType<Category>;
export const urgencySchema = z.enum(DEFAULT_URGENCIES) satisfies z.ZodType<Urgency>;
export const statusSchema = z.enum(DEFAULT_STATUSES) satisfies z.ZodType<Status>;

export const ownerRoleSchema = z.enum(['university', 'ugc']) satisfies z.ZodType<OwnerRole>;
export const universityStatusSchema = z.enum([
  'active',
  'suspended',
]) satisfies z.ZodType<UniversityStatus>;
export const historyActorRoleSchema = z.enum([
  'student',
  'university',
  'ugc',
  'system',
]) satisfies z.ZodType<HistoryActorRole>;

export const complaintRecordSchema = z.object({
  id: z.string().min(1),
  universityId: z.string().min(1),
  category: categorySchema,
  urgency: urgencySchema,
  staffInvolved: z.boolean(),
  ownerRole: ownerRoleSchema,
  payloadHash: z.string().min(1),
  createdAt: z.string().datetime(),
  deadlineAt: z.string().datetime(),
  status: statusSchema,
  escalated: z.boolean(),
  reopened: z.boolean(),
  supportCount: z.number().int().nonnegative(),
  outcomeHash: z.string().min(1).nullable(),
  lastUpdatedAt: z.string().datetime(),
}) satisfies z.ZodType<ComplaintRecord>;

export const universityRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  domain: z.string().min(1),
  enrollmentCeiling: z.number().int().positive(),
  status: universityStatusSchema,
}) satisfies z.ZodType<UniversityRecord>;

export const historyEntrySchema = z.object({
  complaintId: z.string().min(1),
  status: statusSchema,
  at: z.string().datetime(),
  actorRole: historyActorRoleSchema,
  noteHash: z.string().min(1).nullable(),
}) satisfies z.ZodType<HistoryEntry>;
