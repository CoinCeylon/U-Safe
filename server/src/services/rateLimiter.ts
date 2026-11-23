interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number = Date.now()): boolean {
    if (this.buckets.size > 1000) {
      for (const [storedKey, bucket] of this.buckets) {
        if (now >= bucket.resetAt) {
          this.buckets.delete(storedKey);
        }
      }
    }

    const bucket = this.buckets.get(key);
    if (bucket === undefined || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (bucket.count >= this.limit) {
      return false;
    }
    bucket.count += 1;
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }
}
