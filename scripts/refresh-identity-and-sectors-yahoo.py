#!/usr/bin/env python3

import json
import os
import random
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import yfinance as yf
from yfinance.exceptions import YFRateLimitError


DB_CONTAINER = os.getenv("SUPABASE_DB_CONTAINER", "supabase_db_whaleinsight-pro-mvp")
DB_NAME = os.getenv("SUPABASE_DB_NAME", "postgres")
DB_USER = os.getenv("SUPABASE_DB_USER", "postgres")

DRY_RUN = "--dry-run" in sys.argv
SYMBOL_LIMIT = max(0, int(os.getenv("YH_SYMBOL_LIMIT", "0")))

SEARCH_WORKERS = max(1, int(os.getenv("YH_SEARCH_WORKERS", "2")))
SECTOR_WORKERS = max(1, int(os.getenv("YH_SECTOR_WORKERS", "3")))
SEARCH_WORKERS_MAX = max(
    SEARCH_WORKERS, int(os.getenv("YH_SEARCH_WORKERS_MAX", str(SEARCH_WORKERS + 2)))
)
SECTOR_WORKERS_MAX = max(
    SECTOR_WORKERS, int(os.getenv("YH_SECTOR_WORKERS_MAX", str(SECTOR_WORKERS + 2)))
)

SEARCH_DELAY_MS = max(40, int(os.getenv("YH_SEARCH_DELAY_MS", "180")))
SECTOR_DELAY_MS = max(60, int(os.getenv("YH_SECTOR_DELAY_MS", "220")))
SEARCH_DELAY_MIN_MS = max(20, int(os.getenv("YH_SEARCH_DELAY_MIN_MS", "80")))
SECTOR_DELAY_MIN_MS = max(20, int(os.getenv("YH_SECTOR_DELAY_MIN_MS", "100")))
SEARCH_DELAY_MAX_MS = max(
    SEARCH_DELAY_MS, int(os.getenv("YH_SEARCH_DELAY_MAX_MS", "1200"))
)
SECTOR_DELAY_MAX_MS = max(
    SECTOR_DELAY_MS, int(os.getenv("YH_SECTOR_DELAY_MAX_MS", "1500"))
)

SEARCH_RETRY_MAX = max(1, int(os.getenv("YH_SEARCH_RETRY_MAX", "3")))
SECTOR_RETRY_MAX = max(1, int(os.getenv("YH_SECTOR_RETRY_MAX", "3")))

GLOBAL_RPS = max(0.2, float(os.getenv("YH_GLOBAL_RPS", "1.5")))
GLOBAL_BURST = max(1, int(os.getenv("YH_GLOBAL_BURST", "3")))
GLOBAL_RPS_MIN = max(0.1, float(os.getenv("YH_GLOBAL_RPS_MIN", "0.6")))

ADAPT_WINDOW_REQUESTS = max(30, int(os.getenv("YH_ADAPT_WINDOW_REQUESTS", "120")))
ADAPT_429_THRESHOLD = max(0.0, float(os.getenv("YH_ADAPT_429_THRESHOLD", "0.03")))
ADAPT_DELAY_STEP_MS = max(20, int(os.getenv("YH_ADAPT_DELAY_STEP_MS", "80")))
HEALTHY_WINDOWS_TO_SCALE_UP = max(
    1, int(os.getenv("YH_HEALTHY_WINDOWS_TO_SCALE_UP", "3"))
)
MAX_CONSECUTIVE_THROTTLED_WINDOWS = max(
    1, int(os.getenv("YH_MAX_CONSECUTIVE_THROTTLED_WINDOWS", "6"))
)
COOLDOWN_SECONDS = max(2, int(os.getenv("YH_COOLDOWN_SECONDS", "15")))

BATCH_SIZE = max(10, int(os.getenv("YH_BATCH_SIZE", "100")))

IDENTITY_SOURCE_VERSION = os.getenv("IDENTITY_SOURCE_VERSION", "yahoo-search-cusip-v1")
SECTOR_SOURCE_VERSION = os.getenv("SECTOR_SOURCE_VERSION", "yfinance-info-v1")

VALID_EXCHANGES = {"NYQ", "NMS", "ASE", "NYE", "NGM", "NCM", "BTS", "PNK"}
DB_TICKER_RE = re.compile(r"^[A-Z.]{1,10}$")

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
class Candidate:
    cusip: str
    issuer_name: str


@dataclass
class IdentityResult:
    cusip: str
    issuer_name: str
    provider_symbol: Optional[str]
    db_symbol: Optional[str]
    reason: str


@dataclass
class SectorResult:
    provider_symbol: str
    db_symbol: str
    sector_code: Optional[str]
    sector_label: Optional[str]
    reason: str


class TokenBucketLimiter:
    def __init__(self, rps: float, burst: int) -> None:
        self._lock = threading.Lock()
        self._rps = rps
        self._burst = float(burst)
        self._tokens = float(burst)
        self._last = time.monotonic()

    def update_rps(self, rps: float) -> None:
        with self._lock:
            self._refill_locked()
            self._rps = rps

    def _refill_locked(self) -> None:
        now = time.monotonic()
        elapsed = max(0.0, now - self._last)
        self._last = now
        self._tokens = min(self._burst, self._tokens + elapsed * self._rps)

    def acquire(self) -> None:
        while True:
            with self._lock:
                self._refill_locked()
                if self._tokens >= 1.0:
                    self._tokens -= 1.0
                    return
                needed = 1.0 - self._tokens
                sleep_seconds = max(0.01, needed / max(self._rps, 0.01))
            time.sleep(sleep_seconds)


class Metrics:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.started_at = time.time()
        self.requests_total = 0
        self.requests_429 = 0
        self.requests_5xx = 0
        self.request_latencies_ms: List[float] = []
        self.identity_results = 0
        self.sector_results = 0
        self.db_write_time_ms = 0.0
        self._window_total = 0
        self._window_429 = 0
        self._window_5xx = 0

    def record_request(self, latency_ms: float, status: str) -> None:
        with self.lock:
            self.requests_total += 1
            self._window_total += 1
            self.request_latencies_ms.append(latency_ms)
            if status == "429":
                self.requests_429 += 1
                self._window_429 += 1
            if status == "5xx":
                self.requests_5xx += 1
                self._window_5xx += 1

    def record_identity_result(self) -> None:
        with self.lock:
            self.identity_results += 1

    def record_sector_result(self) -> None:
        with self.lock:
            self.sector_results += 1

    def record_db_write_ms(self, duration_ms: float) -> None:
        with self.lock:
            self.db_write_time_ms += duration_ms

    def pop_window(self) -> Tuple[int, int, int]:
        with self.lock:
            total = self._window_total
            throttled = self._window_429
            five_xx = self._window_5xx
            self._window_total = 0
            self._window_429 = 0
            self._window_5xx = 0
            return total, throttled, five_xx


class AdaptiveController:
    def __init__(self, limiter: TokenBucketLimiter) -> None:
        self.lock = threading.Lock()
        self.limiter = limiter
        self.search_workers = SEARCH_WORKERS
        self.sector_workers = SECTOR_WORKERS
        self.search_delay_ms = SEARCH_DELAY_MS
        self.sector_delay_ms = SECTOR_DELAY_MS
        self.global_rps = GLOBAL_RPS
        self.healthy_windows = 0
        self.consecutive_throttled_windows = 0
        self.cooldown_until = 0.0
        self.stop_requested = False

    def current_limits(self, stage: str) -> Tuple[int, int]:
        with self.lock:
            if stage == "identity":
                return self.search_workers, self.search_delay_ms
            return self.sector_workers, self.sector_delay_ms

    def maybe_pause_for_cooldown(self) -> None:
        while True:
            with self.lock:
                remaining = self.cooldown_until - time.time()
                stop = self.stop_requested
            if stop:
                return
            if remaining <= 0:
                return
            time.sleep(min(1.0, remaining))

    def observe_window(self, total: int, throttled: int) -> None:
        if total <= 0:
            return

        ratio = throttled / total
        with self.lock:
            if ratio > ADAPT_429_THRESHOLD:
                self.healthy_windows = 0
                self.consecutive_throttled_windows += 1

                self.search_workers = max(1, self.search_workers - 1)
                self.sector_workers = max(1, self.sector_workers - 1)
                self.search_delay_ms = min(
                    SEARCH_DELAY_MAX_MS, self.search_delay_ms + ADAPT_DELAY_STEP_MS
                )
                self.sector_delay_ms = min(
                    SECTOR_DELAY_MAX_MS, self.sector_delay_ms + ADAPT_DELAY_STEP_MS
                )
                self.global_rps = max(GLOBAL_RPS_MIN, self.global_rps - 0.2)
                self.limiter.update_rps(self.global_rps)
                self.cooldown_until = max(
                    self.cooldown_until, time.time() + COOLDOWN_SECONDS
                )

                if (
                    self.consecutive_throttled_windows
                    >= MAX_CONSECUTIVE_THROTTLED_WINDOWS
                ):
                    self.stop_requested = True
            else:
                self.consecutive_throttled_windows = 0
                self.healthy_windows += 1
                if self.healthy_windows >= HEALTHY_WINDOWS_TO_SCALE_UP:
                    self.search_workers = min(
                        SEARCH_WORKERS_MAX, self.search_workers + 1
                    )
                    self.sector_workers = min(
                        SECTOR_WORKERS_MAX, self.sector_workers + 1
                    )
                    self.search_delay_ms = max(
                        SEARCH_DELAY_MIN_MS, self.search_delay_ms - ADAPT_DELAY_STEP_MS
                    )
                    self.sector_delay_ms = max(
                        SECTOR_DELAY_MIN_MS, self.sector_delay_ms - ADAPT_DELAY_STEP_MS
                    )
                    self.global_rps = min(GLOBAL_RPS, self.global_rps + 0.2)
                    self.limiter.update_rps(self.global_rps)
                    self.healthy_windows = 0


def run(command: Sequence[str]) -> str:
    completed = subprocess.run(
        list(command),
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


def normalize_ticker_for_db(value: str) -> Optional[str]:
    normalized = value.strip().upper().replace("-", ".")
    if not normalized:
        return None
    if not DB_TICKER_RE.fullmatch(normalized):
        return None
    return normalized


def normalize_sector(raw: Optional[str]) -> Optional[Tuple[str, str]]:
    if not raw:
        return None
    return GICS_SECTORS.get(raw.strip().lower())


def p95(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = max(0, int(len(ordered) * 0.95) - 1)
    return ordered[idx]


def fetch_top50_cusips() -> List[Candidate]:
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
    and p.cusip ~ '^[A-Za-z0-9]{8,9}$'
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
select lh.cusip, max(lh.issuer_name) as issuer_name
from latest_holdings lh
join top50 t on t.institution_id = lh.institution_id
group by lh.cusip
order by lh.cusip;
"""
    raw = run_psql(sql)
    rows: List[Candidate] = []
    if not raw:
        return rows
    for line in raw.splitlines():
        cusip, issuer_name = (line.split("\t") + [""])[:2]
        c = cusip.strip().upper()
        if c:
            rows.append(Candidate(cusip=c, issuer_name=issuer_name.strip()))
    return rows


def fetch_active_identity_by_cusip() -> Dict[str, str]:
    raw = run_psql(
        """
select upper(cusip), upper(ticker)
from public.security_identity_map
where is_active = true;
"""
    )
    by_cusip: Dict[str, str] = {}
    if not raw:
        return by_cusip
    for line in raw.splitlines():
        cusip, ticker = (line.split("\t") + [""])[:2]
        c = cusip.strip().upper()
        t = ticker.strip().upper()
        if c and t:
            by_cusip[c] = t
    return by_cusip


def maybe_adjust_from_metrics(metrics: Metrics, controller: AdaptiveController) -> None:
    total, throttled, _ = metrics.pop_window()
    if total >= ADAPT_WINDOW_REQUESTS:
        controller.observe_window(total, throttled)


def sleep_with_stage_delay(stage: str, controller: AdaptiveController) -> None:
    _, delay_ms = controller.current_limits(stage)
    time.sleep((delay_ms / 1000.0) + random.uniform(0.03, 0.12))


def run_identity_lookup(
    candidate: Candidate,
    limiter: TokenBucketLimiter,
    metrics: Metrics,
    controller: AdaptiveController,
) -> IdentityResult:
    queries = [candidate.cusip]
    if candidate.issuer_name:
        queries.append(candidate.issuer_name)

    for query in queries:
        for attempt in range(1, SEARCH_RETRY_MAX + 1):
            controller.maybe_pause_for_cooldown()
            if controller.stop_requested:
                return IdentityResult(
                    candidate.cusip,
                    candidate.issuer_name,
                    None,
                    None,
                    "stopped_due_to_throttle",
                )

            limiter.acquire()
            sleep_with_stage_delay("identity", controller)
            started = time.time()

            try:
                search = yf.Search(query, max_results=10)
                latency_ms = (time.time() - started) * 1000.0
                metrics.record_request(latency_ms, "ok")
                maybe_adjust_from_metrics(metrics, controller)

                quotes = search.quotes if isinstance(search.quotes, list) else []
                fallback_provider_symbol: Optional[str] = None
                fallback_db_symbol: Optional[str] = None

                for quote in quotes:
                    if not isinstance(quote, dict):
                        continue
                    provider_symbol = str(quote.get("symbol") or "").strip().upper()
                    quote_type = str(quote.get("quoteType") or "").upper()
                    exchange = str(quote.get("exchange") or "").upper()
                    if quote_type != "EQUITY" or not provider_symbol:
                        continue
                    if exchange and exchange not in VALID_EXCHANGES:
                        continue

                    db_symbol = normalize_ticker_for_db(provider_symbol)
                    if not db_symbol:
                        continue

                    if fallback_provider_symbol is None:
                        fallback_provider_symbol = provider_symbol
                        fallback_db_symbol = db_symbol

                if fallback_provider_symbol and fallback_db_symbol:
                    return IdentityResult(
                        candidate.cusip,
                        candidate.issuer_name,
                        fallback_provider_symbol,
                        fallback_db_symbol,
                        "resolved",
                    )
                break

            except YFRateLimitError:
                latency_ms = (time.time() - started) * 1000.0
                metrics.record_request(latency_ms, "429")
                maybe_adjust_from_metrics(metrics, controller)
                if attempt >= SEARCH_RETRY_MAX:
                    break
                time.sleep(min(8.0, 0.7 * (2 ** (attempt - 1))))
            except Exception as error:  # noqa: BLE001
                latency_ms = (time.time() - started) * 1000.0
                status = (
                    "5xx"
                    if any(code in str(error) for code in ["500", "502", "503", "504"])
                    else "error"
                )
                metrics.record_request(latency_ms, status)
                maybe_adjust_from_metrics(metrics, controller)
                if attempt >= SEARCH_RETRY_MAX:
                    break
                time.sleep(min(5.0, 0.5 * attempt))

    return IdentityResult(
        candidate.cusip, candidate.issuer_name, None, None, "unresolved"
    )


def run_sector_lookup(
    provider_symbol: str,
    db_symbol: str,
    limiter: TokenBucketLimiter,
    metrics: Metrics,
    controller: AdaptiveController,
) -> SectorResult:
    for attempt in range(1, SECTOR_RETRY_MAX + 1):
        controller.maybe_pause_for_cooldown()
        if controller.stop_requested:
            return SectorResult(
                provider_symbol, db_symbol, None, None, "stopped_due_to_throttle"
            )

        limiter.acquire()
        sleep_with_stage_delay("sector", controller)
        started = time.time()

        try:
            info = yf.Ticker(provider_symbol).info or {}
            latency_ms = (time.time() - started) * 1000.0
            metrics.record_request(latency_ms, "ok")
            maybe_adjust_from_metrics(metrics, controller)

            mapped = normalize_sector(info.get("sector"))
            if not mapped:
                return SectorResult(
                    provider_symbol, db_symbol, None, None, "sector_unmapped"
                )
            return SectorResult(
                provider_symbol, db_symbol, mapped[0], mapped[1], "resolved"
            )

        except YFRateLimitError:
            latency_ms = (time.time() - started) * 1000.0
            metrics.record_request(latency_ms, "429")
            maybe_adjust_from_metrics(metrics, controller)
            if attempt >= SECTOR_RETRY_MAX:
                return SectorResult(
                    provider_symbol, db_symbol, None, None, "rate_limited"
                )
            time.sleep(min(8.0, 0.7 * (2 ** (attempt - 1))))
        except Exception as error:  # noqa: BLE001
            latency_ms = (time.time() - started) * 1000.0
            status = (
                "5xx"
                if any(code in str(error) for code in ["500", "502", "503", "504"])
                else "error"
            )
            metrics.record_request(latency_ms, status)
            maybe_adjust_from_metrics(metrics, controller)
            if attempt >= SECTOR_RETRY_MAX:
                return SectorResult(
                    provider_symbol, db_symbol, None, None, f"fetch_failed:{error}"
                )
            time.sleep(min(5.0, 0.5 * attempt))

    return SectorResult(provider_symbol, db_symbol, None, None, "unresolved")


def apply_identity_batches(
    changes: List[Tuple[str, str]], metrics: Metrics
) -> Tuple[int, int]:
    total_deactivated = 0
    total_inserted = 0

    for start in range(0, len(changes), BATCH_SIZE):
        chunk = changes[start : start + BATCH_SIZE]
        values_sql = ",\n      ".join(
            f"({sql_literal(cusip)}, {sql_literal(ticker)})" for cusip, ticker in chunk
        )

        sql = f"""
with incoming(cusip, ticker) as (
  values
      {values_sql}
), deactivated as (
  update public.security_identity_map sim
  set
    is_active = false,
    effective_to = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where sim.is_active = true
    and exists (
      select 1
      from incoming i
      where i.cusip = sim.cusip
        and i.ticker <> sim.ticker
    )
  returning sim.id
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
  select
    i.cusip,
    i.ticker,
    'yahoo-search-cusip',
    {sql_literal(IDENTITY_SOURCE_VERSION)},
    0.90,
    timezone('utc', now()),
    true
  from incoming i
  where not exists (
    select 1
    from public.security_identity_map sim
    where sim.is_active = true
      and sim.cusip = i.cusip
      and sim.ticker = i.ticker
  )
  returning id
)
select (select count(*) from deactivated), (select count(*) from inserted);
"""
        write_started = time.time()
        out = run_psql(sql)
        metrics.record_db_write_ms((time.time() - write_started) * 1000.0)
        deactivated, inserted = (out.split("\t") + ["0", "0"])[:2]
        total_deactivated += int(deactivated or "0")
        total_inserted += int(inserted or "0")

    return total_deactivated, total_inserted


def apply_sector_batches(
    rows: List[Tuple[str, str, str, str]], metrics: Metrics
) -> Tuple[int, int]:
    total_updated = 0
    total_inserted = 0

    for start in range(0, len(rows), BATCH_SIZE):
        chunk = rows[start : start + BATCH_SIZE]
        values_sql = ",\n      ".join(
            f"({sql_literal(ticker)}, {sql_literal(cusip)}, {sql_literal(code)}, {sql_literal(label)})"
            for ticker, cusip, code, label in chunk
        )

        sql = f"""
with incoming(ticker, cusip, sector_code, sector_label) as (
  values
      {values_sql}
), updated as (
  update public.security_sector_map s
  set
    cusip = coalesce(i.cusip, s.cusip),
    sector_code = i.sector_code,
    sector_label = i.sector_label,
    source = 'yfinance',
    source_version = {sql_literal(SECTOR_SOURCE_VERSION)},
    confidence = 0.90,
    updated_at = timezone('utc', now())
  from incoming i
  where s.is_active = true
    and s.ticker = i.ticker
  returning s.id
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
    i.ticker,
    i.cusip,
    i.sector_code,
    i.sector_label,
    'yfinance',
    {sql_literal(SECTOR_SOURCE_VERSION)},
    0.90,
    true
  from incoming i
  where not exists (
    select 1
    from public.security_sector_map s
    where s.is_active = true
      and s.ticker = i.ticker
  )
  returning id
)
select (select count(*) from updated), (select count(*) from inserted);
"""
        write_started = time.time()
        out = run_psql(sql)
        metrics.record_db_write_ms((time.time() - write_started) * 1000.0)
        updated, inserted = (out.split("\t") + ["0", "0"])[:2]
        total_updated += int(updated or "0")
        total_inserted += int(inserted or "0")

    return total_updated, total_inserted


def run_parallel_identity(
    candidates: List[Candidate],
    limiter: TokenBucketLimiter,
    metrics: Metrics,
    controller: AdaptiveController,
) -> List[IdentityResult]:
    results: List[IdentityResult] = []
    total = len(candidates)
    if total == 0:
        return results

    iterator = iter(candidates)
    pending: Dict[Future[IdentityResult], Candidate] = {}
    completed = 0

    with ThreadPoolExecutor(max_workers=SEARCH_WORKERS_MAX) as executor:
        while True:
            limit, _ = controller.current_limits("identity")
            while not controller.stop_requested and len(pending) < limit:
                try:
                    candidate = next(iterator)
                except StopIteration:
                    break
                future = executor.submit(
                    run_identity_lookup, candidate, limiter, metrics, controller
                )
                pending[future] = candidate

            if not pending:
                break

            done, _ = wait(set(pending.keys()), return_when=FIRST_COMPLETED)
            for future in done:
                pending.pop(future, None)
                result = future.result()
                results.append(result)
                metrics.record_identity_result()
                completed += 1
                if completed % 100 == 0 or completed == total:
                    print(f"[identity] {completed}/{total}")

            if controller.stop_requested and not pending:
                break

    return results


def run_parallel_sector(
    provider_to_db: Dict[str, str],
    limiter: TokenBucketLimiter,
    metrics: Metrics,
    controller: AdaptiveController,
) -> List[SectorResult]:
    provider_items = sorted(provider_to_db.items())
    total = len(provider_items)
    if total == 0:
        return []

    results: List[SectorResult] = []
    pending: Dict[Future[SectorResult], Tuple[str, str]] = {}
    iterator = iter(provider_items)
    completed = 0

    with ThreadPoolExecutor(max_workers=SECTOR_WORKERS_MAX) as executor:
        while True:
            limit, _ = controller.current_limits("sector")
            while not controller.stop_requested and len(pending) < limit:
                try:
                    provider_symbol, db_symbol = next(iterator)
                except StopIteration:
                    break
                future = executor.submit(
                    run_sector_lookup,
                    provider_symbol,
                    db_symbol,
                    limiter,
                    metrics,
                    controller,
                )
                pending[future] = (provider_symbol, db_symbol)

            if not pending:
                break

            done, _ = wait(set(pending.keys()), return_when=FIRST_COMPLETED)
            for future in done:
                pending.pop(future, None)
                result = future.result()
                results.append(result)
                metrics.record_sector_result()
                completed += 1
                if completed % 100 == 0 or completed == total:
                    print(f"[sector] {completed}/{total}")

            if controller.stop_requested and not pending:
                break

    return results


def main() -> None:
    run_started = time.time()
    candidates = fetch_top50_cusips()
    if SYMBOL_LIMIT > 0:
        candidates = candidates[:SYMBOL_LIMIT]
    active_identity = fetch_active_identity_by_cusip()

    limiter = TokenBucketLimiter(GLOBAL_RPS, GLOBAL_BURST)
    metrics = Metrics()
    controller = AdaptiveController(limiter)

    print(f"CUSIPs to process: {len(candidates)}")
    print(f"Mode: {'dry-run' if DRY_RUN else 'live'}")
    print(
        "profiles: "
        f"search_workers={SEARCH_WORKERS}, sector_workers={SECTOR_WORKERS}, "
        f"global_rps={GLOBAL_RPS}, global_burst={GLOBAL_BURST}, batch_size={BATCH_SIZE}"
    )

    identity_results = run_parallel_identity(candidates, limiter, metrics, controller)

    identity_changed_rows: List[Tuple[str, str]] = []
    resolved_tickers_by_cusip: Dict[str, str] = {}
    provider_to_db: Dict[str, str] = {}
    failures: List[str] = []

    identity_unchanged = 0
    identity_unresolved = 0
    identity_changed = 0

    for result in identity_results:
        if not result.db_symbol or not result.provider_symbol:
            identity_unresolved += 1
            if len(failures) < 30:
                failures.append(f"{result.cusip}: {result.reason}")
            continue

        resolved_tickers_by_cusip[result.cusip] = result.db_symbol
        provider_to_db[result.provider_symbol] = result.db_symbol
        current = active_identity.get(result.cusip)
        if current == result.db_symbol:
            identity_unchanged += 1
            continue

        identity_changed += 1
        identity_changed_rows.append((result.cusip, result.db_symbol))

    deactivated_total = 0
    inserted_total = 0
    if not DRY_RUN and identity_changed_rows:
        deactivated_total, inserted_total = apply_identity_batches(
            identity_changed_rows, metrics
        )

    print("Identity refresh complete.")
    print(f"identity_changed={identity_changed}")
    print(f"identity_unchanged={identity_unchanged}")
    print(f"identity_unresolved={identity_unresolved}")
    print(f"deactivated={deactivated_total}")
    print(f"inserted={inserted_total}")

    sector_results = run_parallel_sector(provider_to_db, limiter, metrics, controller)

    sector_rows: List[Tuple[str, str, str, str]] = []
    sector_unresolved = 0
    for result in sector_results:
        if not result.sector_code or not result.sector_label:
            sector_unresolved += 1
            if len(failures) < 30:
                failures.append(f"{result.db_symbol}: {result.reason}")
            continue

        one_cusip = next(
            (
                cusip
                for cusip, db_symbol in resolved_tickers_by_cusip.items()
                if db_symbol == result.db_symbol
            ),
            None,
        )
        if one_cusip:
            sector_rows.append(
                (result.db_symbol, one_cusip, result.sector_code, result.sector_label)
            )

    sector_updated = 0
    sector_inserted = 0
    if not DRY_RUN and sector_rows:
        deduped: Dict[str, Tuple[str, str, str, str]] = {}
        for row in sector_rows:
            deduped[row[0]] = row
        sector_updated, sector_inserted = apply_sector_batches(
            list(deduped.values()), metrics
        )

    print("Sector refresh complete.")
    print(f"sector_updated={sector_updated}")
    print(f"sector_inserted={sector_inserted}")
    print(f"sector_unresolved={sector_unresolved}")
    print(f"failures_sampled={len(failures)}")
    if failures:
        print("Failure preview:")
        for line in failures[:30]:
            print(line)

    elapsed_seconds = max(0.001, time.time() - run_started)
    avg_latency_ms = (
        sum(metrics.request_latencies_ms) / len(metrics.request_latencies_ms)
        if metrics.request_latencies_ms
        else 0.0
    )

    summary = {
        "run_summary": {
            "dry_run": DRY_RUN,
            "elapsed_seconds": round(elapsed_seconds, 2),
            "requests_total": metrics.requests_total,
            "requests_429": metrics.requests_429,
            "requests_5xx": metrics.requests_5xx,
            "request_429_ratio_pct": round(
                (metrics.requests_429 / metrics.requests_total) * 100.0, 2
            )
            if metrics.requests_total
            else 0.0,
            "latency_avg_ms": round(avg_latency_ms, 2),
            "latency_p95_ms": round(p95(metrics.request_latencies_ms), 2),
            "identity_throughput_per_sec": round(
                metrics.identity_results / elapsed_seconds, 3
            ),
            "sector_throughput_per_sec": round(
                metrics.sector_results / elapsed_seconds, 3
            ),
            "db_write_time_ms": round(metrics.db_write_time_ms, 2),
            "adaptive": {
                "search_workers_final": controller.search_workers,
                "sector_workers_final": controller.sector_workers,
                "search_delay_ms_final": controller.search_delay_ms,
                "sector_delay_ms_final": controller.sector_delay_ms,
                "global_rps_final": round(controller.global_rps, 2),
                "stop_requested": controller.stop_requested,
            },
        }
    }
    print("Structured summary:")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
