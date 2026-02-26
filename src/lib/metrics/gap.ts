export interface GapMetricResult {
  gapPercent: number;
  gap: string;
  provenance: {
    price_timestamp: string;
    source: string;
    calc_version: string;
  };
  freshness: {
    isStale: boolean;
    badge: "fresh" | "stale";
    staleReason?: string;
    ageDays: number;
  };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_THRESHOLD_DAYS = 5;

function assertFinitePositive(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a finite number greater than 0.`);
  }
}

function toIsoTimestamp(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${String(value)}.`);
  }

  return date.toISOString();
}

function formatGap(gapPercent: number): string {
  const prefix = gapPercent > 0 ? "+" : "";
  return `${prefix}${gapPercent.toFixed(2)}%`;
}

export function computeCurrentGapMetric(input: {
  costBasis: number;
  currentPrice: number;
  priceTimestamp: Date | string;
  source: string;
  calcVersion: string;
  asOf?: Date;
  staleThresholdDays?: number;
}): GapMetricResult {
  assertFinitePositive(input.costBasis, "costBasis");
  assertFinitePositive(input.currentPrice, "currentPrice");

  if (!input.source.trim()) {
    throw new Error("source must be a non-empty string.");
  }
  if (!input.calcVersion.trim()) {
    throw new Error("calcVersion must be a non-empty string.");
  }

  const staleThresholdDays = input.staleThresholdDays ?? DEFAULT_STALE_THRESHOLD_DAYS;
  if (!Number.isInteger(staleThresholdDays) || staleThresholdDays < 0) {
    throw new Error("staleThresholdDays must be a non-negative integer.");
  }

  const priceTimestamp = toIsoTimestamp(input.priceTimestamp);
  const asOf = input.asOf ?? new Date();
  const ageDays = Math.floor((asOf.getTime() - new Date(priceTimestamp).getTime()) / ONE_DAY_MS);
  const isStale = ageDays > staleThresholdDays;

  const gapPercent = ((input.currentPrice - input.costBasis) / input.costBasis) * 100;

  return {
    gapPercent,
    gap: formatGap(gapPercent),
    provenance: {
      price_timestamp: priceTimestamp,
      source: input.source,
      calc_version: input.calcVersion
    },
    freshness: {
      isStale,
      badge: isStale ? "stale" : "fresh",
      staleReason: isStale
        ? `latest_close_older_than_${staleThresholdDays}_days`
        : undefined,
      ageDays
    }
  };
}
