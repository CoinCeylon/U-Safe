import { describe, expect, it } from 'vitest';
import { shouldShowMockBanner } from './frame';

describe('mock-mode banner (M048 / AGENT.md section 6)', () => {
  it('is shown only when the server reports mock mode', () => {
    expect(shouldShowMockBanner('mock')).toBe(true);
    expect(shouldShowMockBanner('testnet')).toBe(false);
    expect(shouldShowMockBanner(undefined)).toBe(false);
    expect(shouldShowMockBanner('')).toBe(false);
  });
});
