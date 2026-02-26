import type { RunStatus } from "@/lib/domain/enums";

export const OPS_TARGETS = ["discovery", "ingest", "enrichment"] as const;

export type OpsTarget = (typeof OPS_TARGETS)[number];

export const OPS_SCOPES = ["priority", "targeted"] as const;

export type OpsScope = (typeof OPS_SCOPES)[number];

export interface OpsRunFlags {
  mode: "manual" | "replay";
  dryRun: boolean;
  replay: boolean;
  priorityOnly: boolean;
  scope: OpsScope;
}

export interface ManualOpsRunContext {
  runId: string;
  target: OpsTarget;
  requestedAt: string;
  flags: OpsRunFlags;
}

export interface OpsRunStatusSummary {
  state: Extract<RunStatus, "queued" | "running" | "succeeded" | "replayed" | "failed">;
  message: string;
  counts: Record<string, number>;
  warnings: string[];
}

export interface OpsTriggerResponse {
  runId: string;
  target: OpsTarget;
  requestedAt: string;
  flags: OpsRunFlags;
  status: OpsRunStatusSummary;
}
