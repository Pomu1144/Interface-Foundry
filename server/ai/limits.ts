/**
 * Simple in-process limiter for AI calls: a sliding one-minute window plus a
 * concurrency cap. The companion serves one user, so this mainly protects
 * against runaway loops and accidental cost.
 */
export class RateLimiter {
  private stamps: number[] = [];
  private active = 0;

  constructor(
    public readonly perMinute: number,
    public readonly maxConcurrent: number,
  ) {}

  tryAcquire(now = Date.now()): { ok: true; release: () => void } | { ok: false; retryAfterSec: number; reason: string } {
    this.stamps = this.stamps.filter((t) => now - t < 60_000);
    if (this.active >= this.maxConcurrent) return { ok: false, retryAfterSec: 5, reason: `At most ${this.maxConcurrent} diagnoses can run at once.` };
    if (this.stamps.length >= this.perMinute) {
      const retry = Math.max(1, Math.ceil((60_000 - (now - this.stamps[0])) / 1000));
      return { ok: false, retryAfterSec: retry, reason: `Rate limit: ${this.perMinute} diagnoses per minute.` };
    }
    this.stamps.push(now);
    this.active++;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.active = Math.max(0, this.active - 1);
      },
    };
  }
}
