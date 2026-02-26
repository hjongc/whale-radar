import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseFilingArtifact } from "@/lib/domain/validation";
import { parseInformationTableXml } from "@/lib/ingest/parser/information-table";
import { buildSupersessionSnapshot } from "@/lib/ingest/supersession";

const FIXTURE_DIR = join(process.cwd(), "src/lib/ingest/parser/fixtures");

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf-8");
}

describe("13F amendment supersession", () => {
  it("deterministically supersedes 13F-HR with 13F-HR/A while preserving lineage", () => {
    const hr = parseFilingArtifact({
      accessionNumber: "0001067983-26-000201",
      institutionCik: "0001067983",
      filingFormType: "13F-HR",
      filingDate: "2026-02-14",
      reportPeriod: "2025-12-31",
      isAmendment: false,
      isNotice: false,
      rawPayload: {}
    });
    const hra = parseFilingArtifact({
      accessionNumber: "0001067983-26-000202",
      institutionCik: "0001067983",
      filingFormType: "13F-HR/A",
      filingDate: "2026-02-15",
      reportPeriod: "2025-12-31",
      isAmendment: true,
      isNotice: false,
      amendsAccessionNumber: "0001067983-26-000201",
      rawPayload: {}
    });

    const snapshot = buildSupersessionSnapshot([
      parseInformationTableXml(hr, fixture("13f-hr.xml")),
      parseInformationTableXml(hra, fixture("13f-hr-a.xml"))
    ]);

    const key = "0001067983:2025-12-31";
    expect(snapshot.activeFilingByPeriod[key]).toBe("0001067983-26-000202");
    expect(snapshot.activeHoldingsByPeriod[key]).toHaveLength(2);
    expect(snapshot.activeHoldingsByPeriod[key]?.[0]?.ticker).toBe("AAPL");
    expect(snapshot.activeHoldingsByPeriod[key]?.[1]?.ticker).toBe("AMZN");

    const original = snapshot.lineage.find((entry) => entry.accessionNumber === "0001067983-26-000201");
    const amendment = snapshot.lineage.find((entry) => entry.accessionNumber === "0001067983-26-000202");

    expect(original?.isActive).toBe(false);
    expect(original?.supersededByAccessionNumber).toBe("0001067983-26-000202");
    expect(amendment?.isActive).toBe(true);
    expect(amendment?.supersedesAccessionNumber).toBe("0001067983-26-000201");
    expect(amendment?.rootAccessionNumber).toBe("0001067983-26-000201");
  });

  it("represents 13F-NT and 13F-NT/A as notice-only with zero active holdings", () => {
    const nt = parseFilingArtifact({
      accessionNumber: "0001067983-26-000301",
      institutionCik: "0001067983",
      filingFormType: "13F-NT",
      filingDate: "2026-02-14",
      reportPeriod: "2025-12-31",
      isAmendment: false,
      isNotice: true,
      rawPayload: {}
    });
    const nta = parseFilingArtifact({
      accessionNumber: "0001067983-26-000302",
      institutionCik: "0001067983",
      filingFormType: "13F-NT/A",
      filingDate: "2026-02-15",
      reportPeriod: "2025-12-31",
      isAmendment: true,
      isNotice: true,
      amendsAccessionNumber: "0001067983-26-000301",
      rawPayload: {}
    });

    const snapshot = buildSupersessionSnapshot([
      parseInformationTableXml(nt, fixture("13f-nt.xml")),
      parseInformationTableXml(nta, fixture("13f-nt.xml"))
    ]);

    const key = "0001067983:2025-12-31";
    expect(snapshot.activeFilingByPeriod[key]).toBe("0001067983-26-000302");
    expect(snapshot.activeHoldingsByPeriod[key]).toEqual([]);
    expect(snapshot.lineage).toHaveLength(2);
    expect(snapshot.lineage.every((entry) => entry.status === "notice_only")).toBe(true);
  });
});
