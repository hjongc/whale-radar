import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseFilingArtifact } from "@/lib/domain/validation";
import { FilingParserError } from "@/lib/ingest/parser/errors";
import { parseInformationTableXml } from "@/lib/ingest/parser/information-table";

const FIXTURE_DIR = join(process.cwd(), "src/lib/ingest/parser/fixtures");

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf-8");
}

describe("13F information table parser", () => {
  it("parses 13F-HR information table XML into normalized holdings", () => {
    const filing = parseFilingArtifact({
      accessionNumber: "0001067983-26-000101",
      institutionCik: "0001067983",
      filingFormType: "13F-HR",
      filingDate: "2026-02-20",
      reportPeriod: "2025-12-31",
      isAmendment: false,
      isNotice: false,
      rawPayload: {}
    });

    const parsed = parseInformationTableXml(filing, fixture("13f-hr.xml"));

    expect(parsed.status).toBe("holdings");
    expect(parsed.holdings).toHaveLength(2);
    expect(parsed.holdings[0]).toMatchObject({
      ticker: "AAPL",
      type: "KEEP",
      valueUsdThousands: 120000,
      shares: 650000
    });
  });

  it("returns notice-only state with zero holdings for 13F-NT forms", () => {
    const filing = parseFilingArtifact({
      accessionNumber: "0001067983-26-000102",
      institutionCik: "0001067983",
      filingFormType: "13F-NT",
      filingDate: "2026-02-20",
      reportPeriod: "2025-12-31",
      isAmendment: false,
      isNotice: true,
      rawPayload: {}
    });

    const parsed = parseInformationTableXml(filing, fixture("13f-nt.xml"));

    expect(parsed.status).toBe("notice_only");
    expect(parsed.holdings).toEqual([]);
  });

  it("fails with typed diagnostics on malformed XML", () => {
    const filing = parseFilingArtifact({
      accessionNumber: "0001067983-26-000103",
      institutionCik: "0001067983",
      filingFormType: "13F-HR",
      filingDate: "2026-02-20",
      reportPeriod: "2025-12-31",
      isAmendment: false,
      isNotice: false,
      rawPayload: {}
    });

    expect(() =>
      parseInformationTableXml(
        filing,
        "<informationTable><infoTable><nameOfIssuer>APPLE</nameOfIssuer></informationTable>"
      )
    ).toThrowError(FilingParserError);

    try {
      parseInformationTableXml(
        filing,
        "<informationTable><infoTable><nameOfIssuer>APPLE</nameOfIssuer></informationTable>"
      );
    } catch (error) {
      expect(error).toBeInstanceOf(FilingParserError);
      const parserError = error as FilingParserError;
      expect(parserError.diagnostic.code).toBe("invalid_xml");
    }
  });

  it("fails with typed diagnostics when required row nodes are missing", () => {
    const filing = parseFilingArtifact({
      accessionNumber: "0001067983-26-000104",
      institutionCik: "0001067983",
      filingFormType: "13F-HR",
      filingDate: "2026-02-20",
      reportPeriod: "2025-12-31",
      isAmendment: false,
      isNotice: false,
      rawPayload: {}
    });

    expect(() =>
      parseInformationTableXml(
        filing,
        "<informationTable><infoTable><nameOfIssuer>APPLE</nameOfIssuer><value>100</value><shrsOrPrnAmt><sshPrnamt>10</sshPrnamt></shrsOrPrnAmt></infoTable></informationTable>"
      )
    ).toThrowError(FilingParserError);

    try {
      parseInformationTableXml(
        filing,
        "<informationTable><infoTable><nameOfIssuer>APPLE</nameOfIssuer><value>100</value><shrsOrPrnAmt><sshPrnamt>10</sshPrnamt></shrsOrPrnAmt></infoTable></informationTable>"
      );
    } catch (error) {
      expect(error).toBeInstanceOf(FilingParserError);
      const parserError = error as FilingParserError;
      expect(parserError.diagnostic.code).toBe("missing_required_node");
      expect(parserError.diagnostic.nodeName).toBe("cusip");
    }
  });
});
