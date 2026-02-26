import { describe, expect, it } from "vitest";

import { InMemoryFilingDbClient, FilingRepository } from "@/lib/db/filings";
import { InMemoryRunLedgerDbClient, RunLedgerRepository } from "@/lib/db/runs";
import { ProviderRequestError } from "@/lib/net/errors";
import { fetchAndStoreFilingByAccession } from "@/lib/ingest/filings";

describe("filing fetch ingestion", () => {
  it("is idempotent across replayed accession runs and prevents duplicate filing rows", async () => {
    const filingDb = new InMemoryFilingDbClient();
    const runLedgerDb = new InMemoryRunLedgerDbClient();
    const filingRepository = new FilingRepository(filingDb);
    const runLedgerRepository = new RunLedgerRepository(runLedgerDb);
    const secClient = {
      getSubmissions: async () => ({
        cik: "0001067983",
        filings: {
          recent: {
            accessionNumber: ["0001067983-25-000001"],
            form: ["13F-HR"],
            filingDate: ["2026-02-20"],
            reportDate: ["2025-12-31"],
            acceptanceDateTime: ["2026-02-20T13:34:00.000Z"],
            primaryDocument: ["primary_doc.xml"]
          }
        }
      }),
      getFilingIndex: async () => ({
        directory: {
          item: [{ name: "primary_doc.xml", type: "text/xml", size: 1024 }]
        }
      })
    };

    const firstRun = await fetchAndStoreFilingByAccession(secClient, filingRepository, runLedgerRepository, {
      institutionCik: "1067983",
      accessionNumber: "0001067983-25-000001",
      now: () => new Date("2026-02-21T10:00:00.000Z"),
      runIdFactory: () => "run-first"
    });

    const secondRun = await fetchAndStoreFilingByAccession(secClient, filingRepository, runLedgerRepository, {
      institutionCik: "1067983",
      accessionNumber: "0001067983-25-000001",
      now: () => new Date("2026-02-21T10:05:00.000Z"),
      runIdFactory: () => "run-second"
    });

    expect(filingDb.list()).toHaveLength(1);
    expect(firstRun.filingCreated).toBe(true);
    expect(firstRun.runStatus).toBe("succeeded");
    expect(secondRun.filingCreated).toBe(false);
    expect(secondRun.runStatus).toBe("replayed");
    expect(secondRun.requestSignature).toBe(firstRun.requestSignature);
    expect(secondRun.rowCounts.filingsInserted).toBe(0);

    const ledgerRows = runLedgerDb.list();
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows[0]?.runStatus).toBe("succeeded");
    expect(ledgerRows[1]?.runStatus).toBe("replayed");
    expect(ledgerRows[1]?.warnings[0]).toContain("replay completed without duplicate filing row");
  });

  it("logs failed run ledger rows with actionable network error payload", async () => {
    const filingDb = new InMemoryFilingDbClient();
    const runLedgerDb = new InMemoryRunLedgerDbClient();
    const filingRepository = new FilingRepository(filingDb);
    const runLedgerRepository = new RunLedgerRepository(runLedgerDb);
    const secClient = {
      getSubmissions: async () => {
        throw new ProviderRequestError({
          source: "sec",
          retries: 2,
          reason: "network_error",
          message: "Mock SEC network failure"
        });
      },
      getFilingIndex: async () => ({})
    };

    await expect(
      fetchAndStoreFilingByAccession(secClient, filingRepository, runLedgerRepository, {
        institutionCik: "1067983",
        accessionNumber: "0001067983-25-000001",
        now: () => new Date("2026-02-21T11:00:00.000Z"),
        runIdFactory: () => "run-failure"
      })
    ).rejects.toThrowError(ProviderRequestError);

    expect(filingDb.list()).toHaveLength(0);

    const ledgerRows = runLedgerDb.list();
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.runStatus).toBe("failed");
    expect(ledgerRows[0]?.rowCounts.filingsInserted).toBe(0);
    expect(ledgerRows[0]?.errorPayload).toMatchObject({
      source: "sec",
      reason: "network_error",
      retries: 2
    });
  });
});
