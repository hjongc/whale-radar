import { describe, expect, it } from "vitest";

import type { NormalizedHoldingRecord } from "@/lib/ingest/parser/information-table";
import { enrichHoldingsWithYahooDailyPrices } from "@/lib/enrichment/yahoo-price-enrichment";

function chartResponseFor(symbol: string, data: Array<{ t: string; close: number; volume: number }>) {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol
          },
          timestamp: data.map((entry) => Math.floor(Date.parse(`${entry.t}T00:00:00.000Z`) / 1000)),
          indicators: {
            quote: [
              {
                open: data.map((entry) => entry.close),
                high: data.map((entry) => entry.close),
                low: data.map((entry) => entry.close),
                close: data.map((entry) => entry.close),
                volume: data.map((entry) => entry.volume)
              }
            ]
          }
        }
      ],
      error: null
    }
  };
}

describe("enrichHoldingsWithYahooDailyPrices", () => {
  it("computes cost-basis VWAP and current gap with provenance metadata", async () => {
    const holdings: NormalizedHoldingRecord[] = [
      {
        rowNumber: 1,
        issuerName: "Apple",
        classTitle: "COM",
        cusip: "037833100",
        ticker: "AAPL",
        valueUsdThousands: 250_000,
        shares: 1_000,
        action: "KEEP",
        type: "KEEP"
      }
    ];

    const client = {
      getPriceChart: async (symbol: string) =>
        chartResponseFor(symbol, [
          { t: "2025-11-01", close: 100, volume: 10 },
          { t: "2025-12-15", close: 200, volume: 20 },
          { t: "2025-12-30", close: 180, volume: 30 }
        ])
    };

    const result = await enrichHoldingsWithYahooDailyPrices(client, holdings, {
      reportPeriod: "2025-12-31",
      asOf: new Date("2026-01-02T00:00:00.000Z"),
      staleThresholdDays: 5
    });

    expect(result.warnings).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      ticker: "AAPL",
      weight: "100.00%",
      cost: 173.3333,
      price: 180,
      gap: "+3.85%",
      source: "yahoo",
      calc_version: "vwap-quarter-v1",
      stale_badge: "fresh"
    });
    expect(result.rows[0]?.price_timestamp).toContain("2025-12-30");
  });

  it("emits stale metadata when latest close exceeds stale threshold", async () => {
    const holdings: NormalizedHoldingRecord[] = [
      {
        rowNumber: 1,
        issuerName: "Microsoft",
        classTitle: "COM",
        cusip: "594918104",
        ticker: "MSFT",
        valueUsdThousands: 100_000,
        shares: 500,
        action: "KEEP",
        type: "KEEP"
      }
    ];

    const client = {
      getPriceChart: async (symbol: string) =>
        chartResponseFor(symbol, [
          { t: "2025-10-15", close: 300, volume: 10 },
          { t: "2025-11-15", close: 310, volume: 10 },
          { t: "2025-12-01", close: 305, volume: 10 }
        ])
    };

    const result = await enrichHoldingsWithYahooDailyPrices(client, holdings, {
      reportPeriod: "2025-12-31",
      asOf: new Date("2026-01-12T00:00:00.000Z"),
      staleThresholdDays: 5
    });

    expect(result.rows[0]?.stale_badge).toBe("stale");
    expect(result.rows[0]?.stale_reason).toBe("latest_close_older_than_5_days");
  });
});
