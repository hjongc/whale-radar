import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryMarketHubAggregates, queryWhaleInsiderAggregates, queryWhaleManagerDirectory } from "@/lib/data/aggregate-queries";

function buildDataset() {
  const institutions = Array.from({ length: 51 }, (_, index) => {
    const rankSeed = index + 1;
    return {
      id: `inst-${rankSeed}`,
      cik: String(rankSeed).padStart(10, "0"),
      institution_name: `Institution ${String(rankSeed).padStart(2, "0")}`,
      is_priority_cohort: rankSeed <= 10
    };
  });

  const filingsByInstitution = new Map<string, Array<Record<string, string>>>();
  const positionsByFiling = new Map<string, Array<Record<string, string | number | null>>>();
  const identityRows: Array<Record<string, string | number>> = [];
  const sectorRows: Array<Record<string, string | number | null>> = [];

  const toTicker = (seed: number) => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const first = alphabet[(seed - 1) % alphabet.length] ?? "A";
    const second = alphabet[Math.floor((seed - 1) / alphabet.length) % alphabet.length] ?? "A";
    return `T${second}${first}`;
  };

  for (const institution of institutions) {
    const seed = Number(institution.id.replace("inst-", ""));
    const latestId = `${institution.id}-latest`;
    const previousId = `${institution.id}-prev`;
    const cusip = `CUSIP${String(seed).padStart(4, "0")}`.slice(0, 9);
    const ticker = toTicker(seed);
    const latestValue = 10000 - seed;

    filingsByInstitution.set(institution.id, [
      {
        id: latestId,
        institution_id: institution.id,
        accession_number: `0000-${seed}-latest`,
        filing_form_type: "13F-HR",
        filing_date: "2026-02-20",
        report_period: "2025-12-31"
      },
      {
        id: previousId,
        institution_id: institution.id,
        accession_number: `0000-${seed}-prev`,
        filing_form_type: "13F-HR",
        filing_date: "2025-11-15",
        report_period: "2025-09-30"
      }
    ]);

    positionsByFiling.set(latestId, [
      {
        id: `${latestId}-pos-1`,
        filing_id: latestId,
        ticker: null,
        issuer_name: `Issuer ${seed}`,
        cusip,
        value_usd_thousands: latestValue,
        shares: 100
      }
    ]);

    positionsByFiling.set(previousId, [
      {
        id: `${previousId}-pos-1`,
        filing_id: previousId,
        ticker: ticker,
        issuer_name: `Issuer ${seed}`,
        cusip,
        value_usd_thousands: latestValue - 100,
        shares: 100
      }
    ]);

    identityRows.push({
      cusip,
      ticker,
      source: "test",
      source_version: "test-v1",
      confidence: 0.99,
      updated_at: "2026-02-24T00:00:00.000Z"
    });

    sectorRows.push({
      cusip: null,
      ticker,
      sector_code: "45",
      sector_label: "Information Technology",
      confidence: 0.95
    });
  }

  return {
    institutions,
    filingsByInstitution,
    positionsByFiling,
    identityRows,
    sectorRows
  };
}

function parseFilterValues(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  if (raw.startsWith("eq.")) {
    return [raw.slice(3)].filter((value) => value.length > 0);
  }

  if (raw.startsWith("in.(") && raw.endsWith(")")) {
    return raw
      .slice(4, -1)
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  return [];
}

describe("Top-50 DB-path contract", () => {
  const originalEnv = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ENABLE_DB_QUERY_TESTS: process.env.ENABLE_DB_QUERY_TESTS
  };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://example.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    process.env.ENABLE_DB_QUERY_TESTS = "1";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.SUPABASE_SERVICE_ROLE_KEY;
    process.env.ENABLE_DB_QUERY_TESTS = originalEnv.ENABLE_DB_QUERY_TESTS;
    vi.restoreAllMocks();
  });

  it("keeps directory/market universe aligned and resolves ticker via identity map", async () => {
    const dataset = buildDataset();

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").at(-1);

      if (table === "institutions") {
        return new Response(JSON.stringify(dataset.institutions), { status: 200 });
      }

      if (table === "filings") {
        const institutionIds = parseFilterValues(url.searchParams.get("institution_id"));
        const rows = institutionIds.flatMap((institutionId) => dataset.filingsByInstitution.get(institutionId) ?? []);
        return new Response(JSON.stringify(rows), { status: 200 });
      }

      if (table === "positions") {
        const filingIds = parseFilterValues(url.searchParams.get("filing_id"));
        const rows = filingIds.flatMap((filingId) => dataset.positionsByFiling.get(filingId) ?? []);
        return new Response(JSON.stringify(rows), { status: 200 });
      }

      if (table === "derived_metrics") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (table === "security_sector_map") {
        return new Response(JSON.stringify(dataset.sectorRows), { status: 200 });
      }

      if (table === "security_identity_map") {
        return new Response(JSON.stringify(dataset.identityRows), { status: 200 });
      }

      return new Response(JSON.stringify([]), { status: 200 });
    });

    const [directory, market, whale] = await Promise.all([
      queryWhaleManagerDirectory(),
      queryMarketHubAggregates(),
      queryWhaleInsiderAggregates({
        managerId: "cik-0000000001",
        page: 1,
        pageSize: 10,
        action: "ALL"
      })
    ]);

    expect(directory).toHaveLength(50);
    expect(market.trackedInstitutions).toBe(50);
    expect(new Set(directory.map((entry) => entry.managerId)).size).toBe(50);
    expect(whale.holdingsTable.rows.length).toBeGreaterThan(0);
    expect(whale.holdingsTable.rows[0]?.ticker).toBe("TAA");
    expect(market.mostOwned.every((entry) => entry.ticker.length > 0)).toBe(true);
  });

  it("merges duplicate latest holdings that resolve to the same ticker", async () => {
    const dataset = buildDataset();
    const latestFilingId = "inst-1-latest";
    const previousFilingId = "inst-1-prev";

    dataset.positionsByFiling.set(latestFilingId, [
      {
        id: `${latestFilingId}-pos-1`,
        filing_id: latestFilingId,
        ticker: null,
        issuer_name: "Issuer 1",
        cusip: "CUSIP0001",
        value_usd_thousands: 7000,
        shares: 70
      },
      {
        id: `${latestFilingId}-pos-2`,
        filing_id: latestFilingId,
        ticker: "TAA",
        issuer_name: "Issuer 1 Class B",
        cusip: "CUSIPX001",
        value_usd_thousands: 3000,
        shares: 30
      }
    ]);

    dataset.positionsByFiling.set(previousFilingId, [
      {
        id: `${previousFilingId}-pos-1`,
        filing_id: previousFilingId,
        ticker: "TAA",
        issuer_name: "Issuer 1",
        cusip: "CUSIP0001",
        value_usd_thousands: 6000,
        shares: 60
      },
      {
        id: `${previousFilingId}-pos-2`,
        filing_id: previousFilingId,
        ticker: "TAA",
        issuer_name: "Issuer 1 Class B",
        cusip: "CUSIPX001",
        value_usd_thousands: 2000,
        shares: 20
      }
    ]);

    dataset.identityRows.push({
      cusip: "CUSIPX001",
      ticker: "TAA",
      source: "test",
      source_version: "test-v1",
      confidence: 0.99,
      updated_at: "2026-02-24T00:00:00.000Z"
    });

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").at(-1);

      if (table === "institutions") {
        return new Response(JSON.stringify(dataset.institutions), { status: 200 });
      }

      if (table === "filings") {
        const institutionIds = parseFilterValues(url.searchParams.get("institution_id"));
        const rows = institutionIds.flatMap((institutionId) => dataset.filingsByInstitution.get(institutionId) ?? []);
        return new Response(JSON.stringify(rows), { status: 200 });
      }

      if (table === "positions") {
        const filingIds = parseFilterValues(url.searchParams.get("filing_id"));
        const rows = filingIds.flatMap((filingId) => dataset.positionsByFiling.get(filingId) ?? []);
        return new Response(JSON.stringify(rows), { status: 200 });
      }

      if (table === "derived_metrics") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (table === "security_sector_map") {
        return new Response(JSON.stringify(dataset.sectorRows), { status: 200 });
      }

      if (table === "security_identity_map") {
        return new Response(JSON.stringify(dataset.identityRows), { status: 200 });
      }

      return new Response(JSON.stringify([]), { status: 200 });
    });

    const whale = await queryWhaleInsiderAggregates({
      managerId: "cik-0000000001",
      page: 1,
      pageSize: 10,
      action: "ALL"
    });

    expect(whale.holdingsTable.rows).toHaveLength(1);
    expect(whale.holdingsTable.rows[0]).toMatchObject({
      ticker: "TAA",
      valueUsdThousands: 10000,
      shares: 100,
      type: "ADD"
    });
  });

  it("treats non-GICS sector rows as unknown in strict mode", async () => {
    const dataset = buildDataset();
    dataset.sectorRows[0] = {
      cusip: null,
      ticker: "TAA",
      sector_code: "TECH",
      sector_label: "Information Technology",
      source: "test",
      source_version: "test-v1",
      updated_at: "2026-02-24T00:00:00.000Z",
      confidence: 0.95
    };

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").at(-1);

      if (table === "institutions") {
        return new Response(JSON.stringify(dataset.institutions), { status: 200 });
      }

      if (table === "filings") {
        const institutionIds = parseFilterValues(url.searchParams.get("institution_id"));
        const rows = institutionIds.flatMap((institutionId) => dataset.filingsByInstitution.get(institutionId) ?? []);
        return new Response(JSON.stringify(rows), { status: 200 });
      }

      if (table === "positions") {
        const filingIds = parseFilterValues(url.searchParams.get("filing_id"));
        const rows = filingIds.flatMap((filingId) => dataset.positionsByFiling.get(filingId) ?? []);
        return new Response(JSON.stringify(rows), { status: 200 });
      }

      if (table === "derived_metrics") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (table === "security_sector_map") {
        return new Response(JSON.stringify(dataset.sectorRows), { status: 200 });
      }

      if (table === "security_identity_map") {
        return new Response(JSON.stringify(dataset.identityRows), { status: 200 });
      }

      return new Response(JSON.stringify([]), { status: 200 });
    });

    const market = await queryMarketHubAggregates();
    const unclassified = market.sectorConcentration.find((row) => row.sector === "Unclassified");
    expect(unclassified && unclassified.weightPct > 0).toBe(true);
  });

  it("returns an empty market DTO when institutions exist but filings are unavailable", async () => {
    const dataset = buildDataset();

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").at(-1);

      if (table === "institutions") {
        return new Response(JSON.stringify(dataset.institutions), { status: 200 });
      }

      if (table === "filings") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      return new Response(JSON.stringify([]), { status: 200 });
    });

    const market = await queryMarketHubAggregates();
    expect(market).toMatchObject({
      trackedInstitutions: 0,
      featuredInstitutions: [],
      mostOwned: [],
      hotSectorMovement: {
        sector: "N/A",
        deltaWeightPct: 0
      },
      highestMarginOfSafety: {
        ticker: "N/A",
        gapPct: 0,
        accession: "missing",
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
    });
    expect(market.highestMarginOfSafety.priceTimestamp).toEqual(expect.any(String));
  });

  it("builds market hub payload from whale snapshot tables when top50 base snapshot is unavailable", async () => {
    const snapshotDirectoryRows = [
      {
        manager_id: "cik-0000000001",
        manager_name: "Manager One",
        institution_name: "Institution 01",
        representative_manager: "Manager One",
        report_period: "2025-12-31",
        latest_filing_date: "2026-02-20",
        holdings_count: 2,
        total_value_usd_thousands: 12000,
        rank: 1,
        stale: false
      },
      {
        manager_id: "cik-0000000002",
        manager_name: "Manager Two",
        institution_name: "Institution 02",
        representative_manager: "Manager Two",
        report_period: "2025-12-31",
        latest_filing_date: "2026-02-20",
        holdings_count: 2,
        total_value_usd_thousands: 11000,
        rank: 2,
        stale: false
      }
    ];

    const snapshotHoldingRows = [
      {
        manager_id: "cik-0000000001",
        manager_name: "Manager One",
        report_period: "2025-12-31",
        accession: "0000-1-latest",
        ticker: "AAPL",
        issuer_name: "Apple Inc.",
        action_type: "KEEP",
        value_usd_thousands: 8000,
        shares: 80,
        weight_pct: 60,
        cost: 120,
        price: 100,
        gap_pct: -0.1667,
        gap_known: true,
        gap_reason: null,
        price_timestamp: "2026-02-20T00:00:00.000Z",
        source: "yahoo",
        calc_version: "vwap-quarter-v1",
        freshness: "fresh",
        stale_reason: null
      },
      {
        manager_id: "cik-0000000002",
        manager_name: "Manager Two",
        report_period: "2025-12-31",
        accession: "0000-2-latest",
        ticker: "AAPL",
        issuer_name: "Apple Inc.",
        action_type: "ADD",
        value_usd_thousands: 6000,
        shares: 70,
        weight_pct: 55,
        cost: 130,
        price: 100,
        gap_pct: -0.2307,
        gap_known: true,
        gap_reason: null,
        price_timestamp: "2026-02-20T00:00:00.000Z",
        source: "yahoo",
        calc_version: "vwap-quarter-v1",
        freshness: "fresh",
        stale_reason: null
      },
      {
        manager_id: "cik-0000000001",
        manager_name: "Manager One",
        report_period: "2025-12-31",
        accession: "0000-1-latest",
        ticker: "MSFT",
        issuer_name: "Microsoft Corp",
        action_type: "ADD",
        value_usd_thousands: 4000,
        shares: 40,
        weight_pct: 40,
        cost: null,
        price: 100,
        gap_pct: null,
        gap_known: false,
        gap_reason: "no_previous_cost_basis",
        price_timestamp: "2026-02-20T00:00:00.000Z",
        source: "yahoo",
        calc_version: "vwap-quarter-v1",
        freshness: "stale",
        stale_reason: "stale_price"
      }
    ];

    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").at(-1);

      if (table === "institutions" || table === "filings" || table === "positions") {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (table === "whale_manager_directory_snapshot") {
        return new Response(JSON.stringify(snapshotDirectoryRows), { status: 200 });
      }

      if (table === "whale_manager_holdings_snapshot") {
        return new Response(JSON.stringify(snapshotHoldingRows), { status: 200 });
      }

      return new Response(JSON.stringify([]), { status: 200 });
    });

    const market = await queryMarketHubAggregates();
    expect(market.trackedInstitutions).toBe(2);
    expect(market.featuredInstitutions).toHaveLength(2);
    expect(market.mostOwned[0]).toEqual({
      ticker: "AAPL",
      institutionCount: 2
    });
    expect(market.highestMarginOfSafety).toMatchObject({
      ticker: "AAPL",
      accession: "0000-2-latest",
      calcVersion: "vwap-quarter-v1",
      source: "yahoo",
      freshness: "fresh"
    });
    expect(market.highestMarginOfSafety.gapPct).toBeCloseTo(-23.07, 2);
    expect(market.sectorRotation).toEqual({
      updatedQuarter: "2025Q4",
      flows: []
    });
  });
});
