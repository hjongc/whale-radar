import { describe, expect, it } from "vitest";

import { InMemoryInstitutionDbClient, InstitutionRepository } from "@/lib/db/institutions";
import { DomainValidationError, normalizeCik } from "@/lib/domain/validation";
import {
  discoverAndIngestInstitutionUniverse,
  ingestInstitutionUniverse,
  isPriorityCohortCik
} from "@/lib/ingest/universe";

describe("institution universe discovery ingestion", () => {
  it("normalizes CIK values to canonical padded 10-digit keys", async () => {
    const db = new InMemoryInstitutionDbClient();
    const repository = new InstitutionRepository(db);

    await ingestInstitutionUniverse(
      {
        "0": {
          cik_str: 320193,
          title: "Apple Inc.",
          ticker: "aapl",
          forms: ["13F-HR", "13F-HR/A"]
        }
      },
      repository
    );

    const rows = db.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cik).toBe("0000320193");
    expect(rows[0]?.ticker).toBe("AAPL");
    expect(rows[0]?.filingCoverage.form13fHr).toBe(true);
    expect(rows[0]?.filingCoverage.form13fNt).toBe(false);
  });

  it("uses deterministic priority cohort logic with explicit overrides", async () => {
    const db = new InMemoryInstitutionDbClient();
    const repository = new InstitutionRepository(db);

    expect(isPriorityCohortCik("0000000012", 20)).toBe(true);
    expect(isPriorityCohortCik("0000000020", 20)).toBe(false);

    await ingestInstitutionUniverse(
      [
        { cik_str: 20, title: "Threshold Fund" },
        { cik_str: 999999, title: "Override Fund" }
      ],
      repository,
      {
        priorityCikOverrides: ["0000999999"]
      }
    );

    const rows = db.list();
    expect(rows.find((row) => row.cik === "0000000020")?.isPriorityCohort).toBe(false);
    expect(rows.find((row) => row.cik === "0000999999")?.isPriorityCohort).toBe(true);
  });

  it("is idempotent across reruns and does not duplicate institutions", async () => {
    const db = new InMemoryInstitutionDbClient();
    const repository = new InstitutionRepository(db);
    const payload = {
      "0": { cik_str: 1067983, title: "Berkshire Hathaway Inc.", forms: ["13F-HR", "13F-HR/A"] },
      "1": { cik_str: "1067983", title: "Berkshire Hathaway Inc. Updated" },
      "2": { cik_str: 1166559, title: "Pershing Square Capital Management, L.P." }
    };

    const first = await ingestInstitutionUniverse(payload, repository);
    const second = await ingestInstitutionUniverse(payload, repository);

    expect(first.discoveredCount).toBe(2);
    expect(second.discoveredCount).toBe(2);
    expect(second.totalKnownInstitutions).toBe(2);
    expect(db.list()).toHaveLength(2);
    expect(db.list().find((row) => row.cik === "0001067983")?.institutionName).toContain("Updated");
  });

  it("rejects malformed CIK input instead of silently inserting invalid rows", async () => {
    const db = new InMemoryInstitutionDbClient();
    const repository = new InstitutionRepository(db);

    expect(() => normalizeCik("ABC-1067983")).toThrowError(DomainValidationError);
    await expect(
      ingestInstitutionUniverse(
        {
          "0": {
            cik_str: "ABC-1067983",
            title: "Invalid CIK Fund"
          }
        },
        repository
      )
    ).rejects.toThrowError(/cik/i);

    expect(db.list()).toHaveLength(0);
  });

  it("supports broad discovery payload ingestion via SEC provider client", async () => {
    const db = new InMemoryInstitutionDbClient();
    const repository = new InstitutionRepository(db);
    const secClient = {
      getCompanyTickers: async () => ({
        "0": { cik_str: 1067983, ticker: "BRK.B", title: "Berkshire Hathaway Inc." },
        "1": { cik_str: 1166559, ticker: "N/A", title: "Pershing Square Capital Management, L.P." }
      })
    };

    const summary = await discoverAndIngestInstitutionUniverse(secClient, repository);

    expect(summary.discoveredCount).toBe(2);
    expect(db.list()).toHaveLength(2);
  });
});
