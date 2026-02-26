import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  parseDashboardPayload,
  parseFilingArtifact,
  parseFilingPosition,
  parseRunErrorPayload
} from "@/lib/domain/validation";

describe("domain validation contracts", () => {
  it("parses valid payload fixtures including KEEP action", () => {
    const artifact = parseFilingArtifact({
      accessionNumber: "0001067983-25-000001",
      institutionCik: "0001067983",
      filingFormType: "13F-HR",
      filingDate: "2026-02-20",
      reportPeriod: "2025-12-31",
      isAmendment: false,
      isNotice: false,
      rawPayload: { source: "sec" }
    });

    const position = parseFilingPosition({
      rowNumber: 1,
      issuerName: "Apple Inc",
      cusip: "037833100",
      ticker: "AAPL",
      valueUsdThousands: 1_234_567.89,
      shares: 12_345,
      action: "KEEP"
    });

    const dashboard = parseDashboardPayload({
      accessionNumber: "0001067983-25-000001",
      rows: [
        {
          ticker: "AAPL",
          type: "KEEP",
          weight: "42.5%",
          cost: 178.2,
          price: 185.4,
          gap: "+4.0%"
        }
      ]
    });

    const providerError = parseRunErrorPayload({
      source: "sec",
      retries: 2,
      reason: "retry_exhausted",
      message: "Request failed after retries.",
      status: 503
    });

    expect(artifact.filingFormType).toBe("13F-HR");
    expect(position.action).toBe("KEEP");
    expect(dashboard.rows[0]?.type).toBe("KEEP");
    expect(providerError.retries).toBe(2);
  });

  it("rejects malformed action labels and required field omissions", () => {
    expect(() =>
      parseDashboardPayload({
        accessionNumber: "0001067983-25-000001",
        rows: [
          {
            ticker: "AAPL",
            type: "HOLD_MORE",
            weight: "42.5%",
            cost: 178.2,
            price: 185.4,
            gap: "+4.0%"
          }
        ]
      })
    ).toThrowError(DomainValidationError);

    expect(() =>
      parseFilingArtifact({
        accessionNumber: "0001067983-25-000002",
        institutionCik: "0001067983",
        filingFormType: "13F-HR/A",
        filingDate: "2026-02-20",
        reportPeriod: "2025-12-31",
        isAmendment: true,
        isNotice: false,
        rawPayload: {}
      })
    ).toThrowError(/amendsAccessionNumber/i);
  });
});
