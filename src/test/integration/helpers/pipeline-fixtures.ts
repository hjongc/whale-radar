import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AggregateSourceBundle } from "@/lib/data/mock-source";
import type { EnrichedHoldingRecord } from "@/lib/enrichment/yahoo-price-enrichment";

const PARSER_FIXTURE_DIR = join(process.cwd(), "src/lib/ingest/parser/fixtures");

export function parserFixture(name: "13f-hr.xml" | "13f-hr-a.xml" | "13f-nt.xml") {
  return readFileSync(join(PARSER_FIXTURE_DIR, name), "utf-8");
}

export function createSecUniverseClient() {
  return {
    getCompanyTickers: async () => ({
      "0": {
        cik_str: 1067983,
        title: "Berkshire Hathaway Inc.",
        ticker: "BRK-B",
        country_code: "US",
        forms: ["13F-HR", "13F-HR/A", "13F-NT", "13F-NT/A"]
      }
    })
  };
}

interface FilingStubRow {
  accessionNumber: string;
  form: "13F-HR" | "13F-HR/A";
  filingDate: string;
  reportDate: string;
  primaryDocument: string;
}

export function createSecFilingClient(rows: FilingStubRow[]) {
  const rowByAccession = new Map(rows.map((row) => [row.accessionNumber, row]));

  return {
    getSubmissions: async () => ({
      cik: "0001067983",
      filings: {
        recent: {
          accessionNumber: rows.map((row) => row.accessionNumber),
          form: rows.map((row) => row.form),
          filingDate: rows.map((row) => row.filingDate),
          reportDate: rows.map((row) => row.reportDate),
          acceptanceDateTime: rows.map(() => "2026-02-20T13:34:00.000Z"),
          primaryDocument: rows.map((row) => row.primaryDocument)
        }
      }
    }),
    getFilingIndex: async (_cik: string, accessionNumber: string) => {
      const row = rowByAccession.get(accessionNumber);
      if (!row) {
        throw new Error(`Unknown accession in fixture: ${accessionNumber}`);
      }

      return {
        directory: {
          item: [{ name: row.primaryDocument, type: "text/xml", size: 1024 }]
        }
      };
    }
  };
}

export function createYahooChartClient() {
  const seriesByTicker: Record<string, Array<{ t: string; close: number; volume: number }>> = {
    AAPL: [
      { t: "2025-11-01", close: 100, volume: 10 },
      { t: "2025-12-15", close: 200, volume: 20 },
      { t: "2025-12-30", close: 180, volume: 30 }
    ],
    AMZN: [
      { t: "2025-11-01", close: 150, volume: 10 },
      { t: "2025-12-15", close: 130, volume: 20 },
      { t: "2025-12-30", close: 140, volume: 30 }
    ],
    KO: [
      { t: "2025-11-01", close: 60, volume: 10 },
      { t: "2025-12-15", close: 58, volume: 20 },
      { t: "2025-12-30", close: 59, volume: 30 }
    ]
  };

  return {
    getPriceChart: async (symbol: string) => {
      const data = seriesByTicker[symbol];
      if (!data) {
        throw new Error(`Missing chart fixture for ticker: ${symbol}`);
      }

      return {
        chart: {
          result: [
            {
              meta: {
                symbol
              },
              timestamp: data.map((entry) => Math.floor(Date.parse(`${entry.t}T00:00:00.000Z`) / 1000)),
              indicators: {
                quote: [
                  {
                    open: data.map((entry) => entry.close),
                    high: data.map((entry) => entry.close),
                    low: data.map((entry) => entry.close),
                    close: data.map((entry) => entry.close),
                    volume: data.map((entry) => entry.volume)
                  }
                ]
              }
            }
          ],
          error: null
        }
      };
    }
  };
}

function toPercentNumber(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildAggregateSourceFromEnrichedRows(
  rows: EnrichedHoldingRecord[],
  options: {
    managerId: string;
    managerName: string;
    accession: string;
    reportPeriod: string;
    institutionName?: string;
    representativeManager?: string;
  }
): AggregateSourceBundle {
  return {
    market: {
      updatedQuarter: "2025-Q4",
      trackedInstitutions: 1,
      featuredInstitutions: [
        {
          institutionName: options.institutionName ?? options.managerName,
          representativeManager: options.representativeManager ?? options.managerName
        }
      ],
      mostOwned: rows.map((row) => ({ ticker: row.ticker ?? "UNKNOWN", institutionCount: 1 })),
      sectorRotation: [{ fromSector: "Unknown", toSector: "Unknown", weightPct: 0 }],
      sectorConcentration: [{ sector: "Unknown", weightPct: 0 }],
      cashTrend: [{ quarter: "2025-Q4", cashWeightPct: 0 }]
    },
    whales: [
      {
        managerId: options.managerId,
        managerName: options.managerName,
        institutionName: options.institutionName ?? options.managerName,
        representativeManager: options.representativeManager ?? options.managerName,
        reportPeriod: options.reportPeriod,
        holdings: rows.map((row) => ({
          accession: options.accession,
          ticker: row.ticker ?? "UNKNOWN",
          issuerName: row.issuerName,
          type: row.type,
          weightPct: toPercentNumber(row.weight),
          cost: row.cost ?? 0,
          price: row.price ?? 0,
          gapPct: toPercentNumber(row.gap),
          price_timestamp: row.price_timestamp ?? "",
          source: "yahoo",
          calc_version: row.calc_version ?? "vwap-quarter-v1",
          stale_badge: row.stale_badge,
          stale_reason: row.stale_reason
        }))
      }
    ]
  };
}
