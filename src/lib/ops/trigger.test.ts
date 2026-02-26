import { describe, expect, it, vi } from "vitest";

import { triggerManualOpsRun } from "@/lib/ops/trigger";

describe("triggerManualOpsRun", () => {
  it("returns queued status for non-enrichment target", async () => {
    const response = await triggerManualOpsRun(
      "ingest",
      {
        mode: "manual",
        dryRun: true,
        replay: false,
        priorityOnly: true,
        scope: "priority"
      },
      {
        runIdFactory: () => "run-ingest-1",
        now: () => new Date("2026-02-24T00:00:00.000Z")
      }
    );

    expect(response.status.state).toBe("queued");
    expect(response.status.counts.targetsQueued).toBe(1);
  });

  it("includes quality-gate counts and warning on unknown ratio breach", async () => {
    const runScript = vi.fn(async () => undefined);

    const response = await triggerManualOpsRun(
      "enrichment",
      {
        mode: "manual",
        dryRun: true,
        replay: false,
        priorityOnly: true,
        scope: "priority"
      },
      {
        runIdFactory: () => "run-enrichment-1",
        now: () => new Date("2026-02-24T00:00:00.000Z"),
        runScript,
        evaluateQualityGates: async () => ({
          top50_unknown_sector_ratio_pct: 31.25,
          top50_ticker_missing_rate_pct: 44.8,
          top50_sector_coverage_pct: 68.2,
          non_positive_holding_rows: 3
        })
      }
    );

    expect(runScript).toHaveBeenCalledTimes(3);
    expect(response.status.counts.scriptsExecuted).toBe(3);
    expect(response.status.counts.qualityChecksEvaluated).toBe(1);
    expect(response.status.counts.top50UnknownSectorRatioPct).toBe(31.25);
    expect(response.status.warnings.some((warning) => warning.includes("Unknown sector ratio gate exceeded"))).toBe(true);
    expect(response.status.state).toBe("failed");
  });
});
