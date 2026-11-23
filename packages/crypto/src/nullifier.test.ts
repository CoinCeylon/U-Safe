import { describe, it, expect } from 'vitest';
import {
  commitment,
  supportNullifier,
  filingNullifier,
  inboxKey,
} from './nullifier';

const enc = new TextEncoder();
const secret = enc.encode('test-student-secret-bytes');

describe('commitment', () => {
  it('is deterministic for the same secret', async () => {
    const a = await commitment(secret);
    const b = await commitment(secret);
    expect(a).toEqual(b);
  });

  it('differs for different secrets', async () => {
    const a = await commitment(secret);
    const b = await commitment(enc.encode('other-secret'));
    expect(a).not.toEqual(b);
  });
});

describe('supportNullifier', () => {
  it('is deterministic for the same secret and complaint id', async () => {
    const a = await supportNullifier(secret, 'complaint-1');
    const b = await supportNullifier(secret, 'complaint-1');
    expect(a).toEqual(b);
  });

  it('differs for different complaint ids', async () => {
    const a = await supportNullifier(secret, 'complaint-1');
    const b = await supportNullifier(secret, 'complaint-2');
    expect(a).not.toEqual(b);
  });
});

describe('filingNullifier', () => {
  it('is deterministic for the same secret, year-month and slot', async () => {
    const a = await filingNullifier(secret, '2026-01', 0);
    const b = await filingNullifier(secret, '2026-01', 0);
    expect(a).toEqual(b);
  });

  it('differs between slots for the same month', async () => {
    const a = await filingNullifier(secret, '2026-01', 0);
    const b = await filingNullifier(secret, '2026-01', 1);
    expect(a).not.toEqual(b);
  });

  it('differs between months', async () => {
    const a = await filingNullifier(secret, '2026-01', 0);
    const b = await filingNullifier(secret, '2026-02', 0);
    expect(a).not.toEqual(b);
  });

  it('rejects slots other than 0 or 1', async () => {
    await expect(filingNullifier(secret, '2026-01', 2)).rejects.toThrow(
      'filing slot must be 0 or 1',
    );
    await expect(filingNullifier(secret, '2026-01', -1)).rejects.toThrow(
      'filing slot must be 0 or 1',
    );
  });
});

describe('inboxKey', () => {
  it('is deterministic for the same secret and complaint id', async () => {
    const a = await inboxKey(secret, 'complaint-1');
    const b = await inboxKey(secret, 'complaint-1');
    expect(a).toEqual(b);
  });

  it('differs for different complaint ids', async () => {
    const a = await inboxKey(secret, 'complaint-1');
    const b = await inboxKey(secret, 'complaint-2');
    expect(a).not.toEqual(b);
  });
});

describe('cross-derived-value separation', () => {
  // All four derived values must differ from each other for the same secret
  // so no value can be confused with another.
  it('all four outputs differ from each other for the same secret', async () => {
    const a = await commitment(secret);
    const b = await supportNullifier(secret, 'complaint-1');
    const c = await filingNullifier(secret, '2026-01', 0);
    const d = await inboxKey(secret, 'complaint-1');

    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).not.toEqual(d);
    expect(b).not.toEqual(c);
    expect(b).not.toEqual(d);
    expect(c).not.toEqual(d);
  });
});
