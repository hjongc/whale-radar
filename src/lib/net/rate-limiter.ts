export interface RateLimiterConfig {
  maxRequests: number;
  perMilliseconds: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export class RateLimiter {
  private readonly maxRequests: number;
  private readonly perMilliseconds: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timestamps: number[] = [];

  constructor(config: RateLimiterConfig) {
    if (config.maxRequests < 1) {
      throw new Error("maxRequests must be >= 1");
    }

    if (config.perMilliseconds < 1) {
      throw new Error("perMilliseconds must be >= 1");
    }

    this.maxRequests = config.maxRequests;
    this.perMilliseconds = config.perMilliseconds;
    this.now = config.now ?? Date.now;
    this.sleep = config.sleep ?? defaultSleep;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const currentTime = this.now();
      this.compact(currentTime);

      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(currentTime);
        return;
      }

      const oldest = this.timestamps[0];
      const waitMs = Math.max(1, this.perMilliseconds - (currentTime - oldest));
      await this.sleep(waitMs);
    }
  }

  private compact(currentTime: number): void {
    while (this.timestamps.length > 0) {
      const oldest = this.timestamps[0];
      if (currentTime - oldest < this.perMilliseconds) {
        return;
      }

      this.timestamps.shift();
    }
  }
}
