export interface DailyOhlcvBar {
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface QuarterWindowVwapResult {
  vwap: number;
  windowStartDate: string;
  windowEndDate: string;
  sampledBars: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QUARTER_WINDOW_DAYS = 92;

function assertFiniteNumber(value: number, fieldName: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${fieldName}.`);
  }
}

function toUtcDateStart(dateString: string): Date {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${dateString}. Expected YYYY-MM-DD.`);
  }

  return date;
}

function toIsoDate(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function dailyTypicalPrice(bar: DailyOhlcvBar): number {
  return (bar.open + bar.high + bar.low + bar.close) / 4;
}

export function computeQuarterWindowVwap(
  bars: DailyOhlcvBar[],
  options: { reportPeriod: string; quarterWindowDays?: number }
): QuarterWindowVwapResult {
  if (bars.length === 0) {
    throw new Error("Cannot compute VWAP with zero OHLCV bars.");
  }

  const quarterWindowDays = options.quarterWindowDays ?? DEFAULT_QUARTER_WINDOW_DAYS;
  if (!Number.isInteger(quarterWindowDays) || quarterWindowDays <= 0) {
    throw new Error("quarterWindowDays must be a positive integer.");
  }

  const reportPeriodUtc = toUtcDateStart(options.reportPeriod);
  const windowEnd = reportPeriodUtc.getTime() + ONE_DAY_MS - 1;
  const windowStart = reportPeriodUtc.getTime() - (quarterWindowDays - 1) * ONE_DAY_MS;

  const eligibleBars = bars
    .filter((bar) => bar.timestampMs >= windowStart && bar.timestampMs <= windowEnd)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  if (eligibleBars.length === 0) {
    throw new Error(`No OHLCV bars available inside quarter window ending ${options.reportPeriod}.`);
  }

  let weightedNotional = 0;
  let weightedVolume = 0;

  for (const bar of eligibleBars) {
    assertFiniteNumber(bar.timestampMs, "timestampMs");
    assertFiniteNumber(bar.open, "open");
    assertFiniteNumber(bar.high, "high");
    assertFiniteNumber(bar.low, "low");
    assertFiniteNumber(bar.close, "close");
    assertFiniteNumber(bar.volume, "volume");

    if (bar.volume <= 0) {
      continue;
    }

    weightedNotional += dailyTypicalPrice(bar) * bar.volume;
    weightedVolume += bar.volume;
  }

  if (weightedVolume <= 0) {
    throw new Error(`No positive-volume OHLCV bars inside quarter window ending ${options.reportPeriod}.`);
  }

  return {
    vwap: weightedNotional / weightedVolume,
    windowStartDate: toIsoDate(windowStart),
    windowEndDate: toIsoDate(windowEnd),
    sampledBars: eligibleBars.length
  };
}
