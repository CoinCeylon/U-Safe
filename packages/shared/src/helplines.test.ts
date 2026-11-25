import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('HELPLINES (M062)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env['HELPLINES'];
    vi.resetModules();
  });

  it('defaults to an empty list so no unverified number is shown', async () => {
    const { HELPLINES } = await import('./constants');
    expect(HELPLINES).toEqual([]);
  });

  it('reads a valid JSON list from the HELPLINES environment variable', async () => {
    process.env['HELPLINES'] = JSON.stringify([
      {
        name: 'Campus security',
        phone: '011 265 0000',
        description: '24-hour campus security desk',
      },
      { name: 'Student counselling', phone: '011 265 0001' },
    ]);
    const { HELPLINES } = await import('./constants');
    expect(HELPLINES).toHaveLength(2);
    expect(HELPLINES[0]?.name).toBe('Campus security');
    expect(HELPLINES[0]?.description).toBe('24-hour campus security desk');
    expect(HELPLINES[1]?.description).toBeUndefined();
  });

  it('drops entries that are missing a name or phone number', async () => {
    process.env['HELPLINES'] = JSON.stringify([
      { name: 'Valid desk', phone: '011 265 0000' },
      { name: '', phone: '011 265 0001' },
      { name: 'No phone' },
      'not-an-object',
    ]);
    const { HELPLINES } = await import('./constants');
    expect(HELPLINES).toHaveLength(1);
    expect(HELPLINES[0]?.name).toBe('Valid desk');
  });

  it('falls back to the default list on invalid JSON', async () => {
    process.env['HELPLINES'] = 'not json at all';
    const { HELPLINES, DEFAULT_HELPLINES } = await import('./constants');
    expect(HELPLINES).toEqual(DEFAULT_HELPLINES);
  });
});
