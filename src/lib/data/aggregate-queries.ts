import type { FilingAction } from "@/lib/domain/enums";
import type { AggregateSourceBundle, WhaleManagerAggregateSource } from "@/lib/data/mock-source";
import type {
  MarketHubAggregateDto,
  WhaleManagerDirectoryItemDto,
  WhaleActionMixItemDto,
  WhaleGapRankingItemDto,
  WhaleHoldingRowDto,
  WhaleHoldingsQueryParams,
  WhaleInsiderAggregateDto
} from "@/lib/data/types";

type DbInstitutionRow = {
  id: string;
  cik: string;
  institution_name: string;
  representative_manager: string | null;
  is_priority_cohort: boolean;
};

type DbFilingRow = {
  id: string;
  institution_id: string;
  accession_number: string;
  filing_form_type: string;
  filing_date: string;
  report_period: string;
  filing_manager_name: string | null;
};

type DbPositionRow = {
  id: string;
  filing_id: string;
  ticker: string | null;
  issuer_name: string;
  cusip: string;
  value_usd_thousands: number;
  shares: number;
};

type DbDerivedMetricRow = {
  filing_id: string;
  position_id: string | null;
  gap_pct: number | null;
  price_timestamp: string;
  is_stale: boolean;
  source: string;
  metric_version: string;
};

type DbSectorMapRow = {
  cusip: string | null;
  ticker: string | null;
  sector_code: string;
  sector_label: string;
  source: string;
  source_version?: string;
  updated_at: string;
  confidence: number;
};

type DbIdentityMapRow = {
  cusip: string;
  ticker: string;
  source: string;
  source_version: string;
  confidence: number;
  updated_at: string;
};

type DbWhaleManagerDirectorySnapshotRow = {
  manager_id: string;
  manager_name: string;
  institution_name: string;
  representative_manager: string;
  report_period: string;
  latest_filing_date: string;
  holdings_count: number;
  total_value_usd_thousands: number;
  rank: number;
  stale: boolean;
};

type DbWhaleManagerHoldingsSnapshotRow = {
  manager_id: string;
  manager_name: string;
  report_period: string;
  accession: string;
  ticker: string;
  issuer_name: string;
  action_type: string;
  value_usd_thousands: number;
  shares: number;
  weight_pct: number;
  cost: number | null;
  price: number;
  gap_pct: number | null;
  gap_known: boolean;
  gap_reason: string | null;
  price_timestamp: string;
  source: string;
  calc_version: string;
  freshness: string;
  stale_reason: string | null;
};

type SectorLookup = {
  byCusip: Map<string, DbSectorMapRow>;
  byTicker: Map<string, DbSectorMapRow>;
};

type IdentityLookup = {
  byCusip: Map<string, DbIdentityMapRow>;
};

type AggregatedTickerPosition = {
  ticker: string;
  issuerName: string;
  valueUsdThousands: number;
  shares: number;
  cusips: Set<string>;
};

const GICS_CODE_TO_LABEL = new Map<string, string>([
  ["10", "Energy"],
  ["15", "Materials"],
  ["20", "Industrials"],
  ["25", "Consumer Discretionary"],
  ["30", "Consumer Staples"],
  ["35", "Health Care"],
  ["40", "Financials"],
  ["45", "Information Technology"],
  ["50", "Communication Services"],
  ["55", "Utilities"],
  ["60", "Real Estate"]
]);

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatSignedPercentOrNull(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return formatSignedPercent(value);
}

function formatWeightPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toManagerId(cik: string): string {
  return `cik-${cik}`;
}

function resolveRepresentativeManager(options: {
  institutionName: string;
  institutionRepresentativeManager?: string | null;
  filingManagerName?: string | null;
}): string {
  const institutionRepresentativeManager = options.institutionRepresentativeManager?.trim();
  if (institutionRepresentativeManager) {
    return institutionRepresentativeManager;
  }

  const filingManagerName = options.filingManagerName?.trim();
  if (filingManagerName) {
    return filingManagerName;
  }

  return options.institutionName;
}

function isStaleReportPeriod(reportPeriod: string, maxAgeDays: number = 220): boolean {
  const reportPeriodDate = new Date(`${reportPeriod}T00:00:00.000Z`);
  if (Number.isNaN(reportPeriodDate.getTime())) {
    return true;
  }

  const now = new Date();
  const ageMs = now.getTime() - reportPeriodDate.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > maxAgeDays;
}

function parseNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toActionType(value: string): FilingAction {
  if (value === "NEW" || value === "ADD" || value === "REDUCE" || value === "KEEP") {
    return value;
  }

  return "KEEP";
}

function normalizeCusip(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

function isValidTicker(value: string): boolean {
  return /^[A-Z.]{1,10}$/.test(value);
}

function toNormalizedTickerOrNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeTicker(value);
  if (!isValidTicker(normalized)) {
    return null;
  }

  return normalized;
}

function isValidHoldingRow(row: DbPositionRow): boolean {
  return row.shares > 0 && row.value_usd_thousands > 0;
}

function isValidGicsSectorPair(sectorCode: string | null | undefined, sectorLabel: string | null | undefined): sectorLabel is string {
  if (!sectorCode || !sectorLabel) {
    return false;
  }

  const expectedLabel = GICS_CODE_TO_LABEL.get(sectorCode.trim());
  return expectedLabel === sectorLabel.trim();
}

function isExcludedFromSectorRotation(sector: string): boolean {
  const normalized = sector.trim().toLowerCase();
  return normalized === "unknown";
}

function formatQuarterLabel(input: string): string {
  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return input;
  }

  const quarter = Math.floor(parsed.getUTCMonth() / 3) + 1;
  return `${parsed.getUTCFullYear()}Q${quarter}`;
}

function supabaseRestConfig() {
  if (process.env.NODE_ENV === "test" && process.env.ENABLE_DB_QUERY_TESTS !== "1") {
    return null;
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!baseUrl || !serviceKey) {
    return null;
  }

  return {
    restUrl: `${baseUrl.replace(/\/$/, "")}/rest/v1`,
    serviceKey
  };
}

function resolveTestSource(source?: AggregateSourceBundle): AggregateSourceBundle | null {
  if (process.env.NODE_ENV === "test" && source) {
    return source;
  }

  return null;
}

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0 || values.length === 0) {
    return [values];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function logSupabaseFetchFailure(context: { table: string; url: string; status?: number; error?: unknown }) {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  const base = `[supabase-fetch] table=${context.table} url=${context.url}`;
  if (typeof context.status === "number") {
    console.error(`${base} status=${context.status}`);
    return;
  }

  const message = context.error instanceof Error ? context.error.message : String(context.error);
  console.error(`${base} error=${message}`);
}

async function fetchSupabaseRows<T>(table: string, queryParams: Record<string, string>): Promise<T[]> {
  const config = supabaseRestConfig();
  if (!config) {
    return [];
  }

  const url = new URL(`${config.restUrl}/${table}`);
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url, {
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`
      },
      cache: "no-store"
    });

    if (!response.ok) {
      logSupabaseFetchFailure({
        table,
        url: url.toString(),
        status: response.status
      });
      return [];
    }

    const payload = await response.json();
    return Array.isArray(payload) ? (payload as T[]) : [];
  } catch (error) {
    logSupabaseFetchFailure({
      table,
      url: url.toString(),
      error
    });
    return [];
  }
}

async function fetchSupabaseRowsWithPagination<T>(
  table: string,
  queryParams: Record<string, string>,
  pageSize: number = 1000
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;

  for (;;) {
    const page = await fetchSupabaseRows<T>(table, {
      ...queryParams,
      limit: String(pageSize),
      offset: String(offset)
    });

    if (page.length === 0) {
      break;
    }

    rows.push(...page);
    if (page.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return rows;
}

async function fetchFilingsByInstitutionIds(institutionIds: string[]): Promise<DbFilingRow[]> {
  if (institutionIds.length === 0) {
    return [];
  }

  const rows: DbFilingRow[] = [];
  for (const chunk of chunkArray(institutionIds, 40)) {
    const chunkRows = await fetchSupabaseRows<DbFilingRow>("filings", {
      select: "id,institution_id,accession_number,filing_form_type,filing_date,report_period,filing_manager_name",
      institution_id: `in.(${chunk.join(",")})`,
      filing_form_type: "in.(13F-HR,13F-HR/A)",
      order: "institution_id.asc,report_period.desc,filing_date.desc,accession_number.desc",
      limit: "20000"
    });
    rows.push(...chunkRows);
  }

  return rows;
}

async function fetchPositionsByFilingIds(filingIds: string[]): Promise<DbPositionRow[]> {
  if (filingIds.length === 0) {
    return [];
  }

  const rows: DbPositionRow[] = [];
  for (const chunk of chunkArray([...new Set(filingIds)], 10)) {
    const chunkRows = await Promise.all(
      chunk.map(async (filingId) => {
        const filingRows = await fetchSupabaseRowsWithPagination<DbPositionRow>("positions", {
          select: "id,filing_id,ticker,issuer_name,cusip,value_usd_thousands,shares",
          filing_id: `eq.${filingId}`
        });

        return filingRows.map((row) => ({
          ...row,
          value_usd_thousands: parseNumber(row.value_usd_thousands),
          shares: parseNumber(row.shares)
        }));
      })
    );

    rows.push(...chunkRows.flat());
  }

  return rows;
}

async function fetchDerivedMetricsByFilingIds(filingIds: string[]): Promise<DbDerivedMetricRow[]> {
  if (filingIds.length === 0) {
    return [];
  }

  const rows: DbDerivedMetricRow[] = [];
  for (const chunk of chunkArray([...new Set(filingIds)], 25)) {
    const filingRows = await fetchSupabaseRowsWithPagination<DbDerivedMetricRow>("derived_metrics", {
      select: "filing_id,position_id,gap_pct,price_timestamp,is_stale,source,metric_version",
      filing_id: `in.(${chunk.join(",")})`,
      order: "price_timestamp.desc"
    });

    rows.push(
      ...filingRows.map((row) => ({
        ...row,
        gap_pct: row.gap_pct === null || row.gap_pct === undefined ? null : parseNumber(row.gap_pct)
      }))
    );
  }

  return rows;
}

async function fetchSectorMappings(): Promise<SectorLookup> {
  const rows = await fetchSupabaseRows<DbSectorMapRow>("security_sector_map", {
    select: "cusip,ticker,sector_code,sector_label,source,confidence,updated_at",
    is_active: "eq.true",
    order: "updated_at.desc",
    limit: "30000"
  });

  const byCusip = new Map<string, DbSectorMapRow>();
  const byTicker = new Map<string, DbSectorMapRow>();

  for (const row of rows) {
    if (!isValidGicsSectorPair(row.sector_code, row.sector_label)) {
      continue;
    }

    const mapped = {
      ...row,
      confidence: parseNumber(row.confidence)
    };

    if (row.cusip) {
      byCusip.set(normalizeCusip(row.cusip), mapped);
    }

    if (row.ticker) {
      byTicker.set(normalizeTicker(row.ticker), mapped);
    }
  }

  return {
    byCusip,
    byTicker
  };
}

async function fetchIdentityMappings(): Promise<IdentityLookup> {
  const rows = await fetchSupabaseRows<DbIdentityMapRow>("security_identity_map", {
    select: "cusip,ticker,source,source_version,confidence,updated_at",
    is_active: "eq.true",
    limit: "10000"
  });

  const byCusip = new Map<string, DbIdentityMapRow>();
  for (const row of rows) {
    const normalizedCusip = normalizeCusip(row.cusip);
    const normalizedTicker = toNormalizedTickerOrNull(row.ticker);
    if (!normalizedCusip || !normalizedTicker) {
      continue;
    }

    byCusip.set(normalizedCusip, {
      ...row,
      ticker: normalizedTicker,
      confidence: parseNumber(row.confidence)
    });
  }

  return {
    byCusip
  };
}

function determineAction(currentValue: number, previousValue: number | undefined): FilingAction {
  if (previousValue === undefined) {
    return "NEW";
  }

  if (currentValue > previousValue * 1.03) {
    return "ADD";
  }

  if (currentValue < previousValue * 0.97) {
    return "REDUCE";
  }

  return "KEEP";
}

async function loadDbTop50Snapshot() {
  const config = supabaseRestConfig();
  if (!config) {
    return null;
  }

  const institutions = await fetchSupabaseRows<DbInstitutionRow>("institutions", {
    select: "id,cik,institution_name,representative_manager,is_priority_cohort",
    order: "is_priority_cohort.desc,institution_name.asc",
    limit: "200"
  });

  if (institutions.length === 0) {
    throw new Error("Supabase snapshot unavailable: no institutions returned.");
  }

  const institutionIds = institutions.map((row) => row.id);
  const filings: DbFilingRow[] = await fetchFilingsByInstitutionIds(institutionIds);

  if (filings.length === 0) {
    throw new Error("Supabase snapshot unavailable: no filings returned.");
  }

  const filingsByInstitution = new Map<string, DbFilingRow[]>();
  for (const filing of filings) {
    const bucket = filingsByInstitution.get(filing.institution_id) ?? [];
    bucket.push(filing);
    filingsByInstitution.set(filing.institution_id, bucket);
  }

  const latestFilings = new Map<string, DbFilingRow>();
  const previousFilings = new Map<string, DbFilingRow>();
  for (const institution of institutions) {
    const rows = filingsByInstitution.get(institution.id) ?? [];
    const latest = rows[0];
    if (latest) {
      latestFilings.set(institution.id, latest);
    }

    const previous = latest ? rows.find((row) => row.report_period !== latest.report_period) : undefined;
    if (previous) {
      previousFilings.set(institution.id, previous);
    }
  }

  const latestFilingIds = [...new Set([...latestFilings.values()].map((row) => row.id))];
  const latestPositions = await fetchPositionsByFilingIds(latestFilingIds);

  const latestPositionsByFiling = new Map<string, DbPositionRow[]>();
  for (const row of latestPositions) {
    const bucket = latestPositionsByFiling.get(row.filing_id) ?? [];
    bucket.push(row);
    latestPositionsByFiling.set(row.filing_id, bucket);
  }

  const rankedInstitutions = institutions
    .filter((institution) => latestFilings.has(institution.id))
    .map((institution) => {
      const latestFiling = latestFilings.get(institution.id)!;
      const rows = latestPositionsByFiling.get(latestFiling.id) ?? [];
      const latestTotalValue = rows.filter(isValidHoldingRow).reduce((sum, row) => sum + row.value_usd_thousands, 0);
      return {
        institution,
        latestTotalValue
      };
    })
    .sort((left, right) => {
      if (right.latestTotalValue !== left.latestTotalValue) {
        return right.latestTotalValue - left.latestTotalValue;
      }

      const byName = left.institution.institution_name.localeCompare(right.institution.institution_name);
      if (byName !== 0) {
        return byName;
      }

      return left.institution.id.localeCompare(right.institution.id);
    });

  const topInstitutions = rankedInstitutions.slice(0, 50).map((entry) => entry.institution);
  const topInstitutionIds = new Set(topInstitutions.map((institution) => institution.id));
  const topPreviousFilingIds = [...previousFilings.values()]
    .filter((filing) => topInstitutionIds.has(filing.institution_id))
    .map((filing) => filing.id);
  const previousPositions = await fetchPositionsByFilingIds(topPreviousFilingIds);
  const derivedMetrics = await fetchDerivedMetricsByFilingIds(topInstitutions.map((institution) => latestFilings.get(institution.id)?.id).filter((id): id is string => Boolean(id)));

  const positions = [...latestPositions, ...previousPositions];

  const positionsByFiling = new Map<string, DbPositionRow[]>();
  for (const row of positions) {
    const bucket = positionsByFiling.get(row.filing_id) ?? [];
    bucket.push(row);
    positionsByFiling.set(row.filing_id, bucket);
  }

  const institutionById = new Map(institutions.map((institution) => [institution.id, institution]));
  const sectorLookup = await fetchSectorMappings();
  const identityLookup = await fetchIdentityMappings();
  const latestMetricByPositionId = new Map<string, DbDerivedMetricRow>();

  for (const metric of derivedMetrics) {
    if (!metric.position_id) {
      continue;
    }

    const existing = latestMetricByPositionId.get(metric.position_id);
    if (!existing) {
      latestMetricByPositionId.set(metric.position_id, metric);
      continue;
    }

    const existingTime = new Date(existing.price_timestamp).getTime();
    const candidateTime = new Date(metric.price_timestamp).getTime();
    if (candidateTime > existingTime) {
      latestMetricByPositionId.set(metric.position_id, metric);
    }
  }

  return {
    institutions,
    topInstitutions,
    latestFilings,
    previousFilings,
    positionsByFiling,
    latestMetricByPositionId,
    institutionById,
    sectorLookup,
    identityLookup
  };
}

type WhaleDirectorySnapshot = {
  topInstitutions: DbInstitutionRow[];
  latestFilings: Map<string, DbFilingRow>;
  positionsByFiling: Map<string, DbPositionRow[]>;
};

async function loadDbWhaleDirectorySnapshot(): Promise<WhaleDirectorySnapshot | null> {
  const config = supabaseRestConfig();
  if (!config) {
    return null;
  }

  const institutions = await fetchSupabaseRows<DbInstitutionRow>("institutions", {
    select: "id,cik,institution_name,representative_manager,is_priority_cohort",
    order: "is_priority_cohort.desc,institution_name.asc",
    limit: "200"
  });

  if (institutions.length === 0) {
    throw new Error("Supabase snapshot unavailable: no institutions returned.");
  }

  const institutionIds = institutions.map((row) => row.id);
  const filings: DbFilingRow[] = await fetchFilingsByInstitutionIds(institutionIds);

  if (filings.length === 0) {
    throw new Error("Supabase snapshot unavailable: no filings returned.");
  }

  const filingsByInstitution = new Map<string, DbFilingRow[]>();
  for (const filing of filings) {
    const bucket = filingsByInstitution.get(filing.institution_id) ?? [];
    bucket.push(filing);
    filingsByInstitution.set(filing.institution_id, bucket);
  }

  const latestFilings = new Map<string, DbFilingRow>();
  for (const institution of institutions) {
    const latest = (filingsByInstitution.get(institution.id) ?? [])[0];
    if (latest) {
      latestFilings.set(institution.id, latest);
    }
  }

  const latestFilingIds = [...new Set([...latestFilings.values()].map((row) => row.id))];
  const latestPositions = await fetchPositionsByFilingIds(latestFilingIds);
  const latestPositionsByFiling = new Map<string, DbPositionRow[]>();
  for (const row of latestPositions) {
    const bucket = latestPositionsByFiling.get(row.filing_id) ?? [];
    bucket.push(row);
    latestPositionsByFiling.set(row.filing_id, bucket);
  }

  const rankedInstitutions = institutions
    .filter((institution) => latestFilings.has(institution.id))
    .map((institution) => {
      const latestFiling = latestFilings.get(institution.id)!;
      const rows = latestPositionsByFiling.get(latestFiling.id) ?? [];
      const latestTotalValue = rows.filter(isValidHoldingRow).reduce((sum, row) => sum + row.value_usd_thousands, 0);
      return {
        institution,
        latestTotalValue
      };
    })
    .sort((left, right) => {
      if (right.latestTotalValue !== left.latestTotalValue) {
        return right.latestTotalValue - left.latestTotalValue;
      }

      const byName = left.institution.institution_name.localeCompare(right.institution.institution_name);
      if (byName !== 0) {
        return byName;
      }

      return left.institution.id.localeCompare(right.institution.id);
    });

  return {
    topInstitutions: rankedInstitutions.slice(0, 50).map((entry) => entry.institution),
    latestFilings,
    positionsByFiling: latestPositionsByFiling
  };
}

function isSupabaseSnapshotEmptyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "Supabase snapshot unavailable: no institutions returned." ||
    error.message === "Supabase snapshot unavailable: no filings returned."
  );
}

function buildEmptyMarketHubAggregates(): MarketHubAggregateDto {
  return {
    trackedInstitutions: 0,
    featuredInstitutions: [],
    mostOwned: [],
    hotSectorMovement: {
      sector: "N/A",
      deltaWeightPct: 0,
      summary: "No published filing snapshot is available yet."
    },
    highestMarginOfSafety: {
      ticker: "N/A",
      gapPct: 0,
      accession: "missing",
      priceTimestamp: new Date().toISOString(),
      calcVersion: "top50-bootstrap-v1",
      source: "snapshot-empty",
      freshness: "stale",
      staleReason: "snapshot_unavailable"
    },
    sectorRotation: {
      updatedQuarter: "Not published",
      flows: []
    },
    sectorConcentration: [],
    cashTrend: {
      series: []
    }
  };
}

function resolvePositionSector(row: DbPositionRow, sectorLookup: SectorLookup): string {
  const mappedByCusip = sectorLookup.byCusip.get(normalizeCusip(row.cusip));
  const mappedByTicker = row.ticker ? sectorLookup.byTicker.get(normalizeTicker(row.ticker)) : undefined;

  if (mappedByCusip && isValidGicsSectorPair(mappedByCusip.sector_code, mappedByCusip.sector_label)) {
    return mappedByCusip.sector_label;
  }

  if (mappedByTicker && isValidGicsSectorPair(mappedByTicker.sector_code, mappedByTicker.sector_label)) {
    return mappedByTicker.sector_label;
  }

  return "Unknown";
}

function resolvePositionTicker(row: DbPositionRow, sectorLookup: SectorLookup, identityLookup: IdentityLookup): string | null {
  const directTicker = toNormalizedTickerOrNull(row.ticker);
  if (directTicker) {
    return directTicker;
  }

  const identityTicker = toNormalizedTickerOrNull(identityLookup.byCusip.get(normalizeCusip(row.cusip))?.ticker);
  if (identityTicker) {
    return identityTicker;
  }

  return null;
}

function aggregateHoldingsByTicker(
  rows: DbPositionRow[],
  sectorLookup: SectorLookup,
  identityLookup: IdentityLookup
): AggregatedTickerPosition[] {
  const byTicker = new Map<string, AggregatedTickerPosition>();

  for (const row of rows) {
    if (!isValidHoldingRow(row)) {
      continue;
    }

    const ticker = resolvePositionTicker(row, sectorLookup, identityLookup);
    if (!ticker) {
      continue;
    }

    const normalizedCusip = normalizeCusip(row.cusip);
    const current = byTicker.get(ticker);

    if (!current) {
      byTicker.set(ticker, {
        ticker,
        issuerName: row.issuer_name,
        valueUsdThousands: row.value_usd_thousands,
        shares: row.shares,
        cusips: new Set([normalizedCusip])
      });
      continue;
    }

    current.valueUsdThousands += row.value_usd_thousands;
    current.shares += row.shares;
    current.cusips.add(normalizedCusip);
  }

  return [...byTicker.values()];
}

function buildSectorWeights(rows: DbPositionRow[], sectorLookup: SectorLookup): Map<string, number> {
  const sectorValue = new Map<string, number>();
  let totalValue = 0;

  for (const row of rows) {
    if (row.value_usd_thousands <= 0) {
      continue;
    }

    const sector = resolvePositionSector(row, sectorLookup);
    if (isExcludedFromSectorRotation(sector)) {
      continue;
    }

    totalValue += row.value_usd_thousands;
    sectorValue.set(sector, (sectorValue.get(sector) ?? 0) + row.value_usd_thousands);
  }

  if (totalValue <= 0) {
    return new Map<string, number>();
  }

  return new Map([...sectorValue.entries()].map(([sector, value]) => [sector, (value / totalValue) * 100]));
}

function buildInstitutionFlows(previousWeights: Map<string, number>, latestWeights: Map<string, number>) {
  const allSectors = new Set<string>([...previousWeights.keys(), ...latestWeights.keys()]);
  const outflows: Array<{ sector: string; amount: number }> = [];
  const inflows: Array<{ sector: string; amount: number }> = [];

  for (const sector of allSectors) {
    const delta = (latestWeights.get(sector) ?? 0) - (previousWeights.get(sector) ?? 0);
    if (delta > 0.001) {
      inflows.push({ sector, amount: delta });
    } else if (delta < -0.001) {
      outflows.push({ sector, amount: -delta });
    }
  }

  outflows.sort((a, b) => b.amount - a.amount);
  inflows.sort((a, b) => b.amount - a.amount);

  const flows: Array<{ fromSector: string; toSector: string; weightPct: number }> = [];
  let outIndex = 0;
  let inIndex = 0;

  while (outIndex < outflows.length && inIndex < inflows.length) {
    const out = outflows[outIndex];
    const incoming = inflows[inIndex];
    const matched = Math.min(out.amount, incoming.amount);

    if (matched > 0.001) {
      flows.push({
        fromSector: out.sector,
        toSector: incoming.sector,
        weightPct: matched
      });
    }

    out.amount -= matched;
    incoming.amount -= matched;

    if (out.amount <= 0.001) {
      outIndex += 1;
    }

    if (incoming.amount <= 0.001) {
      inIndex += 1;
    }
  }

  return flows;
}

function computeSectorRotationFromSnapshot(dbSnapshot: NonNullable<Awaited<ReturnType<typeof loadDbTop50Snapshot>>>) {
  const aggregate = new Map<string, number>();
  const reportPeriods: string[] = [];
  let comparableInstitutionCount = 0;

  for (const institution of dbSnapshot.topInstitutions) {
    const latest = dbSnapshot.latestFilings.get(institution.id);
    if (!latest) {
      continue;
    }

    reportPeriods.push(latest.report_period);

    const candidatePrevious = dbSnapshot.previousFilings.get(institution.id) ?? null;

    if (!candidatePrevious) {
      continue;
    }

    const latestRows = dbSnapshot.positionsByFiling.get(latest.id) ?? [];
    const previousRows = dbSnapshot.positionsByFiling.get(candidatePrevious.id) ?? [];

    if (latestRows.length === 0 || previousRows.length === 0) {
      continue;
    }

    comparableInstitutionCount += 1;

    const latestWeights = buildSectorWeights(latestRows, dbSnapshot.sectorLookup);
    const previousWeights = buildSectorWeights(previousRows, dbSnapshot.sectorLookup);
    const institutionFlows = buildInstitutionFlows(previousWeights, latestWeights);

    for (const flow of institutionFlows) {
      const key = `${flow.fromSector}::${flow.toSector}`;
      aggregate.set(key, (aggregate.get(key) ?? 0) + flow.weightPct);
    }
  }

  const flows = [...aggregate.entries()]
    .map(([key, weightPct]) => {
      const [fromSector, toSector] = key.split("::");
      const normalizedWeight = comparableInstitutionCount > 0 ? weightPct / comparableInstitutionCount : 0;
      return { fromSector, toSector, weightPct: Number(normalizedWeight.toFixed(2)) };
    })
    .sort((a, b) => b.weightPct - a.weightPct);

  const updatedQuarter =
    reportPeriods.length > 0
      ? formatQuarterLabel(
          [...reportPeriods]
            .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())
            .at(0) ?? ""
        )
      : null;

  return {
    flows,
    updatedQuarter
  };
}

function buildSectorConcentrationFromSnapshot(dbSnapshot: NonNullable<Awaited<ReturnType<typeof loadDbTop50Snapshot>>>) {
  const sectorValue = new Map<string, number>();
  let totalValue = 0;

  for (const institution of dbSnapshot.topInstitutions) {
    const latest = dbSnapshot.latestFilings.get(institution.id);
    if (!latest) {
      continue;
    }

    const rows = dbSnapshot.positionsByFiling.get(latest.id) ?? [];
    for (const row of rows) {
      if (row.value_usd_thousands <= 0) {
        continue;
      }

      const resolvedSector = resolvePositionSector(row, dbSnapshot.sectorLookup);
      const sector = resolvedSector === "Unknown" ? "Unclassified" : resolvedSector;

      totalValue += row.value_usd_thousands;
      sectorValue.set(sector, (sectorValue.get(sector) ?? 0) + row.value_usd_thousands);
    }
  }

  if (totalValue <= 0) {
    return [] as Array<{ sector: string; weightPct: number }>;
  }

  return [...sectorValue.entries()]
    .map(([sector, value]) => ({ sector, weightPct: Number(((value / totalValue) * 100).toFixed(2)) }))
    .sort((a, b) => b.weightPct - a.weightPct);
}

function computeTopNetSectorFromFlows(flows: Array<{ fromSector: string; toSector: string; weightPct: number }>) {
  const netBySector = new Map<string, number>();

  for (const flow of flows) {
    netBySector.set(flow.toSector, (netBySector.get(flow.toSector) ?? 0) + flow.weightPct);
    netBySector.set(flow.fromSector, (netBySector.get(flow.fromSector) ?? 0) - flow.weightPct);
  }

  const ordered = [...netBySector.entries()].sort((a, b) => b[1] - a[1]);
  const top = ordered[0];
  if (!top || top[1] <= 0.001) {
    return null;
  }

  return {
    sector: top[0],
    netPct: Number(top[1].toFixed(2))
  };
}

function toHoldingRow(record: WhaleManagerAggregateSource["holdings"][number]): WhaleHoldingRowDto {
  return {
    accession: record.accession,
    ticker: record.ticker,
    issuerName: record.issuerName,
    type: record.type,
    valueUsdThousands: Number((record.valueUsdThousands ?? 0).toFixed(2)),
    shares: Number((record.shares ?? 0).toFixed(4)),
    weight: formatWeightPercent(record.weightPct),
    cost: record.cost === null ? null : Number(record.cost.toFixed(4)),
    price: Number(record.price.toFixed(4)),
    gap: formatSignedPercentOrNull(record.gapPct),
    gapReason: record.gap_reason,
    priceTimestamp: record.price_timestamp,
    source: record.source,
    calcVersion: record.calc_version,
    freshness: record.stale_badge,
    staleReason: record.stale_reason
  };
}

function toActionMix(records: WhaleManagerAggregateSource["holdings"]): WhaleActionMixItemDto[] {
  const counts = new Map<FilingAction, number>([
    ["NEW", 0],
    ["ADD", 0],
    ["REDUCE", 0],
    ["KEEP", 0]
  ]);

  for (const holding of records) {
    counts.set(holding.type, (counts.get(holding.type) ?? 0) + 1);
  }

  return [...counts.entries()].map(([type, count]) => ({ type, count }));
}

function toGapRanking(records: WhaleManagerAggregateSource["holdings"]): WhaleGapRankingItemDto[] {
  return records
    .filter((record) => record.gapPct !== null)
    .sort((a, b) => (a.gapPct ?? 0) - (b.gapPct ?? 0))
    .map((record) => ({
      ticker: record.ticker,
      gap: formatSignedPercent(record.gapPct ?? 0),
      type: record.type,
      accession: record.accession,
      priceTimestamp: record.price_timestamp,
      source: record.source,
      calcVersion: record.calc_version,
      freshness: record.stale_badge,
      staleReason: record.stale_reason
    }));
}

function filterHoldings(records: WhaleManagerAggregateSource["holdings"], query: WhaleHoldingsQueryParams) {
  return records.filter((record) => {
    if (query.action !== "ALL" && record.type !== query.action) {
      return false;
    }

    if (!query.search) {
      return true;
    }

    const keyword = query.search.toLowerCase();
    return record.ticker.toLowerCase().includes(keyword) || record.issuerName.toLowerCase().includes(keyword);
  });
}

export type WhaleManagerComputed = {
  manager: {
    managerId: string;
    managerName: string;
    reportPeriod: string;
  };
  holdings: WhaleManagerAggregateSource["holdings"];
  gapRanking: WhaleGapRankingItemDto[];
  actionMix: WhaleActionMixItemDto[];
};

export function toWhaleInsiderDto(base: WhaleManagerComputed, query: WhaleHoldingsQueryParams): WhaleInsiderAggregateDto {
  const filtered = filterHoldings(base.holdings, query);
  const totalRows = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / query.pageSize));
  const safePage = Math.min(query.page, totalPages);
  const start = (safePage - 1) * query.pageSize;
  const pagedRows = filtered.slice(start, start + query.pageSize).map(toHoldingRow);

  return {
    manager: base.manager,
    gapRanking: base.gapRanking,
    actionMix: base.actionMix,
    holdingsTable: {
      rows: pagedRows,
      page: safePage,
      pageSize: query.pageSize,
      totalRows,
      totalPages,
      filters: {
        action: query.action,
        search: query.search
      }
    }
  };
}

function buildWhaleManagerComputedFromSnapshot(
  dbSnapshot: NonNullable<Awaited<ReturnType<typeof loadDbTop50Snapshot>>>,
  managerId: string
): WhaleManagerComputed {
  const institution = dbSnapshot.institutions.find((row) => toManagerId(row.cik) === managerId);
  if (!institution) {
    throw new Error(`Unknown manager id: ${managerId}`);
  }

  const latestFiling = dbSnapshot.latestFilings.get(institution.id);
  if (!latestFiling) {
    return {
      manager: {
        managerId,
        managerName: institution.institution_name,
        reportPeriod: ""
      },
      holdings: [],
      gapRanking: [],
      actionMix: toActionMix([])
    };
  }

  const previousFiling = dbSnapshot.previousFilings.get(institution.id);
  const latestRows = dbSnapshot.positionsByFiling.get(latestFiling.id) ?? [];
  const previousRows = previousFiling ? dbSnapshot.positionsByFiling.get(previousFiling.id) ?? [] : [];
  const latestHoldings = aggregateHoldingsByTicker(latestRows, dbSnapshot.sectorLookup, dbSnapshot.identityLookup);
  const previousHoldings = aggregateHoldingsByTicker(previousRows, dbSnapshot.sectorLookup, dbSnapshot.identityLookup);
  const previousByTicker = new Map(previousHoldings.map((holding) => [holding.ticker, holding]));
  const previousByCusip = new Map<string, AggregatedTickerPosition>();

  for (const previous of previousHoldings) {
    for (const cusip of previous.cusips) {
      previousByCusip.set(cusip, previous);
    }
  }

  const latestTotalValue = latestHoldings.reduce((sum, holding) => sum + holding.valueUsdThousands, 0);
  const holdings = latestHoldings
    .map((holding): WhaleManagerAggregateSource["holdings"][number] => {
      const previous = [...holding.cusips].map((cusip) => previousByCusip.get(cusip)).find((entry) => entry !== undefined);
      const matchedPrevious = previous ?? previousByTicker.get(holding.ticker);
      const action = determineAction(holding.valueUsdThousands, matchedPrevious?.valueUsdThousands);
      const weightPct = latestTotalValue > 0 ? (holding.valueUsdThousands / latestTotalValue) * 100 : 0;
      const currentPrice = holding.shares > 0 ? (holding.valueUsdThousands * 1000) / holding.shares : 0;
      const previousCostBasis =
        matchedPrevious && matchedPrevious.shares > 0
          ? (matchedPrevious.valueUsdThousands * 1000) / matchedPrevious.shares
          : undefined;
      const gapPct = previousCostBasis && previousCostBasis > 0 ? ((currentPrice - previousCostBasis) / previousCostBasis) * 100 : null;
      return {
        accession: latestFiling.accession_number,
        ticker: holding.ticker,
        issuerName: holding.issuerName,
        type: action,
        valueUsdThousands: holding.valueUsdThousands,
        shares: holding.shares,
        weightPct,
        cost: previousCostBasis ?? null,
        price: currentPrice,
        gapPct,
        gap_reason: previousCostBasis && previousCostBasis > 0 ? undefined : "no_previous_cost_basis",
        price_timestamp: `${latestFiling.filing_date}T00:00:00.000Z`,
        source: "yahoo",
        calc_version: "top50-bootstrap-v1",
        stale_badge: "fresh"
      };
    })
    .sort((a, b) => b.weightPct - a.weightPct);

  return {
    manager: {
      managerId,
      managerName: institution.institution_name,
      reportPeriod: latestFiling.report_period
    },
    holdings,
    gapRanking: toGapRanking(holdings),
    actionMix: toActionMix(holdings)
  };
}

async function loadWhaleManagerComputedFromSnapshotTables(managerId: string): Promise<WhaleManagerComputed | null> {
  const summaryRows = await fetchSupabaseRows<DbWhaleManagerDirectorySnapshotRow>("whale_manager_directory_snapshot", {
    select: "manager_id,manager_name,institution_name,representative_manager,report_period,latest_filing_date,holdings_count,total_value_usd_thousands,rank,stale",
    manager_id: `eq.${managerId}`,
    limit: "1"
  });

  const summary = summaryRows[0];
  if (!summary) {
    return null;
  }

  const holdingsRows = await fetchSupabaseRows<DbWhaleManagerHoldingsSnapshotRow>("whale_manager_holdings_snapshot", {
    select: "manager_id,manager_name,report_period,accession,ticker,issuer_name,action_type,value_usd_thousands,shares,weight_pct,cost,price,gap_pct,gap_known,gap_reason,price_timestamp,source,calc_version,freshness,stale_reason",
    manager_id: `eq.${managerId}`,
    order: "weight_pct.desc,ticker.asc",
    limit: "5000"
  });

  const holdings: WhaleManagerAggregateSource["holdings"] = holdingsRows.map((row) => {
    const parsedGap = parseNullableNumber(row.gap_pct);

    return {
      accession: row.accession,
      ticker: row.ticker,
      issuerName: row.issuer_name,
      type: toActionType(row.action_type),
      valueUsdThousands: parseNumber(row.value_usd_thousands),
      shares: parseNumber(row.shares),
      weightPct: parseNumber(row.weight_pct),
      cost: parseNullableNumber(row.cost),
      price: parseNumber(row.price),
      gapPct: row.gap_known ? (parsedGap === null ? null : parsedGap * 100) : null,
      gap_reason: row.gap_known ? undefined : (row.gap_reason ?? "no_previous_cost_basis"),
      price_timestamp: row.price_timestamp,
      source: "yahoo",
      calc_version: row.calc_version,
      stale_badge: row.freshness === "stale" ? "stale" : "fresh",
      stale_reason: row.stale_reason ?? undefined
    };
  });

  return {
    manager: {
      managerId: summary.manager_id,
      managerName: summary.manager_name,
      reportPeriod: summary.report_period
    },
    holdings,
    gapRanking: toGapRanking(holdings),
    actionMix: toActionMix(holdings)
  };
}

export async function queryWhaleInsiderManagerBase(
  managerId: string,
  source?: AggregateSourceBundle
): Promise<WhaleManagerComputed> {
  const snapshotBase = await loadWhaleManagerComputedFromSnapshotTables(managerId);
  if (snapshotBase) {
    return snapshotBase;
  }

  const dbSnapshot = await loadDbTop50Snapshot();
  if (dbSnapshot) {
    return buildWhaleManagerComputedFromSnapshot(dbSnapshot, managerId);
  }

  const testSource = resolveTestSource(source);
  if (testSource) {
    const manager = testSource.whales.find((entry) => entry.managerId === managerId);
    if (!manager) {
      throw new Error(`Unknown manager id: ${managerId}`);
    }

    return {
      manager: {
        managerId: manager.managerId,
        managerName: manager.managerName,
        reportPeriod: manager.reportPeriod
      },
      holdings: manager.holdings,
      gapRanking: toGapRanking(manager.holdings),
      actionMix: toActionMix(manager.holdings)
    };
  }

  throw new Error("Whale insider aggregates require Supabase data; runtime seed fallback is disabled.");
}

function buildManagerDirectoryFromSnapshot(dbSnapshot: WhaleDirectorySnapshot) {
  const entries: WhaleManagerDirectoryItemDto[] = [];

  for (const institution of dbSnapshot.topInstitutions) {
    const latestFiling = dbSnapshot.latestFilings.get(institution.id);
    if (!latestFiling) {
      continue;
    }

    const latestRows = dbSnapshot.positionsByFiling.get(latestFiling.id) ?? [];
    const validRows = latestRows.filter(isValidHoldingRow);
    const totalValueUsdThousands = validRows.reduce((sum, row) => sum + row.value_usd_thousands, 0);
    entries.push({
      managerId: toManagerId(institution.cik),
      managerName: institution.institution_name,
      institutionName: institution.institution_name,
      representativeManager: resolveRepresentativeManager({
        institutionName: institution.institution_name,
        institutionRepresentativeManager: institution.representative_manager,
        filingManagerName: latestFiling.filing_manager_name
      }),
      reportPeriod: latestFiling.report_period,
      latestFilingDate: latestFiling.filing_date,
      holdingsCount: validRows.length,
      totalValueUsdThousands,
      rank: entries.length + 1,
      stale: isStaleReportPeriod(latestFiling.report_period)
    });
  }

  return entries;
}

async function loadWhaleDirectoryFromSnapshotTable(): Promise<WhaleManagerDirectoryItemDto[] | null> {
  const rows = await fetchSupabaseRows<DbWhaleManagerDirectorySnapshotRow>("whale_manager_directory_snapshot", {
    select: "manager_id,manager_name,institution_name,representative_manager,report_period,latest_filing_date,holdings_count,total_value_usd_thousands,rank,stale",
    order: "rank.asc,manager_name.asc",
    limit: "100"
  });

  if (rows.length === 0) {
    return null;
  }

  return rows.map((row) => ({
    managerId: row.manager_id,
    managerName: row.manager_name,
    institutionName: row.institution_name,
    representativeManager: row.representative_manager,
    reportPeriod: row.report_period,
    latestFilingDate: row.latest_filing_date,
    holdingsCount: Number(row.holdings_count ?? 0),
    totalValueUsdThousands: parseNumber(row.total_value_usd_thousands),
    rank: Number(row.rank ?? 0),
    stale: Boolean(row.stale)
  }));
}

export async function queryWhaleManagerDirectory(
  source?: AggregateSourceBundle
): Promise<WhaleManagerDirectoryItemDto[]> {
  const snapshotRows = await loadWhaleDirectoryFromSnapshotTable();
  if (snapshotRows) {
    return snapshotRows;
  }

  const dbSnapshot = await loadDbWhaleDirectorySnapshot();
  if (dbSnapshot) {
    return buildManagerDirectoryFromSnapshot(dbSnapshot);
  }

  const testSource = resolveTestSource(source);
  if (testSource) {
    return testSource.whales.slice(0, 50).map((manager, index) => ({
      managerId: manager.managerId,
      managerName: manager.managerName,
      institutionName: manager.institutionName,
      representativeManager: manager.representativeManager,
      reportPeriod: manager.reportPeriod,
      latestFilingDate: manager.reportPeriod,
      holdingsCount: manager.holdings.length,
      totalValueUsdThousands: manager.holdings.reduce((sum, row) => sum + (row.valueUsdThousands ?? 0), 0),
      rank: index + 1,
      stale: false
    }));
  }

  throw new Error("Whale manager directory requires Supabase data; runtime seed fallback is disabled.");
}

export async function queryMarketHubAggregates(
  source?: AggregateSourceBundle
): Promise<MarketHubAggregateDto> {
  let dbSnapshot: Awaited<ReturnType<typeof loadDbTop50Snapshot>>;
  try {
    dbSnapshot = await loadDbTop50Snapshot();
  } catch (error: unknown) {
    if (isSupabaseSnapshotEmptyError(error)) {
      return buildEmptyMarketHubAggregates();
    }

    throw error;
  }

  if (dbSnapshot) {
    const tickerToInstitutions = new Map<string, Set<string>>();
    const latestPositionCandidates: Array<{
      ticker: string;
      accession: string;
      gapPct: number;
      priceTimestamp: string;
      calcVersion: string;
      source: string;
      freshness: "fresh" | "stale";
      staleReason?: string;
      priority: number;
    }> = [];

    for (const institution of dbSnapshot.topInstitutions) {
      const latestFiling = dbSnapshot.latestFilings.get(institution.id);
      if (!latestFiling) {
        continue;
      }

      const rows = dbSnapshot.positionsByFiling.get(latestFiling.id) ?? [];
      const previousFiling = dbSnapshot.previousFilings.get(institution.id);
      const previousRows = previousFiling ? dbSnapshot.positionsByFiling.get(previousFiling.id) ?? [] : [];
      const previousByCusip = new Map(previousRows.map((row) => [row.cusip, row]));
      const previousByTicker = new Map(
        previousRows
          .map((row) => {
            const ticker = resolvePositionTicker(row, dbSnapshot.sectorLookup, dbSnapshot.identityLookup);
            return ticker ? ([ticker, row] as const) : null;
          })
          .filter((entry): entry is readonly [string, DbPositionRow] => entry !== null)
      );
      const uniqueTickers = new Set<string>();
      for (const row of rows) {
        if (!isValidHoldingRow(row)) {
          continue;
        }

        const resolvedTicker = resolvePositionTicker(row, dbSnapshot.sectorLookup, dbSnapshot.identityLookup);
        if (!resolvedTicker) {
          continue;
        }
        uniqueTickers.add(resolvedTicker);

        const metric = dbSnapshot.latestMetricByPositionId.get(row.id);
        if (metric && metric.gap_pct !== null) {
          latestPositionCandidates.push({
            ticker: resolvedTicker,
            accession: latestFiling.accession_number,
            gapPct: metric.gap_pct,
            priceTimestamp: metric.price_timestamp,
            calcVersion: metric.metric_version,
            source: metric.source,
            freshness: metric.is_stale ? "stale" : "fresh",
            staleReason: metric.is_stale ? "stale_price" : undefined,
            priority: 0
          });
          continue;
        }

        const previous = previousByCusip.get(row.cusip) ?? previousByTicker.get(resolvedTicker);
        const currentPrice = row.shares > 0 ? (row.value_usd_thousands * 1000) / row.shares : 0;
        const previousCostBasis = previous && previous.shares > 0 ? (previous.value_usd_thousands * 1000) / previous.shares : undefined;

        if (!previousCostBasis || previousCostBasis <= 0 || currentPrice <= 0) {
          continue;
        }

        const impliedGapPct = ((currentPrice - previousCostBasis) / previousCostBasis) * 100;
        if (!Number.isFinite(impliedGapPct) || impliedGapPct <= -90 || impliedGapPct >= 400) {
          continue;
        }

        latestPositionCandidates.push({
          ticker: resolvedTicker,
          accession: latestFiling.accession_number,
          gapPct: impliedGapPct,
          priceTimestamp: `${latestFiling.filing_date}T00:00:00.000Z`,
          calcVersion: "top50-bootstrap-v1",
          source: "implied-quarter-fallback",
          freshness: "fresh",
          priority: 1
        });
      }

      for (const ticker of uniqueTickers) {
        const owners = tickerToInstitutions.get(ticker) ?? new Set<string>();
        owners.add(institution.id);
        tickerToInstitutions.set(ticker, owners);
      }
    }

    const mostOwned = [...tickerToInstitutions.entries()]
      .map(([ticker, owners]) => ({ ticker, institutionCount: owners.size }))
      .sort((a, b) => b.institutionCount - a.institutionCount)
      .slice(0, 5);

    const computedRotation = computeSectorRotationFromSnapshot(dbSnapshot);
    const sectorFlows = computedRotation.flows;
    const sectorConcentration = buildSectorConcentrationFromSnapshot(dbSnapshot);
    const activeInstitutions = dbSnapshot.topInstitutions.filter((institution) => dbSnapshot.latestFilings.has(institution.id));
    const topNetSector = computeTopNetSectorFromFlows(sectorFlows);
    const highestMarginOfSafety = [...latestPositionCandidates]
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }

        if (a.freshness !== b.freshness) {
          return a.freshness === "fresh" ? -1 : 1;
        }

        return a.gapPct - b.gapPct;
      })
      .at(0);

    return {
      trackedInstitutions: activeInstitutions.length,
      featuredInstitutions: activeInstitutions.slice(0, 5).map((row) => {
        const latestFiling = dbSnapshot.latestFilings.get(row.id);
        return {
          institutionName: row.institution_name,
          representativeManager: resolveRepresentativeManager({
            institutionName: row.institution_name,
            institutionRepresentativeManager: row.representative_manager,
            filingManagerName: latestFiling?.filing_manager_name
          })
        };
      }),
      mostOwned,
      hotSectorMovement: {
        sector: topNetSector?.sector ?? "N/A",
        deltaWeightPct: topNetSector?.netPct ?? 0,
        summary: topNetSector
          ? "Highest net inflow sector based on inferred quarter-over-quarter rotation."
          : "No positive net inflow sector from current inferred rotation."
      },
      highestMarginOfSafety: {
        ticker: highestMarginOfSafety?.ticker ?? "N/A",
        gapPct: highestMarginOfSafety?.gapPct ?? 0,
        accession: highestMarginOfSafety?.accession ?? "missing",
        priceTimestamp: highestMarginOfSafety?.priceTimestamp ?? new Date().toISOString(),
        calcVersion: highestMarginOfSafety?.calcVersion ?? "top50-bootstrap-v1",
        source: highestMarginOfSafety?.source ?? "yahoo",
        freshness: highestMarginOfSafety?.freshness ?? "stale",
        staleReason: highestMarginOfSafety?.staleReason
      },
      sectorRotation: {
        updatedQuarter: computedRotation.updatedQuarter ?? "Not published",
        flows: sectorFlows
      },
      sectorConcentration,
      cashTrend: {
        series: []
      }
    };
  }

  const testSource = resolveTestSource(source);
  if (testSource) {
    const strongestSectorFlow = [...testSource.market.sectorRotation].sort((a, b) => b.weightPct - a.weightPct)[0];
    const allGaps = testSource.whales.flatMap((whale) => whale.holdings);
  const highestMarginOfSafety = [...allGaps].filter((row) => row.gapPct !== null).sort((a, b) => (a.gapPct ?? 0) - (b.gapPct ?? 0))[0];

    return {
      trackedInstitutions: testSource.whales.length,
      featuredInstitutions: testSource.whales.slice(0, 5).map((manager) => ({
        institutionName: manager.institutionName,
        representativeManager: manager.representativeManager
      })),
      mostOwned: testSource.market.mostOwned,
      hotSectorMovement: {
        sector: strongestSectorFlow?.toSector ?? "N/A",
        deltaWeightPct: strongestSectorFlow?.weightPct ?? 0,
        summary: strongestSectorFlow
          ? `Largest quarter flow is ${strongestSectorFlow.fromSector} -> ${strongestSectorFlow.toSector}.`
          : "No flow data available."
      },
      highestMarginOfSafety: {
        ticker: highestMarginOfSafety?.ticker ?? "N/A",
        gapPct: highestMarginOfSafety?.gapPct ?? 0,
        accession: highestMarginOfSafety?.accession ?? "missing",
        priceTimestamp: highestMarginOfSafety?.price_timestamp ?? "",
        calcVersion: highestMarginOfSafety?.calc_version ?? "",
        source: highestMarginOfSafety?.source ?? "unknown",
        freshness: highestMarginOfSafety?.stale_badge ?? "stale",
        staleReason: highestMarginOfSafety?.stale_reason
      },
      sectorRotation: {
        updatedQuarter: testSource.market.updatedQuarter,
        flows: testSource.market.sectorRotation
      },
      sectorConcentration: testSource.market.sectorConcentration,
      cashTrend: {
        series: testSource.market.cashTrend
      }
    };
  }

  throw new Error("Market hub aggregates require Supabase data; runtime seed fallback is disabled.");
}

export async function queryWhaleInsiderAggregates(
  query: WhaleHoldingsQueryParams,
  source?: AggregateSourceBundle
): Promise<WhaleInsiderAggregateDto> {
  const base = await queryWhaleInsiderManagerBase(query.managerId, source);
  return toWhaleInsiderDto(base, query);
}
