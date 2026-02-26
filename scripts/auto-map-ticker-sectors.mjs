#!/usr/bin/env node

import { execSync } from "node:child_process";

const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_whaleinsight-pro-mvp";
const DB_NAME = process.env.SUPABASE_DB_NAME ?? "postgres";
const DB_USER = process.env.SUPABASE_DB_USER ?? "postgres";
const YAHOO_BASE_URL = process.env.YAHOO_BASE_URL ?? "https://query2.finance.yahoo.com";
const REQUEST_DELAY_MS = Number(process.env.SECTOR_REQUEST_DELAY_MS ?? "250");
const SOURCE_VERSION = process.env.SECTOR_SOURCE_VERSION ?? "yahoo-asset-profile-v1";
const DRY_RUN = process.argv.includes("--dry-run");
const MAX_FAILURE_PREVIEW = 30;

const GICS_SECTORS = new Map([
  ["communicationservices", { code: "50", label: "Communication Services" }],
  ["consumerdiscretionary", { code: "25", label: "Consumer Discretionary" }],
  ["consumerstaples", { code: "30", label: "Consumer Staples" }],
  ["energy", { code: "10", label: "Energy" }],
  ["financials", { code: "40", label: "Financials" }],
  ["healthcare", { code: "35", label: "Health Care" }],
  ["industrials", { code: "20", label: "Industrials" }],
  ["informationtechnology", { code: "45", label: "Information Technology" }],
  ["materials", { code: "15", label: "Materials" }],
  ["realestate", { code: "60", label: "Real Estate" }],
  ["utilities", { code: "55", label: "Utilities" }]
]);

function run(command) {
  return execSync(command, { encoding: "utf8" }).trim();
}

function runPsql(sql) {
  const escapedSql = sql.replaceAll('"', '\\"');
  const command = `docker exec -i ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -At -F $'\\t' -c "${escapedSql}"`;
  return run(command);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizeSector(value) {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  return GICS_SECTORS.get(normalized) ?? null;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchYahooAssetProfile(ticker) {
  const url = new URL(`/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`, YAHOO_BASE_URL);
  url.searchParams.set("modules", "assetProfile");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo HTTP ${response.status} for ${ticker}`);
  }

  const payload = await response.json();
  const result = payload?.quoteSummary?.result;
  if (!Array.isArray(result) || result.length === 0) {
    return null;
  }

  const first = result[0] ?? null;
  if (!first || typeof first !== "object") {
    return null;
  }

  return first.assetProfile ?? null;
}

function fetchCandidateSecurities() {
  const sql = `
with target_periods as (
  select report_period
  from public.filings
  where filing_form_type in ('13F-HR','13F-HR/A')
  group by report_period
  order by report_period desc
  limit 2
)
select
  upper(p.ticker) as ticker,
  upper(p.cusip) as cusip
from public.positions p
join public.filings f on f.id = p.filing_id
where (p.ticker is not null or p.cusip is not null)
  and f.report_period in (select report_period from target_periods)
group by upper(p.ticker), upper(p.cusip)
order by upper(p.ticker), upper(p.cusip);
`;

  const raw = runPsql(sql);
  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => {
      const [tickerRaw = "", cusipRaw = ""] = value.split("\t");
      const ticker = tickerRaw.trim();
      const cusip = cusipRaw.trim();

      return {
        ticker: ticker.length > 0 ? ticker : null,
        cusip: cusip.length > 0 ? cusip : null
      };
    });
}

function fetchMappedKeys() {
  const raw = runPsql(`
select upper(ticker), upper(cusip)
from public.security_sector_map
where is_active = true
  and coalesce(sector_label, '') not in ('Unknown', 'Unclassified')
  and coalesce(sector_code, '') not in ('UNKNOWN', 'UNCLASSIFIED');
`);

  if (!raw) {
    return {
      tickerSet: new Set(),
      cusipSet: new Set()
    };
  }

  const tickerSet = new Set();
  const cusipSet = new Set();

  for (const line of raw
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)) {
    const [tickerRaw = "", cusipRaw = ""] = line.split("\t");
    const ticker = tickerRaw.trim();
    const cusip = cusipRaw.trim();
    if (ticker.length > 0) {
      tickerSet.add(ticker);
    }

    if (cusip.length > 0) {
      cusipSet.add(cusip);
    }
  }

  return {
    tickerSet,
    cusipSet
  };
}

function fetchActiveIdentityMap() {
  const raw = runPsql(`
select upper(cusip), upper(ticker)
from public.security_identity_map
where is_active = true;
`);

  const byCusip = new Map();
  if (!raw) {
    return byCusip;
  }

  for (const line of raw
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)) {
    const [cusip = "", ticker = ""] = line.split("\t");
    if (cusip && ticker) {
      byCusip.set(cusip, ticker);
    }
  }

  return byCusip;
}

function upsertSecuritySector({ ticker, cusip, sectorCode, sectorLabel, provider, sourceVersion, confidence }) {
  const tickerSql = ticker ? sqlLiteral(ticker) : "null";
  const cusipSql = cusip ? sqlLiteral(cusip) : "null";
  const sql = `
with updated as (
  update public.security_sector_map s
  set
    ticker = coalesce(${tickerSql}, s.ticker),
    cusip = coalesce(${cusipSql}, s.cusip),
    sector_code = ${sqlLiteral(sectorCode)},
    sector_label = ${sqlLiteral(sectorLabel)},
    source = ${sqlLiteral(provider)},
    source_version = ${sqlLiteral(sourceVersion)},
    confidence = ${Number(confidence).toFixed(2)},
    updated_at = timezone('utc', now())
  where s.is_active = true
    and (
      (${cusipSql} is not null and s.cusip = ${cusipSql})
      or (${tickerSql} is not null and s.ticker = ${tickerSql})
    )
  returning s.ticker
), inserted as (
  insert into public.security_sector_map (
    ticker,
    cusip,
    sector_code,
    sector_label,
    source,
    source_version,
    confidence,
    is_active
  )
  select
    ${tickerSql},
    ${cusipSql},
    ${sqlLiteral(sectorCode)},
    ${sqlLiteral(sectorLabel)},
    ${sqlLiteral(provider)},
    ${sqlLiteral(sourceVersion)},
    ${Number(confidence).toFixed(2)},
    true
  where not exists (
    select 1 from public.security_sector_map s
    where s.is_active = true
      and (
        (${cusipSql} is not null and s.cusip = ${cusipSql})
        or (${tickerSql} is not null and s.ticker = ${tickerSql})
      )
  )
  returning ticker
)
select (select count(*) from updated), (select count(*) from inserted);
`;

  return runPsql(sql);
}

function printDistribution() {
  const distribution = runPsql(`
with mapped as (
  select sector_label, count(*) as cnt
  from public.security_sector_map
  where is_active = true and ticker is not null
  group by sector_label
)
select sector_label, cnt
from mapped
order by cnt desc;
`);

  console.log("Ticker mapping distribution:");
  console.log(distribution || "(no rows)");
}

async function main() {
  const candidates = fetchCandidateSecurities();
  const mapped = fetchMappedKeys();
  const identityByCusip = fetchActiveIdentityMap();
  const unresolved = candidates.filter(({ ticker, cusip }) => {
    const tickerMapped = ticker ? mapped.tickerSet.has(ticker) : false;
    const cusipMapped = cusip ? mapped.cusipSet.has(cusip) : false;
    return !tickerMapped && !cusipMapped;
  });

  console.log(`Candidate securities (latest 2 quarters): ${candidates.length}`);
  console.log(`Already mapped tickers: ${mapped.tickerSet.size}`);
  console.log(`Already mapped CUSIPs: ${mapped.cusipSet.size}`);
  console.log(`Securities to classify via Yahoo: ${unresolved.length}`);
  console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"}`);

  let inserted = 0;
  let updated = 0;
  let unresolvedCount = 0;
  const failures = [];

  for (const security of unresolved) {
    const ticker = security.ticker;
    const cusip = security.cusip;
    const identity = ticker ?? cusip ?? "(missing-id)";

    try {
      let resolvedTicker = ticker;

      if (!resolvedTicker && cusip) {
        resolvedTicker = identityByCusip.get(cusip) ?? null;
      }

      if (!resolvedTicker) {
        unresolvedCount += 1;
        console.warn(`No resolvable ticker for ${identity}.`);
        continue;
      }

      const profile = await fetchYahooAssetProfile(resolvedTicker);
      const sector = normalizeSector(profile?.sector);

      if (!sector) {
        unresolvedCount += 1;
        console.warn(`No mappable GICS sector for ${identity} (provider sector=${profile?.sector ?? "n/a"}).`);
      } else if (!DRY_RUN) {
        const counts = upsertSecuritySector({
          ticker: resolvedTicker,
          cusip,
            sectorCode: sector.code,
            sectorLabel: sector.label,
            provider: "yahoo-quote-summary",
            sourceVersion: SOURCE_VERSION,
            confidence: 0.95
          });

        const [updatedRowsText = "0", insertedRowsText = "0"] = counts.split("\t");
        const updatedRows = Number(updatedRowsText) || 0;
        const insertedRows = Number(insertedRowsText) || 0;
        updated += updatedRows;
        inserted += insertedRows;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ security: identity, message });
      console.warn(`Failed to classify ${identity}: ${message}`);
    }

    if (REQUEST_DELAY_MS > 0) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log("GICS sync complete.");
  console.log(`Inserted rows: ${inserted}`);
  console.log(`Updated rows: ${updated}`);
  console.log(`Unresolved securities: ${unresolvedCount}`);
  console.log(`Failed securities: ${failures.length}`);

  if (failures.length > 0) {
    const preview = failures
      .slice(0, MAX_FAILURE_PREVIEW)
      .map(({ security, message }) => `${security}: ${message}`)
      .join("\n");
    console.log("Failure preview:");
    console.log(preview);
  }

  if (!DRY_RUN) {
    printDistribution();
  }
}

main();
