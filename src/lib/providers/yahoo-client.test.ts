import { describe, expect, it, vi } from "vitest";

import { ProviderRequestError } from "@/lib/net/errors";
import { YahooPriceClient } from "@/lib/providers/yahoo-client";

describe("YahooPriceClient", () => {
  it("returns typed terminal failure payload after retry exhaustion", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("timeout", "AbortError");
    });
    const sleep = vi.fn(async () => {});

    const client = new YahooPriceClient(
      {
        baseUrl: "https://yahoo.example",
        timeoutMs: 5,
        maxRetries: 2,
        rateLimit: { maxRequests: 10, perMilliseconds: 1_000 }
      },
      {
        fetchImpl,
        sleep,
        random: () => 0
      }
    );

    await expect(client.getPriceChart("AAPL")).rejects.toMatchObject({
      name: "ProviderRequestError",
      payload: {
        source: "yahoo",
        reason: "timeout",
        retries: 2,
        message: "Upstream request timed out"
      }
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("keeps terminal error payload strongly typed", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket failure");
    });

    const client = new YahooPriceClient(
      { maxRetries: 0, rateLimit: { maxRequests: 10, perMilliseconds: 1_000 } },
      { fetchImpl }
    );

    await expect(client.getPriceChart("MSFT")).rejects.toBeInstanceOf(ProviderRequestError);
  });
});
