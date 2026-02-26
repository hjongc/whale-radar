#!/usr/bin/env python3

import os
import random
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import yfinance as yf
from yfinance.exceptions import YFRateLimitError


DB_CONTAINER = os.getenv("SUPABASE_DB_CONTAINER", "supabase_db_whaleinsight-pro-mvp")
DB_NAME = os.getenv("SUPABASE_DB_NAME", "postgres")
DB_USER = os.getenv("SUPABASE_DB_USER", "postgres")

DRY_RUN = "--dry-run" in sys.argv
REQUEST_DELAY_MS = max(100, int(os.getenv("YH_REQUEST_DELAY_MS", "450")))
RETRY_MAX = max(1, int(os.getenv("YH_RETRY_MAX", "5")))
SYMBOL_LIMIT = max(0, int(os.getenv("YH_SYMBOL_LIMIT", "0")))
SOURCE_VERSION = os.getenv("IDENTITY_SOURCE_VERSION", "yahoo-symbol-refresh-v1")
TARGET_TICKER = (os.getenv("YH_TARGET_TICKER", "") or "").strip().upper()

VALID_EXCHANGES = {"NYQ", "NMS", "ASE", "NYE", "NGM", "NCM", "BTS", "PNK"}


@dataclass
class Candidate:
    cusip: str
    ticker: str
    issuer_name: str


def run(command: List[str]) -> str:
    completed = subprocess.run(
        command,
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


def sleep_with_jitter() -> None:
    time.sleep((REQUEST_DELAY_MS / 1000.0) + random.uniform(0.05, 0.2))


def fetch_top50_candidates() -> List[Candidate]:
    sql = """
with canonical_latest as (
  select
    f.institution_id,
    f.id as filing_id,
    row_number() over (
      partition by f.institution_id
      order by f.report_period desc, f.filing_date desc, f.accession_number desc
    ) as rn
  from public.filings f
  where f.filing_form_type in ('13F-HR', '13F-HR/A')
), latest_holdings as (
  select
    cl.institution_id,
    upper(trim(p.cusip)) as cusip,
    max(p.issuer_name) as issuer_name,
    sum(case when p.value_usd_thousands > 0 and p.shares > 0 then p.value_usd_thousands else 0 end) as value_usd_thousands
  from canonical_latest cl
  join public.positions p on p.filing_id = cl.filing_id
  where cl.rn = 1
    and p.cusip is not null
  group by cl.institution_id, upper(trim(p.cusip))
), ranked_institutions as (
  select
    i.id as institution_id,
    row_number() over (
      order by sum(lh.value_usd_thousands) desc, i.institution_name asc, i.id asc
    ) as canonical_rank
  from public.institutions i
  join latest_holdings lh on lh.institution_id = i.id
  group by i.id, i.institution_name
), top50 as (
  select institution_id
  from ranked_institutions
  where canonical_rank <= 50
)
select
  lh.cusip,
  upper(trim(sim.ticker)) as ticker,
  lh.issuer_name
from latest_holdings lh
join top50 t on t.institution_id = lh.institution_id
join public.security_identity_map sim
  on sim.cusip = lh.cusip
 and sim.is_active = true
where sim.ticker ~ '^[A-Za-z.]{1,10}$'
group by lh.cusip, upper(trim(sim.ticker)), lh.issuer_name
order by upper(trim(sim.ticker));
"""
    raw = run_psql(sql)
    rows: List[Candidate] = []
    if not raw:
        return rows

    for line in raw.splitlines():
        parts = (line.split("\t") + ["", ""])[:3]
        cusip = parts[0].strip()
        ticker = parts[1].strip()
        issuer_name = parts[2].strip()
        if not cusip or not ticker:
            continue
        rows.append(Candidate(cusip=cusip, ticker=ticker, issuer_name=issuer_name))
    return rows


def fetch_active_identity_by_cusip() -> Dict[str, str]:
    raw = run_psql(
        """
select upper(cusip), upper(ticker)
from public.security_identity_map
where is_active = true;
"""
    )
    rows: Dict[str, str] = {}
    if not raw:
        return rows

    for line in raw.splitlines():
        cusip, ticker = (line.split("\t") + [""])[:2]
        if cusip and ticker:
            rows[cusip.strip()] = ticker.strip()
    return rows


def fetch_target_candidates_from_identity(target_ticker: str) -> List[Candidate]:
    sql = f"""
select
  sim.cusip,
  sim.ticker,
  coalesce(max(p.issuer_name), sim.ticker) as issuer_name
from public.security_identity_map sim
left join public.positions p
  on upper(trim(p.cusip)) = sim.cusip
where sim.is_active = true
  and sim.ticker = {sql_literal(target_ticker)}
group by sim.cusip, sim.ticker;
"""
    raw = run_psql(sql)
    rows: List[Candidate] = []
    if not raw:
        return rows

    for line in raw.splitlines():
        parts = (line.split("\t") + ["", ""])[:3]
        cusip = parts[0].strip()
        ticker = parts[1].strip()
        issuer_name = parts[2].strip()
        if cusip and ticker:
            rows.append(Candidate(cusip=cusip, ticker=ticker, issuer_name=issuer_name))
    return rows


def has_active_quote(symbol: str) -> bool:
    for attempt in range(1, RETRY_MAX + 1):
        sleep_with_jitter()
        try:
            history = yf.Ticker(symbol).history(
                period="5d", interval="1d", auto_adjust=False, actions=False
            )
            return hasattr(history, "empty") and not history.empty
        except YFRateLimitError:
            if attempt == RETRY_MAX:
                return False
            time.sleep(min(8.0, 0.7 * (2 ** (attempt - 1))))
        except Exception as error:  # noqa: BLE001
            message = str(error).lower()
            if (
                "quote not found" in message
                or "delisted" in message
                or "no data found" in message
            ):
                return False
            if attempt == RETRY_MAX:
                return False
            time.sleep(min(5.0, 0.5 * attempt))

    return False


def resolve_symbol_from_search(query: str) -> Optional[str]:
    if not query:
        return None

    for attempt in range(1, RETRY_MAX + 1):
        try:
            sleep_with_jitter()
            search = yf.Search(query, max_results=10)
            quotes = search.quotes if isinstance(search.quotes, list) else []
            break
        except YFRateLimitError:
            if attempt == RETRY_MAX:
                return None
            time.sleep(min(8.0, 0.7 * (2 ** (attempt - 1))))
        except Exception:
            if attempt == RETRY_MAX:
                return None
            time.sleep(min(5.0, 0.5 * attempt))
    else:
        return None

    fallback_symbol: Optional[str] = None
    for quote in quotes:
        if not isinstance(quote, dict):
            continue
        quote_type = str(quote.get("quoteType") or "").upper()
        symbol = str(quote.get("symbol") or "").upper().strip()
        exchange = str(quote.get("exchange") or "").upper().strip()
        if quote_type != "EQUITY" or not symbol:
            continue
        if exchange and exchange not in VALID_EXCHANGES:
            continue
        if fallback_symbol is None:
            fallback_symbol = symbol
        if has_active_quote(symbol):
            return symbol

    return fallback_symbol


def resolve_replacement_symbol(
    issuer_name: str, old_ticker: str, cusip: Optional[str]
) -> Optional[str]:
    for query in [issuer_name, old_ticker, cusip or ""]:
        resolved = resolve_symbol_from_search(query)
        if resolved:
            return resolved
    return None


def replace_active_identity(cusip: str, ticker: str) -> Tuple[int, int]:
    sql = f"""
with deactivated as (
  update public.security_identity_map
  set
    is_active = false,
    effective_to = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where cusip = {sql_literal(cusip)}
    and is_active = true
  returning id
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
    {sql_literal(cusip)},
    {sql_literal(ticker)},
    'yahoo-symbol-refresh',
    {sql_literal(SOURCE_VERSION)},
    0.90,
    timezone('utc', now()),
    true
  )
  returning id
)
select (select count(*) from deactivated), (select count(*) from inserted);
"""
    out = run_psql(sql)
    deactivated, inserted = (out.split("\t") + ["0", "0"])[:2]
    return int(deactivated or "0"), int(inserted or "0")


def main() -> None:
    candidates = fetch_top50_candidates()
    if TARGET_TICKER:
        targeted = fetch_target_candidates_from_identity(TARGET_TICKER)
        if targeted:
            candidates = targeted

    active_identity = fetch_active_identity_by_cusip()

    by_ticker: Dict[str, List[Candidate]] = {}
    for row in candidates:
        by_ticker.setdefault(row.ticker, []).append(row)

    tickers = sorted(by_ticker.keys())
    if TARGET_TICKER:
        tickers = [ticker for ticker in tickers if ticker == TARGET_TICKER]
    if SYMBOL_LIMIT > 0:
        tickers = tickers[:SYMBOL_LIMIT]

    print(f"Top50 candidate rows: {len(candidates)}")
    print(f"Unique tickers to validate: {len(tickers)}")
    print(f"Mode: {'dry-run' if DRY_RUN else 'live'}")
    print(f"request_delay_ms={REQUEST_DELAY_MS}, retry_max={RETRY_MAX}")
    if TARGET_TICKER:
        print(f"target_ticker={TARGET_TICKER}")

    unchanged = 0
    upgraded = 0
    unresolved = 0
    deactivated_total = 0
    inserted_total = 0
    failures: List[str] = []

    for ticker in tickers:
        if has_active_quote(ticker):
            unchanged += 1
            continue

        rows = by_ticker[ticker]
        issuer_name = rows[0].issuer_name

        replacement = resolve_replacement_symbol(
            issuer_name, ticker, rows[0].cusip if rows else None
        )
        if not replacement:
            unresolved += 1
            failures.append(f"{ticker}: no replacement found")
            continue

        if replacement == ticker:
            unresolved += 1
            failures.append(f"{ticker}: replacement same as old symbol")
            continue

        target_rows = [
            r
            for r in rows
            if active_identity.get(r.cusip) in (None, ticker, replacement)
        ]
        if not target_rows:
            unresolved += 1
            failures.append(f"{ticker}: skipped due to conflicting active identity")
            continue

        if DRY_RUN:
            upgraded += len(target_rows)
            continue

        for row in target_rows:
            d, i = replace_active_identity(row.cusip, replacement)
            deactivated_total += d
            inserted_total += i
            upgraded += 1

        print(f"Updated {ticker} -> {replacement} for {len(target_rows)} CUSIPs")

    print("Ticker refresh complete.")
    print(f"unchanged={unchanged}")
    print(f"upgraded={upgraded}")
    print(f"unresolved={unresolved}")
    print(f"deactivated={deactivated_total}")
    print(f"inserted={inserted_total}")
    print(f"failures={len(failures)}")
    if failures:
        print("Failure preview:")
        for line in failures[:30]:
            print(line)


if __name__ == "__main__":
    main()
