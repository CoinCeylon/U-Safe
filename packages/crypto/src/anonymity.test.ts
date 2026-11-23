import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomDelayMs, SubmitQueue, bucketCount } from './anonymity';

const originalSetTimeout = globalThis.setTimeout;
type CapturedCall = { cb: (...args: unknown[]) => void; ms: number };
let lastCall: CapturedCall | undefined;

beforeEach(() => {
  lastCall = undefined;
  globalThis.setTimeout = ((cb: (...args: unknown[]) => void, ms?: number) => {
    lastCall = { cb, ms: ms ?? 0 };
    return originalSetTimeout.call(globalThis, cb, 0);
  }) as unknown as typeof setTimeout;
});

afterEach(() => {
  globalThis.setTimeout = originalSetTimeout;
});

function captured(): CapturedCall {
  if (!lastCall) {
    throw new Error('no setTimeout call captured');
  }
  return lastCall;
}

describe('randomDelayMs', () => {
  it('returns a value within [min, max]', () => {
    for (let i = 0; i < 100; i += 1) {
      const d = randomDelayMs(100, 200);
      expect(d).toBeGreaterThanOrEqual(100);
      expect(d).toBeLessThanOrEqual(200);
    }
  });

  it('returns min when min equals max', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(randomDelayMs(50, 50)).toBe(50);
    }
  });

  it('varies across calls (not deterministic)', () => {
    const values = new Set<number>();
    for (let i = 0; i < 50; i += 1) {
      values.add(randomDelayMs(0, 1000));
    }
    expect(values.size).toBeGreaterThan(1);
  });

  it('throws for invalid range', () => {
    expect(() => randomDelayMs(10, 5)).toThrow('invalid delay range');
    expect(() => randomDelayMs(-1, 10)).toThrow('invalid delay range');
  });
});

describe('SubmitQueue', () => {
  const handler = vi.fn(() => Promise.resolve('done'));

  beforeEach(() => {
    handler.mockClear();
    handler.mockResolvedValue('done');
  });

  it('processes a single submission', async () => {
    const queue = new SubmitQueue(0, 0, handler);
    const promise = queue.submit();
    expect(queue.pending()).toBe(0);
    expect(queue.isRunning()).toBe(true);
    captured().cb();
    expect(await promise).toBe('done');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('serializes multiple submissions in FIFO order', async () => {
    const queue = new SubmitQueue(0, 0, handler);
    const p1 = queue.submit();
    const p2 = queue.submit();
    const p3 = queue.submit();
    expect(queue.pending()).toBe(2);

    captured().cb();
    expect(await p1).toBe('done');

    captured().cb();
    expect(await p2).toBe('done');

    captured().cb();
    expect(await p3).toBe('done');

    expect(handler).toHaveBeenCalledTimes(3);
    expect(queue.pending()).toBe(0);
    expect(queue.isRunning()).toBe(false);
  });

  it('propagates handler errors', async () => {
    handler.mockRejectedValue(new Error('boom'));
    const queue = new SubmitQueue(0, 0, handler);
    const promise = queue.submit();
    captured().cb();
    await expect(promise).rejects.toThrow('boom');
  });

  it('applies random delay between items', async () => {
    const queue = new SubmitQueue(10, 20, handler);
    const p1 = queue.submit();
    const p2 = queue.submit();

    const c1 = captured();
    expect(c1.ms).toBeGreaterThanOrEqual(10);
    expect(c1.ms).toBeLessThanOrEqual(20);
    c1.cb();
    await p1;

    const c2 = captured();
    expect(c2.ms).toBeGreaterThanOrEqual(10);
    expect(c2.ms).toBeLessThanOrEqual(20);
    c2.cb();
    await p2;

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('bucketCount', () => {
  it('returns null when count below minGroup', () => {
    expect(bucketCount(0, 5)).toBeNull();
    expect(bucketCount(1, 5)).toBeNull();
    expect(bucketCount(4, 5)).toBeNull();
  });

  it('returns count when at or above minGroup', () => {
    expect(bucketCount(5, 5)).toBe(5);
    expect(bucketCount(6, 5)).toBe(6);
    expect(bucketCount(100, 5)).toBe(100);
  });

  it('returns null for count 0', () => {
    expect(bucketCount(0, 1)).toBeNull();
  });

  it('returns count when minGroup is 1', () => {
    expect(bucketCount(1, 1)).toBe(1);
    expect(bucketCount(0, 1)).toBeNull();
  });

  it('throws for minGroup below 1', () => {
    expect(() => bucketCount(5, 0)).toThrow('minGroup must be at least 1');
    expect(() => bucketCount(5, -1)).toThrow('minGroup must be at least 1');
  });
});
