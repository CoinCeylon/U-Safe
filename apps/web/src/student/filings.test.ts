import { describe, expect, it } from 'vitest';
import { MemoryStorage, SecureStore, type SecureStore as Store } from '@usafe/crypto';
import {
  countFilingsInMonth,
  loadFilingReceipts,
  saveFilingReceipt,
  sortReceiptsNewestFirst,
  updateFilingStatus,
  type FilingReceipt,
} from './filings';

const makeReceipt = (complaintId: string, filedAt: string): FilingReceipt => ({
  complaintId,
  universityId: 'u1',
  category: 'verbal',
  urgency: 'normal',
  staffInvolved: false,
  payloadHash: 'ab'.repeat(32),
  payloadLocator: 'ab'.repeat(32),
  filedAt,
  description: 'A group of senior students keeps shouting insults.',
  evidence: [
    {
      hash: 'cd'.repeat(32),
      name: 'photo.png',
      type: 'image/png',
      size: 12,
      fileKey: 'AAECAwQFBgcICQ==',
    },
  ],
});

const makeStore = (): Store =>
  new SecureStore(crypto.getRandomValues(new Uint8Array(32)), new MemoryStorage());

describe('filing receipts (M061)', () => {
  it('round-trips receipts through the encrypted store', async () => {
    const store = makeStore();
    const receipt = makeReceipt('c-1', '2026-11-25T10:00:00.000Z');
    await saveFilingReceipt(receipt, store);

    const loaded = await loadFilingReceipts(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(receipt);
  });

  it('never stores a duplicate receipt for the same complaint', async () => {
    const store = makeStore();
    const receipt = makeReceipt('c-1', '2026-11-25T10:00:00.000Z');
    await saveFilingReceipt(receipt, store);
    await saveFilingReceipt(
      { ...receipt, description: 'changed' },
      store,
    );

    const loaded = await loadFilingReceipts(store);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.description).toBe('A group of senior students keeps shouting insults.');
  });

  it('records the latest observed status for later page loads', async () => {
    const store = makeStore();
    await saveFilingReceipt(makeReceipt('c-1', '2026-11-25T10:00:00.000Z'), store);
    await saveFilingReceipt(makeReceipt('c-2', '2026-11-24T10:00:00.000Z'), store);

    await updateFilingStatus(
      'c-1',
      { lastStatus: 'pending_investigation', escalated: true },
      store,
    );

    const loaded = await loadFilingReceipts(store);
    const one = loaded.find((entry) => entry.complaintId === 'c-1');
    const two = loaded.find((entry) => entry.complaintId === 'c-2');
    expect(one?.lastStatus).toBe('pending_investigation');
    expect(one?.escalated).toBe(true);
    expect(two?.lastStatus).toBeUndefined();
    expect(two?.escalated).toBeUndefined();
  });

  it('ignores a status update for an unknown complaint', async () => {
    const store = makeStore();
    await saveFilingReceipt(makeReceipt('c-1', '2026-11-25T10:00:00.000Z'), store);
    await updateFilingStatus('c-missing', { lastStatus: 'finished' }, store);

    const loaded = await loadFilingReceipts(store);
    expect(loaded[0]?.lastStatus).toBeUndefined();
  });

  it('counts this month\'s filings for the slots display (M057)', () => {
    const receipts = [
      makeReceipt('nov-1', '2026-11-02T10:00:00.000Z'),
      makeReceipt('nov-2', '2026-11-25T10:00:00.000Z'),
      makeReceipt('oct', '2026-10-31T10:00:00.000Z'),
    ];
    expect(countFilingsInMonth(receipts, new Date(2026, 10, 25))).toBe(2);
    expect(countFilingsInMonth(receipts, new Date(2026, 11, 1))).toBe(0);
    expect(countFilingsInMonth([], new Date(2026, 10, 25))).toBe(0);
  });

  it('sorts receipts newest first', () => {
    const receipts = [
      makeReceipt('old', '2026-10-01T10:00:00.000Z'),
      makeReceipt('new', '2026-11-25T10:00:00.000Z'),
      makeReceipt('middle', '2026-11-01T10:00:00.000Z'),
    ];
    expect(sortReceiptsNewestFirst(receipts).map((r) => r.complaintId)).toEqual([
      'new',
      'middle',
      'old',
    ]);
    // The input order is untouched.
    expect(receipts[0]?.complaintId).toBe('old');
  });

  it('tolerates unreadable or malformed stored values', async () => {
    const store = makeStore();
    await store.put('filings', 'not-json');
    expect(await loadFilingReceipts(store)).toEqual([]);

    await store.put('filings', JSON.stringify([{ complaintId: 7 }]));
    expect(await loadFilingReceipts(store)).toEqual([]);
  });
});
