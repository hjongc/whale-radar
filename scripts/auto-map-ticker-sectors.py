#!/usr/bin/env python3

import os
import random
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple

try:
    import yfinance as yf
except ImportError as exc:
    raise SystemExit(
        "Missing dependency: yfinance. Install with: pip install yfinance requests pandas tqdm"
    ) from exc


DB_CONTAINER = os.getenv("SUPABASE_DB_CONTAINER", "supabase_db_whaleinsight-pro-mvp")
DB_NAME = os.getenv("SUPABASE_DB_NAME", "postgres")
DB_USER = os.getenv("SUPABASE_DB_USER", "postgres")

DRY_RUN = "--dry-run" in sys.argv
MAX_FAILURE_PREVIEW = 30
MAX_WORKERS = max(1, int(os.getenv("YF_MAX_WORKERS", "4")))
REQUEST_DELAY_MS = max(100, int(os.getenv("YF_REQUEST_DELAY_MS", "350")))
RETRY_MAX = max(1, int(os.getenv("YF_RETRY_MAX", "5")))
SOURCE_VERSION = os.getenv("SECTOR_SOURCE_VERSION", "yfinance-info-v1")
SYMBOL_LIMIT = max(0, int(os.getenv("YF_SYMBOL_LIMIT", "0")))


GICS_SECTORS = {
    "communication services": ("50", "Communication Services"),
    "consumer cyclical": ("25", "Consumer Discretionary"),
    "consumer defensive": ("30", "Consumer Staples"),
    "energy": ("10", "Energy"),
    "financial services": ("40", "Financials"),
    "healthcare": ("35", "Health Care"),
    "industrials": ("20", "Industrials"),
    "technology": ("45", "Information Technology"),
    "basic materials": ("15", "Materials"),
    "real estate": ("60", "Real Estate"),
    "utilities": ("55", "Utilities"),
}


@dataclass
class CandidateSecurity:
    ticker: Optional[str]
    cusip: Optional[str]


def run(command: List[str], stdin_text: Optional[str] = None) -> str:
    completed = subprocess.run(
        command,
        input=stdin_text,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            completed.stderr.strip() or f"Command failed: {' '.join(command)}"
        )
    return completed.stdout.strip()


def run_psql(sql: str) -> str:
    return run(
        [
            "docker",
            "exec",
            "-i",
            DB_CONTAINER,
            "psql",
            "-U",
            DB_USER,
            "-d",
            DB_NAME,
            "-At",
            "-F",
            "\t",
            "-c",
            sql,
        ]
    )


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def normalize_sector(raw: Optional[str]) -> Optional[Tuple[str, str]]:
    if not raw:
        return None
    key = raw.strip().lower()
    return GICS_SECTORS.get(key)


def fetch_candidate_securities() -> List[CandidateSecurity]:
    sql = """
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
"""
    raw = run_psql(sql)
    if not raw:
        return []

    rows: List[CandidateSecurity] = []
    for line in raw.splitlines():
        ticker_raw, cusip_raw = (line.split("\t") + [""])[:2]
        ticker = ticker_raw.strip() or None
        cusip = cusip_raw.strip() or None
        rows.append(CandidateSecurity(ticker=ticker, cusip=cusip))
    return rows


def fetch_mapped_keys() -> Tuple[Set[str], Set[str]]:
    sql = """
select upper(ticker), upper(cusip)
from public.security_sector_map
where is_active = true;
"""
    raw = run_psql(sql)
    ticker_set: Set[str] = set()
    cusip_set: Set[str] = set()
    if not raw:
        return ticker_set, cusip_set

    for line in raw.splitlines():
        ticker_raw, cusip_raw = (line.split("\t") + [""])[:2]
        ticker = ticker_raw.strip()
        cusip = cusip_raw.strip()
        if ticker:
            ticker_set.add(ticker)
        if cusip:
            cusip_set.add(cusip)
    return ticker_set, cusip_set


def fetch_active_identity_map() -> Dict[str, str]:
    sql = """
select upper(cusip), upper(ticker)
from public.security_identity_map
where is_active = true;
"""
    raw = run_psql(sql)
    by_cusip: Dict[str, str] = {}
    if not raw:
        return by_cusip

    for line in raw.splitlines():
        cusip_raw, ticker_raw = (line.split("\t") + [""])[:2]
        cusip = cusip_raw.strip()
        ticker = ticker_raw.strip()
        if cusip and ticker:
            by_cusip[cusip] = ticker
    return by_cusip


def upsert_security_sector(
    ticker: Optional[str],
    cusip: Optional[str],
    sector_code: str,
    sector_label: str,
    confidence: float,
) -> Tuple[int, int]:
    ticker_sql = sql_literal(ticker) if ticker else "null"
    cusip_sql = sql_literal(cusip) if cusip else "null"

    sql = f"""
with updated as (
  update public.security_sector_map s
  set
    ticker = coalesce({ticker_sql}, s.ticker),
    cusip = coalesce({cusip_sql}, s.cusip),
    sector_code = {sql_literal(sector_code)},
    sector_label = {sql_literal(sector_label)},
    source = 'yfinance',
    source_version = {sql_literal(SOURCE_VERSION)},
    confidence = {confidence:.2f},
    updated_at = timezone('utc', now())
  where s.is_active = true
    and (({cusip_sql} is not null and s.cusip = {cusip_sql})
      or ({ticker_sql} is not null and s.ticker = {ticker_sql}))
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
    {ticker_sql},
    {cusip_sql},
    {sql_literal(sector_code)},
    {sql_literal(sector_label)},
    'yfinance',
    {sql_literal(SOURCE_VERSION)},
    {confidence:.2f},
    true
  where not exists (
    select 1 from public.security_sector_map s
    where s.is_active = true
      and (({cusip_sql} is not null and s.cusip = {cusip_sql})
        or ({ticker_sql} is not null and s.ticker = {ticker_sql}))
  )
  returning ticker
)
select (select count(*) from updated), (select count(*) from inserted);
"""

    out = run_psql(sql)
    updated_text, inserted_text = (out.split("\t") + ["0", "0"])[:2]
    return int(updated_text or "0"), int(inserted_text or "0")


def fetch_sector_from_yfinance(
    ticker: str,
) -> Tuple[str, Optional[Tuple[str, str]], Optional[str]]:
    for attempt in range(1, RETRY_MAX + 1):
        try:
            if REQUEST_DELAY_MS > 0:
                time.sleep((REQUEST_DELAY_MS / 1000.0) + random.uniform(0, 0.05))

            info = yf.Ticker(ticker).info or {}
            raw_sector = info.get("sector")
            mapped = normalize_sector(raw_sector)
            return ticker, mapped, None
        except Exception as error:  # noqa: BLE001
            if attempt >= RETRY_MAX:
                return ticker, None, str(error)
            backoff = min(2.0, 0.2 * (2 ** (attempt - 1)))
            time.sleep(backoff)
    return ticker, None, "unknown yfinance error"


def main() -> None:
    candidates = fetch_candidate_securities()
    mapped_tickers, mapped_cusips = fetch_mapped_keys()
    identity_by_cusip = fetch_active_identity_map()

    unresolved = [
        c
        for c in candidates
        if (not c.ticker or c.ticker not in mapped_tickers)
        and (not c.cusip or c.cusip not in mapped_cusips)
    ]

    print(f"Candidate securities (latest 2 quarters): {len(candidates)}")
    print(f"Already mapped tickers: {len(mapped_tickers)}")
    print(f"Already mapped CUSIPs: {len(mapped_cusips)}")
    print(f"Securities to classify via yfinance: {len(unresolved)}")
    print(f"Mode: {'dry-run' if DRY_RUN else 'live'}")
    print(f"Workers: {MAX_WORKERS}, retries: {RETRY_MAX}, delay_ms: {REQUEST_DELAY_MS}")
    if SYMBOL_LIMIT > 0:
        print(f"Ticker processing limit enabled: {SYMBOL_LIMIT}")

    resolved_candidates: List[Tuple[str, Optional[str]]] = []
    unresolved_no_ticker = 0
    for security in unresolved:
        resolved_ticker = security.ticker or (
            identity_by_cusip.get(security.cusip) if security.cusip else None
        )
        if not resolved_ticker:
            unresolved_no_ticker += 1
            continue
        resolved_candidates.append((resolved_ticker, security.cusip))

    unique_tickers = sorted({ticker for ticker, _ in resolved_candidates})
    if SYMBOL_LIMIT > 0:
        limited_tickers = set(unique_tickers[:SYMBOL_LIMIT])
        unique_tickers = sorted(limited_tickers)
        resolved_candidates = [
            (ticker, cusip)
            for ticker, cusip in resolved_candidates
            if ticker in limited_tickers
        ]

    sector_by_ticker: Dict[str, Optional[Tuple[str, str]]] = {}
    failures: List[str] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [
            executor.submit(fetch_sector_from_yfinance, ticker)
            for ticker in unique_tickers
        ]
        for future in as_completed(futures):
            ticker, sector, error = future.result()
            sector_by_ticker[ticker] = sector
            if error:
                failures.append(f"{ticker}: {error}")

    inserted = 0
    updated = 0
    unresolved_sector = 0

    for ticker, cusip in resolved_candidates:
        mapped = sector_by_ticker.get(ticker)
        if not mapped:
            unresolved_sector += 1
            continue

        if DRY_RUN:
            continue

        sector_code, sector_label = mapped
        row_updated, row_inserted = upsert_security_sector(
            ticker=ticker,
            cusip=cusip,
            sector_code=sector_code,
            sector_label=sector_label,
            confidence=0.90,
        )
        updated += row_updated
        inserted += row_inserted

    print("GICS sync complete.")
    print(f"Resolved tickers for classification: {len(resolved_candidates)}")
    print(f"Unresolved securities (no ticker): {unresolved_no_ticker}")
    print(f"Unresolved securities (no mapped sector): {unresolved_sector}")
    print(f"Inserted rows: {inserted}")
    print(f"Updated rows: {updated}")
    print(f"Request failures: {len(failures)}")

    if failures:
        print("Failure preview:")
        for line in failures[:MAX_FAILURE_PREVIEW]:
            print(line)


if __name__ == "__main__":
    main()
