import { DomainValidationError } from "@/lib/domain/validation";
import { OPS_SCOPES, type OpsRunFlags, type OpsScope } from "@/lib/ops/types";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function parseBooleanParam(rawValue: string | null, paramName: string, fallback: boolean): boolean {
  if (rawValue === null) {
    return fallback;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new DomainValidationError(
    `Query param "${paramName}" must be one of: ${[...TRUE_VALUES, ...FALSE_VALUES].join(", ")}.`
  );
}

function parseScope(rawValue: string | null): OpsScope {
  if (rawValue === null || rawValue.trim() === "") {
    return "priority";
  }

  const normalized = rawValue.trim().toLowerCase();
  if (!OPS_SCOPES.includes(normalized as OpsScope)) {
    throw new DomainValidationError(`Query param "scope" must be one of: ${OPS_SCOPES.join(", ")}.`);
  }

  return normalized as OpsScope;
}

function parseMode(rawValue: string | null, replayFlag: boolean): OpsRunFlags["mode"] {
  if (rawValue === null || rawValue.trim() === "") {
    return replayFlag ? "replay" : "manual";
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized !== "manual" && normalized !== "replay") {
    throw new DomainValidationError('Query param "mode" must be either "manual" or "replay".');
  }

  return normalized;
}

export function parseOpsRunFlags(searchParams: URLSearchParams): OpsRunFlags {
  const dryRun = parseBooleanParam(searchParams.get("dry-run"), "dry-run", false);
  const replay = parseBooleanParam(searchParams.get("replay"), "replay", false);
  const priorityOnly = parseBooleanParam(searchParams.get("priority-only"), "priority-only", true);
  const scope = parseScope(searchParams.get("scope"));
  const mode = parseMode(searchParams.get("mode"), replay);

  if (scope === "targeted" && priorityOnly) {
    throw new DomainValidationError('Query params "scope=targeted" and "priority-only=true" cannot be combined.');
  }

  return {
    mode,
    dryRun,
    replay,
    priorityOnly,
    scope
  };
}
