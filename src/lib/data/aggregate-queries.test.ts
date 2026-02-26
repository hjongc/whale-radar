import { describe, expect, it } from "vitest";

import { queryMarketHubAggregates, queryWhaleInsiderAggregates, queryWhaleManagerDirectory } from "@/lib/data";
import { seedAggregateSource } from "@/lib/data/mock-source";

describe("aggregate query layer", () => {
  it("returns market hub DTO keys used by chart/card consumers", async () => {
    const dto = await queryMarketHubAggregates(seedAggregateSource);

    expect(dto).toHaveProperty("mostOwned");
    expect(dto).toHaveProperty("hotSectorMovement");
    expect(dto).toHaveProperty("highestMarginOfSafety");
    expect(dto).toHaveProperty("sectorRotation");
    expect(dto).toHaveProperty("sectorConcentration");
    expect(dto).toHaveProperty("cashTrend");

    expect(dto.mostOwned.length).toBeGreaterThan(0);
    expect(dto.sectorRotation.flows.length).toBeGreaterThan(0);
    expect(dto.sectorConcentration.length).toBeGreaterThan(0);
    expect(dto.cashTrend.series.length).toBeGreaterThan(0);
    expect(dto.highestMarginOfSafety).toMatchObject({
      accession: expect.any(String),
      priceTimestamp: expect.any(String),
      calcVersion: expect.any(String),
      source: expect.any(String),
      freshness: expect.stringMatching(/fresh|stale/)
    });
  });

  it("returns whale DTO with gap ranking, action mix, and paginated table rows", async () => {
    const dto = await queryWhaleInsiderAggregates({
      managerId: "berkshire",
      page: 1,
      pageSize: 3,
      action: "ALL"
    }, seedAggregateSource);

    expect(dto.gapRanking.length).toBeGreaterThan(0);
    expect(dto.actionMix.length).toBe(4);
    expect(dto.holdingsTable.rows).toHaveLength(3);

    expect(dto.holdingsTable.rows[0]).toMatchObject({
      accession: expect.any(String),
      ticker: expect.any(String),
      type: expect.any(String),
      weight: expect.stringMatching(/%$/),
      cost: expect.any(Number),
      price: expect.any(Number),
      gap: expect.stringMatching(/%$/),
      priceTimestamp: expect.any(String),
      source: "yahoo",
      calcVersion: "vwap-quarter-v1",
      freshness: expect.stringMatching(/fresh|stale/)
    });

    expect(dto.gapRanking[0]).toMatchObject({
      accession: expect.any(String),
      priceTimestamp: expect.any(String),
      calcVersion: expect.any(String),
      source: expect.any(String),
      freshness: expect.stringMatching(/fresh|stale/)
    });
  });

  it("applies action and search filters before pagination", async () => {
    const dto = await queryWhaleInsiderAggregates({
      managerId: "berkshire",
      page: 1,
      pageSize: 10,
      action: "NEW",
      search: "PayPal"
    }, seedAggregateSource);

    expect(dto.holdingsTable.totalRows).toBe(1);
    expect(dto.holdingsTable.rows).toHaveLength(1);
    expect(dto.holdingsTable.rows[0]?.ticker).toBe("PYPL");
    expect(dto.holdingsTable.filters.action).toBe("NEW");
    expect(dto.holdingsTable.filters.search).toBe("PayPal");
  });

  it("keeps Top-50 universe size consistent across directory and market endpoints", async () => {
    const [directory, market] = await Promise.all([
      queryWhaleManagerDirectory(seedAggregateSource),
      queryMarketHubAggregates(seedAggregateSource)
    ]);

    expect(directory).toHaveLength(50);
    expect(market.trackedInstitutions).toBe(50);

    expect(directory[0]?.rank).toBe(1);
    expect(directory[49]?.rank).toBe(50);
    expect(new Set(directory.map((entry) => entry.managerId)).size).toBe(50);
  });

  it("returns N/A-ready fields when gap basis is unknown", async () => {
    const customSource = {
      ...seedAggregateSource,
      whales: [
        {
          managerId: "unknown-gap",
          managerName: "Unknown Gap Manager",
          institutionName: "Unknown Gap Manager LLC",
          representativeManager: "Unknown Gap Manager",
          reportPeriod: "2026-Q1",
          holdings: [
            {
              accession: "unknown-gap-2026q1",
              ticker: "AAPL",
              issuerName: "Apple Inc.",
              type: "NEW" as const,
              valueUsdThousands: 1000,
              shares: 10,
              weightPct: 100,
              cost: null,
              price: 100,
              gapPct: null,
              gapKnown: false,
              gap_reason: "no_previous_cost_basis",
              price_timestamp: "2026-02-17T00:00:00.000Z",
              source: "yahoo" as const,
              calc_version: "seed-top50-v1",
              stale_badge: "fresh" as const
            }
          ]
        }
      ]
    };

    const dto = await queryWhaleInsiderAggregates(
      {
        managerId: "unknown-gap",
        page: 1,
        pageSize: 10,
        action: "ALL"
      },
      customSource
    );

    expect(dto.holdingsTable.rows[0]).toMatchObject({
      ticker: "AAPL",
      cost: null,
      gap: null,
      gapReason: "no_previous_cost_basis"
    });
    expect(dto.gapRanking).toHaveLength(0);
  });
});
