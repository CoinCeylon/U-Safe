import { describe, it, expect } from 'vitest';
import { Sha256Adapter, setHashAdapter, getHashAdapter, hash } from './hash';

const enc = new TextEncoder();

describe('Sha256Adapter', () => {
  // Domain separation: the same input hashed under different domain tags must
  // produce unrelated outputs. This prevents collisions between commitments,
  // nullifiers, inbox keys and other derived values that share a secret.
  it('produces different outputs for different domain tags with the same input', async () => {
    const adapter = new Sha256Adapter();
    const part = enc.encode('same input');
    const a = await adapter.hash('domain-a', part);
    const b = await adapter.hash('domain-b', part);
    expect(a).not.toEqual(b);
  });

  // Determinism: identical inputs must always yield the same digest so the
  // same student secret reproduces the same commitment across sessions.
  it('is deterministic for the same inputs', async () => {
    const adapter = new Sha256Adapter();
    const part = enc.encode('input');
    const a = await adapter.hash('domain', part);
    const b = await adapter.hash('domain', part);
    expect(a).toEqual(b);
  });

  // Distinct inputs must yield distinct outputs under the same domain tag.
  it('produces different outputs for different parts', async () => {
    const adapter = new Sha256Adapter();
    const a = await adapter.hash('domain', enc.encode('x'));
    const b = await adapter.hash('domain', enc.encode('y'));
    expect(a).not.toEqual(b);
  });

  // SHA-256 output size is 32 bytes; all derived values use this fixed width.
  it('returns 32 bytes', async () => {
    const adapter = new Sha256Adapter();
    const result = await adapter.hash('domain', enc.encode('input'));
    expect(result).toHaveLength(32);
  });
});

describe('setHashAdapter', () => {
  // The adapter swap mechanism lets Group 9 install a Midnight-compatible
  // hash without changing any call site, so commitments match on-chain values.
  it('swaps the active adapter used by hash()', async () => {
    const previous = getHashAdapter();
    try {
      let called = false;
      setHashAdapter({
        async hash() {
          called = true;
          return await Promise.resolve(enc.encode('replaced'));
        },
      });
      const result = await hash('domain');
      expect(called).toBe(true);
      expect(result).toEqual(enc.encode('replaced'));
    } finally {
      // Restore the real adapter so other tests are not affected.
      setHashAdapter(previous);
    }
  });
});
