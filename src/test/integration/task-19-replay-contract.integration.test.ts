import { describe, expect, it } from "vitest";

import { InMemoryFilingDbClient, FilingRepository } from "@/lib/db/filings";
import { InMemoryRunLedgerDbClient, RunLedgerRepository } from "@/lib/db/runs";
import { enrichHoldingsWithYahooDailyPrices } from "@/lib/enrichment/yahoo-price-enrichment";
import { fetchAndStoreFilingByAccession } from "@/lib/ingest/filings";
import { parseInformationTableXml } from "@/lib/ingest/parser/information-table";
import {
  createSecFilingClient,
  createYahooChartClient,
  parserFixture
} from "@/test/integration/helpers/pipeline-fixtures";

describe("task-19 replay/idempotency integration", () => {
  it("keeps deterministic output and no duplicate side effects on repeated accession replay", async () => {
    const filingDb = new InMemoryFilingDbClient();
    const runLedgerDb = new InMemoryRunLedgerDbClient();
    const filingRepository = new FilingRepository(filingDb);
    const runLedgerRepository = new RunLedgerRepository(runLedgerDb);

    const secClient = createSecFilingClient([
      {
        accessionNumber: "0001067983-26-000201",
        form: "13F-HR",
        filingDate: "2026-02-14",
        reportDate: "2025-12-31",
        primaryDocument: "13f-hr.xml"
      }
    ]);
    const yahooClient = createYahooChartClient();

    const firstRun = await fetchAndStoreFilingByAccession(secClient, filingRepository, runLedgerRepository, {
      institutionCik: "1067983",
      accessionNumber: "0001067983-26-000201",
      runIdFactory: () => "task-19-first",
      now: () => new Date("2026-02-22T10:00:00.000Z")
    });

    const firstArtifact = filingDb.list()[0];
    const firstParsed = parseInformationTableXml(firstArtifact!, parserFixture("13f-hr.xml"));
    const firstEnrichment = await enrichHoldingsWithYahooDailyPrices(yahooClient, firstParsed.holdings, {
      reportPeriod: firstParsed.reportPeriod,
      asOf: new Date("2026-01-02T00:00:00.000Z"),
      staleThresholdDays: 5
    });

    const secondRun = await fetchAndStoreFilingByAccession(secClient, filingRepository, runLedgerRepository, {
      institutionCik: "1067983",
      accessionNumber: "0001067983-26-000201",
      runIdFactory: () => "task-19-second",
      now: () => new Date("2026-02-22T10:05:00.000Z")
    });

    const secondArtifact = filingDb.list()[0];
    const secondParsed = parseInformationTableXml(secondArtifact!, parserFixture("13f-hr.xml"));
    const secondEnrichment = await enrichHoldingsWithYahooDailyPrices(yahooClient, secondParsed.holdings, {
      reportPeriod: secondParsed.reportPeriod,
      asOf: new Date("2026-01-02T00:00:00.000Z"),
      staleThresholdDays: 5
    });

    expect(filingDb.list()).toHaveLength(1);
    expect(firstRun.runStatus).toBe("succeeded");
    expect(secondRun.runStatus).toBe("replayed");
    expect(firstRun.requestSignature).toBe(secondRun.requestSignature);
    expect(secondRun.rowCounts.filingsInserted).toBe(0);
    expect(secondRun.warnings[0]).toContain("replay completed without duplicate filing row");

    expect(secondParsed).toEqual(firstParsed);
    expect(secondEnrichment).toEqual(firstEnrichment);

    const ledgerRows = runLedgerDb.list();
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows[0]?.runStatus).toBe("succeeded");
    expect(ledgerRows[1]?.runStatus).toBe("replayed");
    expect(ledgerRows[0]?.requestSignature).toBe(ledgerRows[1]?.requestSignature);
    expect(ledgerRows[1]?.targetAccessionNumber).toBe("0001067983-26-000201");
  });
});
