import { describe, expect, it } from "vitest";

import { InMemoryFilingDbClient, FilingRepository } from "@/lib/db/filings";
import { InMemoryInstitutionDbClient, InstitutionRepository } from "@/lib/db/institutions";
import { InMemoryRunLedgerDbClient, RunLedgerRepository } from "@/lib/db/runs";
import { queryMarketHubAggregates, queryWhaleInsiderAggregates } from "@/lib/data/aggregate-queries";
import { createMarketAggregatesRouteHandler, createWhaleAggregatesRouteHandler } from "@/lib/data/aggregate-route-handlers";
import { enrichHoldingsWithYahooDailyPrices } from "@/lib/enrichment/yahoo-price-enrichment";
import { fetchAndStoreFilingByAccession } from "@/lib/ingest/filings";
import { parseInformationTableXml } from "@/lib/ingest/parser/information-table";
import { discoverAndIngestInstitutionUniverse } from "@/lib/ingest/universe";
import { createOpsRouteHandler } from "@/lib/ops/route";
import {
  buildAggregateSourceFromEnrichedRows,
  createSecFilingClient,
  createSecUniverseClient,
  createYahooChartClient,
  parserFixture
} from "@/test/integration/helpers/pipeline-fixtures";

describe("task-19 pipeline integration contracts", () => {
  it("covers discovery -> filing fetch -> parse -> enrichment -> aggregate endpoint contracts", async () => {
    const institutionDb = new InMemoryInstitutionDbClient();
    const filingDb = new InMemoryFilingDbClient();
    const runLedgerDb = new InMemoryRunLedgerDbClient();
    const institutionRepository = new InstitutionRepository(institutionDb);
    const filingRepository = new FilingRepository(filingDb);
    const runLedgerRepository = new RunLedgerRepository(runLedgerDb);

    const discoveryResult = await discoverAndIngestInstitutionUniverse(
      createSecUniverseClient(),
      institutionRepository,
      {
        priorityCohortPercentile: 20
      }
    );

    expect(discoveryResult).toMatchObject({
      discoveredCount: 1,
      upsertedCount: 1,
      totalKnownInstitutions: 1
    });
    expect(institutionDb.list()[0]?.cik).toBe("0001067983");

    const filingResult = await fetchAndStoreFilingByAccession(
      createSecFilingClient([
        {
          accessionNumber: "0001067983-26-000202",
          form: "13F-HR/A",
          filingDate: "2026-02-15",
          reportDate: "2025-12-31",
          primaryDocument: "13f-hr-a.xml"
        }
      ]),
      filingRepository,
      runLedgerRepository,
      {
        institutionCik: "1067983",
        accessionNumber: "0001067983-26-000202",
        runIdFactory: () => "task-19-pipeline-run",
        now: () => new Date("2026-02-22T00:00:00.000Z")
      }
    );

    expect(filingResult.runStatus).toBe("succeeded");
    expect(filingResult.rowCounts.filingsInserted).toBe(1);

    const filingArtifact = filingDb.list()[0];
    expect(filingArtifact?.accessionNumber).toBe("0001067983-26-000202");

    const parsedFiling = parseInformationTableXml(filingArtifact!, parserFixture("13f-hr-a.xml"));
    expect(parsedFiling.status).toBe("holdings");
    expect(parsedFiling.holdings).toHaveLength(2);

    const enrichmentResult = await enrichHoldingsWithYahooDailyPrices(
      createYahooChartClient(),
      parsedFiling.holdings,
      {
        reportPeriod: parsedFiling.reportPeriod,
        asOf: new Date("2026-01-02T00:00:00.000Z"),
        staleThresholdDays: 5
      }
    );

    expect(enrichmentResult.warnings).toEqual([]);
    expect(enrichmentResult.rows[0]).toMatchObject({
      ticker: expect.any(String),
      cost: expect.any(Number),
      price: expect.any(Number),
      gap: expect.stringMatching(/%$/),
      price_timestamp: expect.any(String),
      source: "yahoo",
      calc_version: "vwap-quarter-v1"
    });

    const aggregateSource = buildAggregateSourceFromEnrichedRows(enrichmentResult.rows, {
      managerId: "integration-whale",
      managerName: "Integration Whale",
      accession: parsedFiling.accessionNumber,
      reportPeriod: "2025-Q4"
    });

    const whaleRoute = createWhaleAggregatesRouteHandler({
      getAggregates: async (query) => queryWhaleInsiderAggregates(query, aggregateSource)
    });
    const whaleResponse = await whaleRoute(
      new Request("http://localhost:3000/api/aggregates/whales/integration-whale?page=1&pageSize=10"),
      { params: { managerId: "integration-whale" } }
    );
    const whalePayload = await whaleResponse.json();

    expect(whaleResponse.status).toBe(200);
    expect(whalePayload.holdingsTable.rows).toHaveLength(2);
    expect(whalePayload.holdingsTable.rows[0]).toMatchObject({
      accession: "0001067983-26-000202",
      ticker: expect.any(String),
      type: expect.stringMatching(/NEW|ADD|REDUCE|KEEP/),
      weight: expect.stringMatching(/%$/),
      cost: expect.any(Number),
      price: expect.any(Number),
      gap: expect.stringMatching(/^[+-]?\d+\.\d+%$/),
      priceTimestamp: expect.any(String),
      source: "yahoo",
      calcVersion: "vwap-quarter-v1",
      freshness: expect.stringMatching(/fresh|stale/)
    });

    const marketRoute = createMarketAggregatesRouteHandler({
      getAggregates: async () => queryMarketHubAggregates(aggregateSource)
    });
    const marketResponse = await marketRoute();
    const marketPayload = await marketResponse.json();

    expect(marketResponse.status).toBe(200);
    expect(marketPayload).toMatchObject({
      mostOwned: expect.any(Array),
      hotSectorMovement: expect.any(Object),
      highestMarginOfSafety: {
        accession: "0001067983-26-000202",
        priceTimestamp: expect.any(String),
        calcVersion: "vwap-quarter-v1",
        source: "yahoo",
        freshness: expect.stringMatching(/fresh|stale/)
      },
      sectorRotation: expect.any(Object),
      cashTrend: expect.any(Object)
    });
  });

  it("returns expected unauthorized manual trigger contract", async () => {
    const handler = createOpsRouteHandler({
      target: "ingest",
      cronSecret: "task-19-secret"
    });

    const response = await handler(
      new Request("http://localhost:3000/api/ops/ingest?mode=manual&scope=priority&replay=true")
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      error: {
        code: "unauthorized",
        message: "Unauthorized ops trigger request."
      }
    });
  });
});
