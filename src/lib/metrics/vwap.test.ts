import { describe, expect, it } from "vitest";

import { computeQuarterWindowVwap } from "@/lib/metrics/vwap";

describe("computeQuarterWindowVwap", () => {
  it("computes deterministic quarter-window VWAP from fixed OHLCV bars", () => {
    const bars = [
      {
        timestampMs: Date.parse("2025-09-20T00:00:00.000Z"),
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 10
      },
      {
        timestampMs: Date.parse("2025-11-01T00:00:00.000Z"),
        open: 120,
        high: 120,
        low: 120,
        close: 120,
        volume: 20
      },
      {
        timestampMs: Date.parse("2025-12-15T00:00:00.000Z"),
        open: 180,
        high: 180,
        low: 180,
        close: 180,
        volume: 30
      }
    ];

    const result = computeQuarterWindowVwap(bars, {
      reportPeriod: "2025-12-31"
    });

    expect(result.sampledBars).toBe(2);
    expect(result.vwap).toBeCloseTo(156, 6);
    expect(result.windowEndDate).toBe("2025-12-31");
  });
});
