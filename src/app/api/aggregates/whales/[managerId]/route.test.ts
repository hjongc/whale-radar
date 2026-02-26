import { describe, expect, it } from "vitest";

import { createWhaleAggregatesRouteHandler } from "@/lib/data/aggregate-route-handlers";
import { queryWhaleInsiderAggregates } from "@/lib/data/aggregate-queries";
import { seedAggregateSource } from "@/lib/data/mock-source";

const GET = createWhaleAggregatesRouteHandler({
  getAggregates: async (query) => queryWhaleInsiderAggregates(query, seedAggregateSource)
});

describe("GET /api/aggregates/whales/[managerId]", () => {
  it("returns lineage metadata for each holdings row", async () => {
    const request = new Request("http://localhost:3000/api/aggregates/whales/berkshire?page=1&pageSize=2");
    const response = await GET(request, { params: { managerId: "berkshire" } });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.holdingsTable.rows[0]).toMatchObject({
      accession: expect.any(String),
      priceTimestamp: expect.any(String),
      calcVersion: expect.any(String),
      source: expect.any(String),
      freshness: expect.stringMatching(/fresh|stale/)
    });
  });

  it("rejects unsupported action filter with typed 400 payload", async () => {
    const request = new Request("http://localhost:3000/api/aggregates/whales/berkshire?action=HOLD_MORE");
    const response = await GET(request, { params: { managerId: "berkshire" } });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      error: {
        code: "invalid_query_params",
        message: expect.any(String)
      }
    });
    expect(payload.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "action",
          reason: "unsupported_filter",
          received: "HOLD_MORE"
        })
      ])
    );
  });
});
