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

export const CATEGORIES = [
  'verbal',
  'physical',
  'sexual',
  'cyber',
  'financial',
  'other',
] as const;

export const URGENCIES = ['normal', 'urgent'] as const;

export const STATUSES = ['not_started', 'pending_investigation', 'finished'] as const;

export const NORMAL_DEADLINE_SECONDS = 7 * 24 * 60 * 60;
export const URGENT_DEADLINE_SECONDS = 24 * 60 * 60;
export const DEMO_SLA_SECONDS = readOptionalPositiveInt('DEMO_SLA_SECONDS');

export const SUPPORT_ALERT_THRESHOLD = readPositiveInt('SUPPORT_ALERT_THRESHOLD', 10);

export const MIN_GROUP_SIZE = readPositiveInt('MIN_GROUP_SIZE', 5);
