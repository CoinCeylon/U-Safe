import { describe, expect, it } from 'vitest';
import { detailStateSummary } from './detail';

describe('complaint detail states (M055)', () => {
  it('shows a not-started complaint without escalation or outcome', () => {
    expect(
      detailStateSummary({
        status: 'not_started',
        escalated: false,
        outcomeHash: null,
      }),
    ).toEqual({
      status: 'Not started',
      showEscalation: false,
      showOutcome: false,
    });
  });

  it('shows a pending complaint without escalation or outcome', () => {
    expect(
      detailStateSummary({
        status: 'pending_investigation',
        escalated: false,
        outcomeHash: null,
      }),
    ).toEqual({
      status: 'Pending investigation',
      showEscalation: false,
      showOutcome: false,
    });
  });

  it('shows the escalation notice for an overdue complaint', () => {
    expect(
      detailStateSummary({
        status: 'not_started',
        escalated: true,
        outcomeHash: null,
      }).showEscalation,
    ).toBe(true);
  });

  it('shows the decrypted outcome only for a finished complaint with a hash', () => {
    expect(
      detailStateSummary({
        status: 'finished',
        escalated: false,
        outcomeHash: 'ab'.repeat(32),
      }),
    ).toMatchObject({ status: 'Finished', showOutcome: true });
    expect(
      detailStateSummary({
        status: 'finished',
        escalated: false,
        outcomeHash: null,
      }).showOutcome,
    ).toBe(false);
  });
});
