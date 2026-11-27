const readEnv = (key: string): string | undefined => {
  if (typeof process === 'undefined') {
    return undefined;
  }

  const value = process.env[key];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
};

const readPositiveInt = (key: string, fallback: number): number => {
  const value = readEnv(key);
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const readOptionalPositiveInt = (key: string): number | undefined => {
  const value = readEnv(key);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

export const MERKLE_TREE_DEPTH = readPositiveInt('MERKLE_TREE_DEPTH', 20);

export const OTP_LENGTH = readPositiveInt('OTP_LENGTH', 6);
export const OTP_EXPIRY_MINUTES = readPositiveInt('OTP_EXPIRY_MINUTES', 10);
export const OTP_MAX_ATTEMPTS = readPositiveInt('OTP_MAX_ATTEMPTS', 5);
export const ENROLLMENT_TICKET_EXPIRY_MINUTES = readPositiveInt(
  'ENROLLMENT_TICKET_EXPIRY_MINUTES',
  15,
);

export const FILING_LIMIT_PER_MONTH = readPositiveInt('FILING_LIMIT_PER_MONTH', 2);

export const MAX_EVIDENCE_FILES = readPositiveInt('MAX_EVIDENCE_FILES', 5);
export const MAX_EVIDENCE_FILE_BYTES = readPositiveInt(
  'MAX_EVIDENCE_FILE_BYTES',
  25 * 1024 * 1024,
);

// Default allowed values. These tuples define the literal union types in
// types.ts, so the type system stays checkable while the runtime lists below
// can still be narrowed/reordered with environment variables.
export const DEFAULT_CATEGORIES = [
  'verbal',
  'physical',
  'sexual',
  'cyber',
  'financial',
  'other',
] as const;

export const DEFAULT_URGENCIES = ['normal', 'urgent'] as const;

export const DEFAULT_STATUSES = [
  'not_started',
  'pending_investigation',
  'finished',
] as const;

// Reads a comma-separated environment variable and keeps only values that are
// in the allowed default list, so a typo can never introduce an unknown value
// that zod (and the rest of the system) does not understand.
const readEnumList = <T extends string>(
  key: string,
  allowed: readonly T[],
): readonly T[] => {
  const value = readEnv(key);
  if (value === undefined) {
    return allowed;
  }
  const parsed = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is T => (allowed as readonly string[]).includes(entry));
  return parsed.length > 0 ? parsed : allowed;
};

export const CATEGORIES: readonly (typeof DEFAULT_CATEGORIES)[number][] =
  readEnumList('CATEGORIES', DEFAULT_CATEGORIES);

export const URGENCIES: readonly (typeof DEFAULT_URGENCIES)[number][] =
  readEnumList('URGENCIES', DEFAULT_URGENCIES);

export const STATUSES: readonly (typeof DEFAULT_STATUSES)[number][] =
  readEnumList('STATUSES', DEFAULT_STATUSES);

export const NORMAL_DEADLINE_SECONDS = readPositiveInt(
  'NORMAL_DEADLINE_SECONDS',
  7 * 24 * 60 * 60,
);
export const URGENT_DEADLINE_SECONDS = readPositiveInt(
  'URGENT_DEADLINE_SECONDS',
  24 * 60 * 60,
);
export const DEMO_SLA_SECONDS = readOptionalPositiveInt('DEMO_SLA_SECONDS');

export const SUPPORT_ALERT_THRESHOLD = readPositiveInt('SUPPORT_ALERT_THRESHOLD', 10);

export const MIN_GROUP_SIZE = readPositiveInt('MIN_GROUP_SIZE', 5);

// ---------------------------------------------------------------------------
// Emergency helplines (student help page, M062)
// ---------------------------------------------------------------------------

/** One emergency helpline shown on the student help page. */
export interface Helpline {
  name: string;
  phone: string;
  description?: string;
}

// The list is deliberately empty by default: a deployer must configure real,
// verified numbers for their institution (see docs/DECISIONS.md). The help
// page always shows generic emergency guidance, so an unconfigured list never
// leaves a student without direction.
export const DEFAULT_HELPLINES: Helpline[] = [];

const isHelpline = (value: unknown): value is Helpline =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Helpline).name === 'string' &&
  (value as Helpline).name.trim().length > 0 &&
  typeof (value as Helpline).phone === 'string' &&
  (value as Helpline).phone.trim().length > 0 &&
  ((value as Helpline).description === undefined ||
    typeof (value as Helpline).description === 'string');

const readHelplines = (): Helpline[] => {
  const value = readEnv('HELPLINES');
  if (value === undefined) {
    return DEFAULT_HELPLINES;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return DEFAULT_HELPLINES;
    }
    const helplines = parsed.filter(isHelpline);
    return helplines.length > 0 ? helplines : DEFAULT_HELPLINES;
  } catch {
    return DEFAULT_HELPLINES;
  }
};

// Helpline numbers for the student help page, overridable with the HELPLINES
// environment variable (a JSON array of {name, phone, description?}).
export const HELPLINES: Helpline[] = readHelplines();
