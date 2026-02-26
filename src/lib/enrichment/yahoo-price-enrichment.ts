import type { NormalizedHoldingRecord } from "@/lib/ingest/parser/information-table";
import { computeCurrentGapMetric } from "@/lib/metrics/gap";
import { computeQuarterWindowVwap, type DailyOhlcvBar } from "@/lib/metrics/vwap";
import type { YahooChartResult, YahooPriceClient } from "@/lib/providers/yahoo-client";

const DEFAULT_CALC_VERSION = "vwap-quarter-v1";

export interface EnrichedHoldingRecord extends NormalizedHoldingRecord {
  weight?: string;
  cost?: number;
  price?: number;
  gap?: string;
  price_timestamp?: string;
  source?: string;
  calc_version?: string;
  stale_badge: "fresh" | "stale";
  stale_reason?: string;
}

export interface EnrichmentResult {
  rows: EnrichedHoldingRecord[];
  warnings: string[];
}

function toIsoTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function parseDailyBars(result: YahooChartResult): DailyOhlcvBar[] {
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  const open = quote?.open ?? [];
  const high = quote?.high ?? [];
  const low = quote?.low ?? [];
  const close = quote?.close ?? [];
  const volume = quote?.volume ?? [];

  const bars: DailyOhlcvBar[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    const dayOpen = open[index];
    const dayHigh = high[index];
    const dayLow = low[index];
    const dayClose = close[index];
    const dayVolume = volume[index];

    if (
      typeof timestamp !== "number" ||
      typeof dayOpen !== "number" ||
      typeof dayHigh !== "number" ||
      typeof dayLow !== "number" ||
      typeof dayClose !== "number" ||
      typeof dayVolume !== "number" ||
      !Number.isFinite(dayOpen) ||
      !Number.isFinite(dayHigh) ||
      !Number.isFinite(dayLow) ||
      !Number.isFinite(dayClose) ||
      !Number.isFinite(dayVolume)
    ) {
      continue;
    }

    bars.push({
      timestampMs: timestamp * 1000,
      open: dayOpen,
      high: dayHigh,
      low: dayLow,
      close: dayClose,
      volume: dayVolume
    });
  }

  return bars.sort((a, b) => a.timestampMs - b.timestampMs);
}

function toWeight(valueUsdThousands: number, totalValueUsdThousands: number): string | undefined {
  if (!Number.isFinite(valueUsdThousands) || !Number.isFinite(totalValueUsdThousands) || totalValueUsdThousands <= 0) {
    return undefined;
  }

  return `${((valueUsdThousands / totalValueUsdThousands) * 100).toFixed(2)}%`;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

export async function enrichHoldingsWithYahooDailyPrices(
  client: Pick<YahooPriceClient, "getPriceChart">,
  holdings: NormalizedHoldingRecord[],
  options: {
    reportPeriod: string;
    asOf?: Date;
    staleThresholdDays?: number;
    calcVersion?: string;
    historyRange?: string;
  }
): Promise<EnrichmentResult> {
  const warnings: string[] = [];
  const totalValueUsdThousands = holdings.reduce((total, holding) => total + holding.valueUsdThousands, 0);
  const calcVersion = options.calcVersion ?? DEFAULT_CALC_VERSION;

  const uniqueTickers = [
    ...new Set(holdings.map((holding) => holding.ticker?.trim().toUpperCase()).filter(isNonEmptyString))
  ];
  const barsByTicker = new Map<string, DailyOhlcvBar[]>();

  await Promise.all(
    uniqueTickers.map(async (ticker) => {
      const response = await client.getPriceChart(ticker, {
        interval: "1d",
        range: options.historyRange ?? "1y"
      });

      const chartError = response.chart.error;
      if (chartError) {
        throw new Error(`Yahoo chart error for ${ticker}: ${chartError.code ?? "unknown"} ${chartError.description ?? ""}`.trim());
      }

      const result = response.chart.result?.[0];
      if (!result) {
        throw new Error(`Yahoo chart result missing for ${ticker}.`);
      }

      const bars = parseDailyBars(result);
      if (bars.length === 0) {
        throw new Error(`No valid daily OHLCV bars returned for ${ticker}.`);
      }

      barsByTicker.set(ticker, bars);
    })
  );

  const rows = holdings.map<EnrichedHoldingRecord>((holding) => {
    const ticker = holding.ticker?.trim().toUpperCase();
    const weight = toWeight(holding.valueUsdThousands, totalValueUsdThousands);
    if (!ticker) {
      warnings.push(`Missing ticker for holding row ${holding.rowNumber}; enrichment skipped.`);
      return {
        ...holding,
        weight,
        stale_badge: "stale",
        stale_reason: "missing_ticker"
      };
    }

    const bars = barsByTicker.get(ticker);
    if (!bars || bars.length === 0) {
      warnings.push(`No valid Yahoo daily bars for ${ticker}; enrichment skipped.`);
      return {
        ...holding,
        weight,
        stale_badge: "stale",
        stale_reason: "missing_price_bars"
      };
    }

    const vwap = computeQuarterWindowVwap(bars, {
      reportPeriod: options.reportPeriod
    });
    const latestBar = bars[bars.length - 1];
    if (!latestBar) {
      throw new Error(`No latest bar available for ${ticker}.`);
    }

    const gapMetric = computeCurrentGapMetric({
      costBasis: vwap.vwap,
      currentPrice: latestBar.close,
      priceTimestamp: toIsoTimestamp(latestBar.timestampMs),
      source: "yahoo",
      calcVersion,
      asOf: options.asOf,
      staleThresholdDays: options.staleThresholdDays
    });

    return {
      ...holding,
      weight,
      cost: Number(vwap.vwap.toFixed(4)),
      price: Number(latestBar.close.toFixed(4)),
      gap: gapMetric.gap,
      price_timestamp: gapMetric.provenance.price_timestamp,
      source: gapMetric.provenance.source,
      calc_version: gapMetric.provenance.calc_version,
      stale_badge: gapMetric.freshness.badge,
      stale_reason: gapMetric.freshness.staleReason
    };
  });

  return {
    rows,
    warnings
  };
}
