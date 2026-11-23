import { hash } from './hash';

// Domain tags used by the hash adapter for each derived value. Each tag is
// distinct so that the same secret never produces identical output across
// different derived values (commitment, support nullifier, filing nullifier,
// inbox key).
export const DOMAIN_TAG_COMMITMENT = 'commitment';
export const DOMAIN_TAG_SUPPORT_NULLIFIER = 'support-nullifier';
export const DOMAIN_TAG_FILING_NULLIFIER = 'filing-nullifier';
export const DOMAIN_TAG_INBOX_KEY = 'inbox-key';

// Derives a student's commitment (the public leaf value added to the Merkle
// tree at enrollment) from their secret.
//
// commitment = hash('commitment', secret)
//
// This is the only value that leaves the browser at enrollment; the secret
// itself is never transmitted or stored.
export async function commitment(secret: Uint8Array): Promise<Uint8Array> {
  return hash(DOMAIN_TAG_COMMITMENT, secret);
}

// Derives a support nullifier so a student can support a complaint exactly
// once. The nullifier is bound to both the secret and the complaint id.
//
// supportNullifier = hash('support-nullifier', secret, complaintId)
export async function supportNullifier(
  secret: Uint8Array,
  complaintId: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  return hash(
    DOMAIN_TAG_SUPPORT_NULLIFIER,
    secret,
    encoder.encode(complaintId),
  );
}

// Derives a filing nullifier for rate limiting complaints per month. Each
// student has FILING_LIMIT_PER_MONTH filing slots per year-month; a slot of
// 0 or 1 is appended so the same secret can file up to the limit without
// repeating a nullifier.
//
// filingNullifier = hash('filing-nullifier', secret, yearMonth, slot)
export async function filingNullifier(
  secret: Uint8Array,
  yearMonth: string,
  slot: number,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  if (slot !== 0 && slot !== 1) {
    throw new Error('filing slot must be 0 or 1');
  }
  return hash(
    DOMAIN_TAG_FILING_NULLIFIER,
    secret,
    encoder.encode(yearMonth),
    encoder.encode(String(slot)),
  );
}

// Derives an inbox key used to open sealed messages in a complaint's anonymous
// mailbox. Bound to both the secret and the complaint id.
//
// inboxKey = hash('inbox-key', secret, complaintId)
export async function inboxKey(
  secret: Uint8Array,
  complaintId: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  return hash(DOMAIN_TAG_INBOX_KEY, secret, encoder.encode(complaintId));
}
