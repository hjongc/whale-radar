import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ManualOpsRunContext, OpsTarget, OpsTriggerResponse } from "@/lib/ops/types";

export interface OpsTriggerDependencies {
  now?: () => Date;
  runIdFactory?: () => string;
  execute?: (context: ManualOpsRunContext) => Promise<OpsTriggerResponse["status"]>;
  evaluateQualityGates?: () => Promise<Record<string, number>>;
  runScript?: (scriptRelativePath: string, args: string[]) => Promise<void>;
}

const execFileAsync = promisify(execFile);

async function runNodeScript(scriptRelativePath: string, args: string[] = []) {
  const scriptPath = resolve(process.cwd(), scriptRelativePath);
  if (!existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptRelativePath}`);
  }

  const extension = extname(scriptPath).toLowerCase();
  const executable = extension === ".py" ? process.env.PYTHON_BIN ?? "python3" : process.execPath;

  await execFileAsync(executable, [scriptPath, ...args], {
    env: process.env,
    timeout: 30 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024
  });
}

async function runShellCommand(command: string): Promise<string> {
  const { stdout } = await execFileAsync("sh", ["-lc", command], {
    env: process.env,
    timeout: 2 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024
  });

  return String(stdout ?? "").trim();
}

function parseQualityMetrics(raw: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  if (!raw) {
    return metrics;
  }

  for (const line of raw.split(/\r?\n/)) {
    const [metric = "", value = ""] = line.split("\t");
    if (!metric) {
      continue;
    }

    const parsedValue = Number(value);
    if (Number.isFinite(parsedValue)) {
      metrics[metric] = parsedValue;
    }
  }

  return metrics;
}

async function evaluateQualityGatesFromLocalDb(): Promise<Record<string, number>> {
  const raw = await runShellCommand(
    "docker exec -i \"supabase_db_whaleinsight-pro-mvp\" psql -U \"postgres\" -d \"postgres\" -At -F $'\\t' < \"scripts/sql/quality-checks.sql\""
  );

  return parseQualityMetrics(raw);
}

async function executeEnrichmentPipeline(
  context: ManualOpsRunContext,
  deps: OpsTriggerDependencies
): Promise<OpsTriggerResponse["status"]> {
  const warnings: string[] = [];
  let scriptsExecuted = 0;
  let qualityChecksEvaluated = 0;
  let qualityMetrics: Record<string, number> = {};

  const scriptArgs = context.flags.dryRun ? ["--dry-run"] : [];
  const runScript = deps.runScript ?? runNodeScript;

  try {
    await runScript("scripts/enrich-cusip-ticker.mjs", scriptArgs);
    scriptsExecuted += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`CUSIP ticker enrichment failed: ${message}`);
  }

  try {
    await runScript("scripts/refresh-identity-and-sectors-yahoo.py", scriptArgs);
    scriptsExecuted += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Yahoo ticker refresh failed: ${message}`);
  }

  try {
    await runScript("scripts/auto-map-ticker-sectors.py", scriptArgs);
    scriptsExecuted += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Sector mapping refresh failed: ${message}`);
  }

  try {
    const evaluator = deps.evaluateQualityGates ?? evaluateQualityGatesFromLocalDb;
    qualityMetrics = await evaluator();
    qualityChecksEvaluated = 1;

    const unknownRatio = qualityMetrics.top50_unknown_sector_ratio_pct;
    if (Number.isFinite(unknownRatio) && unknownRatio > 15) {
      warnings.push(`Unknown sector ratio gate exceeded: ${unknownRatio.toFixed(2)}% (threshold 15%).`);
    }

    const coverage = qualityMetrics.top50_sector_coverage_pct;
    if (Number.isFinite(coverage) && coverage < 80) {
      warnings.push(`Sector coverage gate missed: ${coverage.toFixed(2)}% (threshold 80%).`);
    }

    const missingIdentityVersion = qualityMetrics.identity_missing_source_version_rows;
    if (Number.isFinite(missingIdentityVersion) && missingIdentityVersion > 0) {
      warnings.push(`Identity source_version missing rows: ${missingIdentityVersion}.`);
    }

    const missingSectorVersion = qualityMetrics.sector_missing_source_version_rows;
    if (Number.isFinite(missingSectorVersion) && missingSectorVersion > 0) {
      warnings.push(`Sector source_version missing rows: ${missingSectorVersion}.`);
    }

    const staleIdentityRows = qualityMetrics.identity_stale_rows_24h;
    if (Number.isFinite(staleIdentityRows) && staleIdentityRows > 0) {
      warnings.push(`Identity freshness breach (24h): ${staleIdentityRows} active rows stale.`);
    }

    const staleSectorRows = qualityMetrics.sector_stale_rows_24h;
    if (Number.isFinite(staleSectorRows) && staleSectorRows > 0) {
      warnings.push(`Sector freshness breach (24h): ${staleSectorRows} active rows stale.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Quality gate check skipped: ${message}`);
  }

  const state = warnings.length > 0 ? "failed" : context.flags.replay ? "replayed" : "succeeded";
  const modeLabel = context.flags.dryRun ? "dry-run" : "live";

  return {
    state,
    message: `Executed ${context.target} ${modeLabel} pipeline (${context.flags.scope} scope).`,
    counts: {
      targetsQueued: 1,
      scriptsExecuted,
      qualityChecksEvaluated,
      recordsProcessed: 0,
      top50UnknownSectorRatioPct: qualityMetrics.top50_unknown_sector_ratio_pct ?? -1,
      top50TickerMissingRatePct: qualityMetrics.top50_ticker_missing_rate_pct ?? -1,
      top50SectorCoveragePct: qualityMetrics.top50_sector_coverage_pct ?? -1,
      nonPositiveHoldingRows: qualityMetrics.non_positive_holding_rows ?? -1
    },
    warnings
  };
}

async function defaultExecute(context: ManualOpsRunContext): Promise<OpsTriggerResponse["status"]> {
  const modeLabel = context.flags.dryRun ? "dry-run" : "live";

  return {
    state: context.flags.replay ? "replayed" : "queued",
    message: `Accepted ${context.target} ${modeLabel} trigger (${context.flags.scope} scope).`,
    counts: {
      targetsQueued: 1,
      recordsProcessed: 0
    },
    warnings: context.flags.priorityOnly
      ? []
      : ["priority-only guard disabled explicitly; monitor processing limits before running full workloads."]
  };
}

export async function triggerManualOpsRun(
  target: OpsTarget,
  flags: ManualOpsRunContext["flags"],
  deps: OpsTriggerDependencies = {}
): Promise<OpsTriggerResponse> {
  const now = deps.now ?? (() => new Date());
  const runIdFactory = deps.runIdFactory ?? randomUUID;

  const context: ManualOpsRunContext = {
    runId: runIdFactory(),
    target,
    requestedAt: now().toISOString(),
    flags
  };

  const status = deps.execute
    ? await deps.execute(context)
    : context.target === "enrichment"
      ? await executeEnrichmentPipeline(context, deps)
      : await defaultExecute(context);

  return {
    runId: context.runId,
    target: context.target,
    requestedAt: context.requestedAt,
    flags: context.flags,
    status
  };
}
