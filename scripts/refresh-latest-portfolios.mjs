#!/usr/bin/env node

const DEFAULT_SUPABASE_URL = "http://127.0.0.1:54321";
const FORM_WHITELIST = new Set(["13F-HR", "13F-HR/A"]);
const MAX_FILINGS_PER_INSTITUTION = 2;
const SEC_BASE = "https://data.sec.gov";
const SEC_ARCHIVE_BASE = "https://www.sec.gov/Archives/edgar/data";

function parseCliArgs(argv) {
  const args = {
    limit: undefined,
    startAt: 0,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--limit") {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("--limit must be a positive number");
      }
      args.limit = Math.floor(value);
      i += 1;
      continue;
    }
    if (token === "--start-at") {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("--start-at must be zero or a positive number");
      }
      args.startAt = Math.floor(value);
      i += 1;
      continue;
    }
  }

  return args;
}

function resolveConfig() {
  const baseUrl =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    DEFAULT_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!serviceRoleKey) {
    throw new Error("Missing Supabase key. Set SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return {
    supabaseUrl: baseUrl.replace(/\/$/, ""),
    serviceRoleKey,
    secUserAgent:
      process.env.SEC_USER_AGENT ??
      "guru-catcher-refresh/1.0 (research@local.dev)"
  };
}

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithRetry(url, init, retries = 3) {
  let attempt = 0;
  let lastError;
  while (attempt <= retries) {
    try {
      const response = await fetch(url, init);
      if (!response.ok && (response.status === 429 || response.status >= 500)) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        throw lastError;
      }
      const backoff = 400 * 2 ** attempt;
      await sleep(backoff);
      attempt += 1;
    }
  }

  throw lastError ?? new Error("Unknown fetch error");
}

function decodeXmlText(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function extractTag(xml, tagName) {
  const pattern = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`, "i");
  const match = pattern.exec(xml);
  return match && match[1] ? decodeXmlText(match[1]) : undefined;
}

function parseNumeric(raw) {
  if (!raw) {
    return undefined;
  }
  const parsed = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseInfoTableRows(xml) {
  const rows = [];
  const rowPattern = /<(?:\w+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  let rowMatch = rowPattern.exec(xml);
  let rowNumber = 1;

  while (rowMatch) {
    const rowXml = rowMatch[1] ?? "";
    const issuerName = extractTag(rowXml, "nameOfIssuer");
    const classTitle = extractTag(rowXml, "titleOfClass") ?? null;
    const cusipRaw = extractTag(rowXml, "cusip");
    const valueUsdThousands = parseNumeric(extractTag(rowXml, "value"));
    const sharesContainer = extractTag(rowXml, "shrsOrPrnAmt") ?? rowXml;
    const shares = parseNumeric(extractTag(sharesContainer, "sshPrnamt"));
    const tickerRaw = extractTag(rowXml, "symbol");

    const cusip = cusipRaw ? cusipRaw.replace(/\s+/g, "").toUpperCase() : "";
    const ticker = tickerRaw ? tickerRaw.trim().toUpperCase() : null;

    if (
      issuerName &&
      cusip &&
      /^[A-Z0-9]{8,9}$/.test(cusip) &&
      Number.isFinite(valueUsdThousands) &&
      Number.isFinite(shares)
    ) {
      rows.push({
        row_number: rowNumber,
        issuer_name: issuerName,
        class_title: classTitle,
        cusip,
        ticker: ticker && /^[A-Z.]{1,10}$/.test(ticker) ? ticker : null,
        value_usd_thousands: Number(valueUsdThousands.toFixed(2)),
        shares: Number(shares.toFixed(4)),
        share_type: "SH",
        investment_discretion: "SOLE",
        voting_sole: 0,
        voting_shared: 0,
        voting_none: 0
      });
    }

    rowNumber += 1;
    rowMatch = rowPattern.exec(xml);
  }

  return rows;
}

function pickLatestTargetFilings(submissions) {
  const recent = submissions && submissions.filings && submissions.filings.recent;
  if (!recent || !Array.isArray(recent.form) || !Array.isArray(recent.accessionNumber)) {
    return [];
  }

  const seenReportPeriods = new Set();
  const picked = [];

  for (let i = 0; i < recent.form.length; i += 1) {
    const form = recent.form[i];
    if (!FORM_WHITELIST.has(form)) {
      continue;
    }

    const accessionNumber = recent.accessionNumber[i];
    const reportDate = recent.reportDate?.[i];
    const filingDate = recent.filingDate?.[i];
    const acceptanceDateTime = recent.acceptanceDateTime?.[i];
    const isAmendment = form === "13F-HR/A";

    let amendsAccessionNumber = null;
    if (isAmendment) {
      const originalIndex = recent.form.findIndex(
        (candidateForm, index) =>
          candidateForm === "13F-HR" && recent.reportDate?.[index] === reportDate && recent.accessionNumber?.[index] !== accessionNumber
      );
      if (originalIndex >= 0) {
        amendsAccessionNumber = recent.accessionNumber?.[originalIndex] ?? null;
      }
    }

    if (!accessionNumber || !reportDate || !filingDate) {
      continue;
    }
    if (seenReportPeriods.has(reportDate)) {
      continue;
    }

    seenReportPeriods.add(reportDate);
    picked.push({
      accessionNumber,
      form,
      isAmendment,
      amendsAccessionNumber,
      reportDate,
      filingDate,
      acceptanceDateTime
    });

    if (picked.length >= MAX_FILINGS_PER_INSTITUTION) {
      break;
    }
  }

  return picked;
}

function isStaleReportPeriod(reportDate, maxAgeDays = 220) {
  const parsed = new Date(`${reportDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }
  const ageDays = (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > maxAgeDays;
}

async function supabaseRest(config, path, options = {}) {
  const response = await fetchWithRetry(`${config.supabaseUrl}/rest/v1/${path}`, {
    method: options.method ?? "GET",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase REST ${response.status}: ${errorText}`);
  }

  const text = await response.text();
  if (!text) {
    return [];
  }

  const json = JSON.parse(text);
  return Array.isArray(json) ? json : [json];
}

async function fetchSecJson(config, url) {
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": config.secUserAgent,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`SEC ${response.status} for ${url}`);
  }
  return response.json();
}

async function fetchSecText(config, url) {
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": config.secUserAgent,
      Accept: "application/xml,text/xml,text/plain"
    }
  });
  if (!response.ok) {
    throw new Error(`SEC ${response.status} for ${url}`);
  }
  return response.text();
}

async function listArchiveFiles(config, cikNoLeadingZero, accessionNoDash, prefix = "") {
  const indexUrl = `${SEC_ARCHIVE_BASE}/${cikNoLeadingZero}/${accessionNoDash}${prefix ? `/${prefix}` : ""}/index.json`;
  const payload = await fetchSecJson(config, indexUrl);
  const items = payload?.directory?.item;
  if (!Array.isArray(items)) {
    return [];
  }

  const files = [];
  for (const item of items) {
    const name = typeof item?.name === "string" ? item.name : "";
    const type = typeof item?.type === "string" ? item.type : "";
    if (!name) {
      continue;
    }

    const nextPath = prefix ? `${prefix}/${name}` : name;
    if (type.toLowerCase() === "dir") {
      const nested = await listArchiveFiles(config, cikNoLeadingZero, accessionNoDash, nextPath);
      files.push(...nested);
      continue;
    }

    files.push(nextPath);
  }

  return files;
}

function pickInformationTableFilename(filePaths) {
  const preferred = filePaths.find((path) => /info.?table|information.?table/i.test(path) && /\.xml$/i.test(path));
  if (preferred) {
    return preferred;
  }

  const canonical = filePaths.find((path) => /form13f/i.test(path) && /\.xml$/i.test(path));
  if (canonical) {
    return canonical;
  }

  return filePaths.find((path) => /\.xml$/i.test(path));
}

async function upsertFiling(config, filingRow) {
  const rows = await supabaseRest(
    config,
    "filings?on_conflict=accession_number&select=id,accession_number",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: filingRow
    }
  );

  if (!rows[0]?.id) {
    throw new Error(`Failed to upsert filing ${filingRow.accession_number}`);
  }

  return rows[0].id;
}

async function upsertPositions(config, filingId, positions) {
  const chunkSize = 500;
  let upserted = 0;

  for (let offset = 0; offset < positions.length; offset += chunkSize) {
    const chunk = positions.slice(offset, offset + chunkSize).map((row) => ({
      filing_id: filingId,
      ...row
    }));

    await supabaseRest(config, "positions?on_conflict=filing_id,row_number", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: chunk
    });

    upserted += chunk.length;
  }

  return upserted;
}

async function refreshWhaleSnapshots(config) {
  const rows = await supabaseRest(config, "rpc/refresh_whale_snapshot_tables", {
    method: "POST",
    body: {}
  });

  return rows[0] ?? null;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const config = resolveConfig();

  const institutions = await supabaseRest(config, "institutions?select=id,cik,institution_name&order=institution_name.asc&limit=5000");
  const selected = institutions.slice(args.startAt, args.limit ? args.startAt + args.limit : undefined);

  const summary = {
    institutionsProcessed: 0,
    filingsUpserted: 0,
    positionsUpserted: 0,
    institutionsFailed: 0
  };

  console.log(
    `[start] institutions=${selected.length} dryRun=${args.dryRun} startAt=${args.startAt} limit=${args.limit ?? "all"}`
  );

  for (const institution of selected) {
    summary.institutionsProcessed += 1;

    try {
      const cik = String(institution.cik).padStart(10, "0");
      const secSubmissionsUrl = `${SEC_BASE}/submissions/CIK${cik}.json`;
      const submissions = await fetchSecJson(config, secSubmissionsUrl);
      const targetFilings = pickLatestTargetFilings(submissions);

      if (targetFilings.length === 0) {
        console.log(`[skip] ${institution.institution_name} (${cik}) no 13F-HR/HR-A in submissions.recent`);
        continue;
      }

      for (const filing of targetFilings) {
        const cikNoLeadingZero = String(Number(cik));
        const accessionNoDash = filing.accessionNumber.replace(/-/g, "");
        const archiveFiles = await listArchiveFiles(config, cikNoLeadingZero, accessionNoDash);
        const infoTableName = pickInformationTableFilename(archiveFiles);

        if (!infoTableName) {
          console.log(`[skip] ${filing.accessionNumber} missing XML information table`);
          continue;
        }

        const infoTableUrl = `${SEC_ARCHIVE_BASE}/${cikNoLeadingZero}/${accessionNoDash}/${infoTableName}`;
        const infoTableXml = await fetchSecText(config, infoTableUrl);
        let parsedRows = parseInfoTableRows(infoTableXml);

        if (parsedRows.length === 0) {
          const xmlCandidates = archiveFiles.filter((path) => /\.xml$/i.test(path) && path !== infoTableName);
          for (const fallbackPath of xmlCandidates) {
            const fallbackUrl = `${SEC_ARCHIVE_BASE}/${cikNoLeadingZero}/${accessionNoDash}/${fallbackPath}`;
            const fallbackXml = await fetchSecText(config, fallbackUrl);
            const fallbackRows = parseInfoTableRows(fallbackXml);
            if (fallbackRows.length > 0) {
              parsedRows = fallbackRows;
              break;
            }
          }
        }

        if (parsedRows.length === 0) {
          console.log(`[skip] ${filing.accessionNumber} parsed 0 holdings from ${infoTableName}`);
          continue;
        }

        const filingRow = {
          institution_id: institution.id,
          accession_number: filing.accessionNumber,
          filing_form_type: filing.form,
          filing_date: filing.filingDate,
          report_period: filing.reportDate,
          filed_at: filing.acceptanceDateTime ?? null,
          acceptance_datetime: filing.acceptanceDateTime ?? null,
          filing_manager_name: submissions.name ?? institution.institution_name,
          filing_manager_cik: cik,
          is_amendment: filing.isAmendment,
          is_notice: false,
          amends_accession_number: filing.amendsAccessionNumber,
          raw_payload: {
            source: "sec-refresh",
            info_table_file: infoTableName,
            refreshed_at: new Date().toISOString()
          },
          source_url: `${SEC_ARCHIVE_BASE}/${cikNoLeadingZero}/${accessionNoDash}/`
        };

        if (args.dryRun) {
          console.log(`[dry-run] ${institution.institution_name} ${filing.accessionNumber} rows=${parsedRows.length}`);
          continue;
        }

        if (filing.isAmendment && !filing.amendsAccessionNumber) {
          console.log(
            `[skip] ${filing.accessionNumber} missing amends accession for 13F-HR/A; cannot satisfy DB amendment constraint`
          );
          continue;
        }

        const filingId = await upsertFiling(config, filingRow);
        summary.filingsUpserted += 1;
        const upsertedPositions = await upsertPositions(config, filingId, parsedRows);
        summary.positionsUpserted += upsertedPositions;

        console.log(
          `[ok] ${institution.institution_name} ${filing.accessionNumber} report=${filing.reportDate} holdings=${parsedRows.length}`
        );

        if (isStaleReportPeriod(filing.reportDate)) {
          console.log(
            `[warn] ${institution.institution_name} ${filing.accessionNumber} is stale report period=${filing.reportDate}`
          );
        }

        await sleep(150);
      }
    } catch (error) {
      summary.institutionsFailed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[error] ${institution.institution_name} (${institution.cik}) ${message}`);
    }
  }

  console.log("[done]", summary);

  if (!args.dryRun) {
    try {
      const snapshotResult = await refreshWhaleSnapshots(config);
      console.log("[snapshots] refreshed whale snapshots", snapshotResult ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[warn] whale snapshot refresh failed: ${message}`);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[fatal]", message);
  process.exitCode = 1;
});
