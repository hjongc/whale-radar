import { describe, expect, it } from "vitest";

import { computeCurrentGapMetric } from "@/lib/metrics/gap";

describe("computeCurrentGapMetric", () => {
  it("computes gap and provenance with fresh badge", () => {
    const result = computeCurrentGapMetric({
      costBasis: 100,
      currentPrice: 110,
      priceTimestamp: "2026-01-05T00:00:00.000Z",
      source: "yahoo",
      calcVersion: "vwap-quarter-v1",
      asOf: new Date("2026-01-07T00:00:00.000Z")
    });

    expect(result.gapPercent).toBeCloseTo(10, 6);
    expect(result.gap).toBe("+10.00%");
    expect(result.provenance).toEqual({
      price_timestamp: "2026-01-05T00:00:00.000Z",
      source: "yahoo",
      calc_version: "vwap-quarter-v1"
    });
    expect(result.freshness.badge).toBe("fresh");
    expect(result.freshness.isStale).toBe(false);
  });

  it("marks stale prices with explicit stale reason", () => {
    const result = computeCurrentGapMetric({
      costBasis: 100,
      currentPrice: 90,
      priceTimestamp: "2026-01-01T00:00:00.000Z",
      source: "yahoo",
      calcVersion: "vwap-quarter-v1",
      asOf: new Date("2026-01-10T00:00:00.000Z"),
      staleThresholdDays: 5
    });

    expect(result.gap).toBe("-10.00%");
    expect(result.freshness.badge).toBe("stale");
    expect(result.freshness.staleReason).toBe("latest_close_older_than_5_days");
  });
});
