import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHALLENGE_TTL_MS,
  clearChallenges,
  consumeChallenge,
  issueChallenge,
} from './staffAuth';

describe('staff CIP-8 challenge store (M032)', () => {
  beforeEach(() => {
    clearChallenges();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T10:00:00.000Z'));
  });

  afterEach(() => {
    clearChallenges();
    vi.useRealTimers();
  });

  it('issues a nonce that can be consumed exactly once', () => {
    const nonce = issueChallenge();
    expect(nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(consumeChallenge(nonce)).toBe(true);
    expect(consumeChallenge(nonce)).toBe(false);
  });

  it('rejects an unknown nonce', () => {
    expect(consumeChallenge('deadbeef')).toBe(false);
  });

  it('rejects an expired nonce', () => {
    const nonce = issueChallenge();
    vi.setSystemTime(new Date(Date.now() + CHALLENGE_TTL_MS + 1));
    expect(consumeChallenge(nonce)).toBe(false);
  });
});
