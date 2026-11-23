// Anonymity helpers: timing noise, serialized submissions, and small-group
// protection. These prevent re-identification through timing and small-group
// analysis.

// Returns a random delay in milliseconds between min and max (inclusive),
// using crypto.getRandomValues so the delay cannot be predicted or linked to
// a wall-clock event.
export function randomDelayMs(min: number, max: number): number {
  if (min < 0 || max < min) {
    throw new Error('invalid delay range');
  }
  const span = max - min;
  const random = crypto.getRandomValues(new Uint32Array(1))[0]!;
  // Map [0, 2^32-1] to [0, span] uniformly enough for timing noise.
  const fraction = random / 0xffffffff;
  return min + Math.floor(fraction * (span + 1));
}

// A serialized submission queue with random per-item delay. Items are
// processed one at a time in FIFO order, each waiting a random delay between
// minDelayMs and maxDelayMs before being handed to `handler`. This prevents
// an observer from correlating submission times with wall-clock events or
// linking multiple submissions from the same student.
//
// handler returns a promise; submit returns a promise that resolves/rejects
// with the handler's result.
export class SubmitQueue {
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly handler: () => Promise<unknown>;
  private queue: Array<{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void }> = [];
  private running = false;

  constructor(
    minDelayMs: number,
    maxDelayMs: number,
    handler: () => Promise<unknown>,
  ) {
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.handler = handler;
  }

  // Queues a submission and returns a promise that resolves when it completes.
  submit(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      if (!this.running) {
        void this.processNext();
      }
    });
  }

  private async processNext(): Promise<void> {
    const item = this.queue.shift();
    if (!item) {
      this.running = false;
      return;
    }

    this.running = true;

    const delay = randomDelayMs(this.minDelayMs, this.maxDelayMs);
    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      const result = await this.handler();
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    }

    // Continue with the next queued item.
    await this.processNext();
  }

  // Returns the number of items waiting (not including the one in flight).
  pending(): number {
    return this.queue.length;
  }

  // Returns whether an item is currently being processed.
  isRunning(): boolean {
    return this.running;
  }
}

// Returns null when count is below minGroup (small-group protection), so
// breakdowns of tiny groups are merged into "other" rather than exposing
// small populations. Returns count otherwise.
export function bucketCount(count: number, minGroup: number): number | null {
  if (minGroup < 1) {
    throw new Error('minGroup must be at least 1');
  }
  if (count < minGroup) {
    return null;
  }
  return count;
}
