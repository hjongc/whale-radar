import { describe, expect, it, vi } from "vitest";

import { RateLimiter } from "@/lib/net/rate-limiter";

describe("RateLimiter", () => {
  it("waits when threshold would be exceeded", async () => {
    let currentTime = 1_000;
    const sleep = vi.fn(async (ms: number) => {
      currentTime += ms;
    });

    const limiter = new RateLimiter({
      maxRequests: 1,
      perMilliseconds: 100,
      now: () => currentTime,
      sleep
    });

    await limiter.acquire();
    await limiter.acquire();

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(100);
  });
});
