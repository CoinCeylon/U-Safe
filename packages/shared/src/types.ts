import type { CATEGORIES, STATUSES, URGENCIES } from './constants';

export type Category = (typeof CATEGORIES)[number];
export type Urgency = (typeof URGENCIES)[number];
export type Status = (typeof STATUSES)[number];

export type OwnerRole = 'university' | 'ugc';
export type ComplaintViewerRole = 'student' | 'university' | 'ugc';
export type UniversityStatus = 'active' | 'suspended';
export type HistoryActorRole = 'student' | 'university' | 'ugc' | 'system';

export interface ComplaintRecord {
  id: string;
  universityId: string;
  category: Category;
  urgency: Urgency;
  staffInvolved: boolean;
  ownerRole: OwnerRole;
  payloadHash: string;
  createdAt: string;
  deadlineAt: string;
  status: Status;
  escalated: boolean;
  reopened: boolean;
  supportCount: number;
  outcomeHash: string | null;
  lastUpdatedAt: string;
}

export interface RedactedComplaintRecord {
  id: string;
  createdAt: string;
  category: Category;
  supportCount: number;
  status: Status;
}

export type ComplaintListItem = ComplaintRecord | RedactedComplaintRecord;

export interface UniversityRecord {
  id: string;
  name: string;
  domain: string;
  enrollmentCeiling: number;
  status: UniversityStatus;
}

export interface HistoryEntry {
  complaintId: string;
  status: Status;
  at: string;
  actorRole: HistoryActorRole;
  noteHash: string | null;
}
