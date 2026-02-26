#!/usr/bin/env node

import { execSync } from "node:child_process";

const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_whaleinsight-pro-mvp";
const DB_NAME = process.env.SUPABASE_DB_NAME ?? "postgres";
const DB_USER = process.env.SUPABASE_DB_USER ?? "postgres";
const OPENFIGI_API_KEY = process.env.OPENFIGI_API_KEY ?? "";
const OPENFIGI_BASE_URL = process.env.OPENFIGI_BASE_URL ?? "https://api.openfigi.com";
const REQUEST_DELAY_MS = Number(process.env.OPENFIGI_REQUEST_DELAY_MS ?? "250");
const BATCH_SIZE = Number(process.env.CUSIP_BATCH_SIZE ?? "250");
const SOURCE_VERSION = process.env.IDENTITY_SOURCE_VERSION ?? "openfigi-cusip-v1";
const DRY_RUN = process.argv.includes("--dry-run");

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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeCusip(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeTicker(value) {
  return String(value ?? "").trim().toUpperCase();
}

function isValidCusip(value) {
  return /^[A-Z0-9]{8,9}$/.test(value);
}

function isValidTicker(value) {
  return /^[A-Z.]{1,10}$/.test(value);
}

function fetchDistinctCusips() {
  const raw = runPsql(`
select upper(p.cusip)
from public.positions p
join public.filings f on f.id = p.filing_id
where p.cusip is not null
  and f.filing_form_type in ('13F-HR','13F-HR/A')
group by upper(p.cusip)
order by upper(p.cusip);
`);

  if (!raw) {
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(normalizeCusip)
    .filter(isValidCusip);
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
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)) {
    const [cusip = "", ticker = ""] = line.split("\t");
    const normalizedCusip = normalizeCusip(cusip);
    const normalizedTicker = normalizeTicker(ticker);
    if (!isValidCusip(normalizedCusip) || !isValidTicker(normalizedTicker)) {
      continue;
    }

    byCusip.set(normalizedCusip, normalizedTicker);
  }

  return byCusip;
}

async function resolveTickerByCusip(cusip) {
  const url = new URL("/v3/mapping", OPENFIGI_BASE_URL);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (OPENFIGI_API_KEY) {
    headers["X-OPENFIGI-APIKEY"] = OPENFIGI_API_KEY;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify([
      {
        idType: "ID_CUSIP",
        idValue: cusip,
        marketSecDes: "Equity"
      }
    ])
  });

  if (!response.ok) {
    throw new Error(`OpenFIGI HTTP ${response.status}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : [];
  const first = rows[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    return null;
  }

  if (typeof first.error === "string" && first.error.length > 0) {
    throw new Error(`OpenFIGI mapping error: ${first.error}`);
  }

  const matches = Array.isArray(first.data) ? first.data : [];
  const equityCandidate =
    matches.find((item) => item && typeof item === "object" && typeof item.ticker === "string" && item.exchCode === "US") ??
    matches.find((item) => item && typeof item === "object" && typeof item.ticker === "string");
  if (!equityCandidate || typeof equityCandidate !== "object") {
    return null;
  }

  const symbol = equityCandidate.ticker;
  if (typeof symbol !== "string") {
    return null;
  }

  const normalized = normalizeTicker(symbol);
  return isValidTicker(normalized) ? normalized : null;
}

function replaceActiveIdentityMapping(cusip, ticker, source, sourceVersion) {
  const sql = `
with deactivated as (
  update public.security_identity_map
  set
    is_active = false,
    effective_to = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where cusip = ${sqlLiteral(cusip)}
    and is_active = true
), inserted as (
  insert into public.security_identity_map (
    cusip,
    ticker,
    source,
    source_version,
    confidence,
    effective_from,
    is_active
  )
  values (
    ${sqlLiteral(cusip)},
    ${sqlLiteral(ticker)},
    ${sqlLiteral(source)},
    ${sqlLiteral(sourceVersion)},
    0.95,
    timezone('utc', now()),
    true
  )
  returning id
)
select (select count(*) from deactivated), (select count(*) from inserted);
`;

  const [deactivatedText = "0", insertedText = "0"] = runPsql(sql).split("\t");
  return {
    deactivated: Number(deactivatedText) || 0,
    inserted: Number(insertedText) || 0
  };
}

async function main() {
  const allCusips = fetchDistinctCusips();
  const activeMap = fetchActiveIdentityMap();
  const unresolved = allCusips.filter((cusip) => !activeMap.has(cusip));

  console.log(`Distinct CUSIPs: ${allCusips.length}`);
  console.log(`Active identity rows: ${activeMap.size}`);
  console.log(`Unresolved CUSIPs: ${unresolved.length}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Mode: ${DRY_RUN ? "dry-run" : "live"}`);

  let scanned = 0;
  let inserted = 0;
  let deactivated = 0;
  let skipped = 0;
  let failed = 0;
  let authFailed = false;

  for (let offset = 0; offset < unresolved.length; offset += BATCH_SIZE) {
    const batch = unresolved.slice(offset, offset + BATCH_SIZE);

    for (const cusip of batch) {
      scanned += 1;

      try {
        const ticker = await resolveTickerByCusip(cusip);
        if (!ticker) {
          skipped += 1;
          continue;
        }

        if (DRY_RUN) {
          continue;
        }

        const result = replaceActiveIdentityMapping(cusip, ticker, "openfigi", SOURCE_VERSION);
        inserted += result.inserted;
        deactivated += result.deactivated;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed ${cusip}: ${message}`);

        if (message.includes("HTTP 401")) {
          authFailed = true;
          console.warn("Aborting run after provider authentication failure.");
          break;
        }
      }

      if (REQUEST_DELAY_MS > 0) {
        await sleep(REQUEST_DELAY_MS);
      }
    }

    if (authFailed) {
      break;
    }

    console.log(`Processed ${Math.min(offset + BATCH_SIZE, unresolved.length)}/${unresolved.length}`);
  }

  console.log("CUSIP->ticker enrichment complete.");
  console.log(`scanned=${scanned}`);
  console.log(`inserted=${inserted}`);
  console.log(`deactivated=${deactivated}`);
  console.log(`skipped=${skipped}`);
  console.log(`failed=${failed}`);

  if (authFailed) {
    process.exitCode = 1;
  }
}

main();
