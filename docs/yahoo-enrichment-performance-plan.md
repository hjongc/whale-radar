# Yahoo Enrichment Performance Improvement Plan

Last updated: 2026-02-24
Scope: `scripts/refresh-identity-and-sectors-yahoo.py`
Objective: Speed up runtime without triggering provider rate limits or reducing mapping quality

## 1) Key Reality Check

- Yes, increasing parallelism can trigger rate limits.
- Therefore, performance work must be "parallelism + global throttle + adaptive backoff" as one package.
- `YH_SYMBOL_LIMIT` is optional (default `0` means full target set), but useful for staged rollout.

## 2) Current Bottlenecks

- Fully sequential identity and sector loops.
- Per-request fixed delays plus retry backoff.
- Per-row DB writes via subprocess `psql` calls.
- Symbol normalization can cause Yahoo lookup mismatches for some classes/suffixes.

## 3) Target Architecture

### 3.1 Concurrency Model

- Split into two worker pools:
  - Identity search pool (`YH_SEARCH_WORKERS`)
  - Sector fetch pool (`YH_SECTOR_WORKERS`)
- Start conservative:
  - `YH_SEARCH_WORKERS=3`
  - `YH_SECTOR_WORKERS=4`

### 3.2 Global Rate Limiter

- Add a single process-wide token bucket for outbound Yahoo calls.
- Enforce max requests per second regardless of worker count.
- New knobs:
  - `YH_GLOBAL_RPS` (initial 2.0)
  - `YH_GLOBAL_BURST` (initial 4)

### 3.3 Adaptive Control (Auto-Throttle)

- Every N requests, calculate short-window error profile.
- If 429 ratio exceeds threshold (example 3%), auto-apply:
  - reduce workers by 1 (floor 1)
  - increase delay by +80ms
- If healthy for sustained window:
  - increase workers gradually (max cap)
  - reduce delay gradually (floor cap)

### 3.4 DB Write Strategy

- Replace per-row update/insert calls with batched upserts.
- Write identity/sector changes in chunks (e.g. 100 rows per SQL batch).
- Keep idempotency: same input can rerun safely.

### 3.5 Symbol Handling Policy

- Separate symbols by purpose:
  - `provider_symbol` for Yahoo calls (raw/canonical provider format)
  - `db_symbol` for internal storage standardization
- Avoid using DB-normalized symbol directly for provider fetch when class/suffix semantics differ.

## 4) Rollout Plan

### Phase A: Instrumentation First (0.5d)

- Add timing and counters:
  - requests_total, requests_429, requests_5xx
  - avg/p95 request latency
  - identity/sec throughput, sector/sec throughput
  - db_write_time_ms
- Emit one structured summary block at end of run.

### Phase B: Safe Parallelism + Global Limit (1.0d)

- Add worker pools with bounded queue.
- Add global token bucket limiter.
- Keep retries and jitter.

### Phase C: Batched DB Writes (1.0d)

- Buffer changes and flush per chunk.
- Keep transactional boundaries per chunk.

### Phase D: Symbol Policy Hardening (0.5d)

- Introduce provider/db symbol split.
- Add explicit handling for suffix-sensitive symbols and log reason codes.

### Phase E: Adaptive Controller + Guardrails (0.5d)

- Implement auto-throttle logic from live response signals.
- Add stop condition on sustained heavy throttling.

## 5) Runtime Profiles

### 5.1 Conservative (default production)

- `YH_SEARCH_WORKERS=2`
- `YH_SECTOR_WORKERS=3`
- `YH_GLOBAL_RPS=1.5`
- `YH_GLOBAL_BURST=3`
- `YH_SEARCH_DELAY_MS=180`
- `YH_SECTOR_DELAY_MS=220`
- `YH_SEARCH_RETRY_MAX=3`
- `YH_SECTOR_RETRY_MAX=3`

### 5.2 Balanced (after stable week)

- `YH_SEARCH_WORKERS=3`
- `YH_SECTOR_WORKERS=4`
- `YH_GLOBAL_RPS=2.0`
- `YH_GLOBAL_BURST=4`
- `YH_SEARCH_DELAY_MS=120`
- `YH_SECTOR_DELAY_MS=150`
- `YH_SEARCH_RETRY_MAX=2`
- `YH_SECTOR_RETRY_MAX=2`

### 5.3 Fast (only during supervised backfill)

- `YH_SEARCH_WORKERS=4`
- `YH_SECTOR_WORKERS=6`
- `YH_GLOBAL_RPS=3.0`
- `YH_GLOBAL_BURST=6`
- immediate rollback to Balanced if 429 ratio rises above threshold

## 6) Use of `YH_SYMBOL_LIMIT`

- Not required in normal runs.
- Recommended usage:
  - smoke test: 100-300
  - tuning session: 300-800
  - full run: 0

## 7) SLO and Gates

- Performance:
  - Runtime reduced by >= 40% vs current baseline at same symbol count.
- Stability:
  - 429 ratio <= 3%
  - hard failures <= 1%
- Data quality:
  - unresolved ratio does not regress by more than 2pp from baseline.

## 8) Failure Handling

- On sustained 429 spikes:
  - pause queue for cooldown window
  - reduce workers and RPS caps
- On provider outage:
  - checkpoint progress and exit gracefully
  - resume from checkpoint next run

## 9) Deliverables

- Updated `scripts/refresh-identity-and-sectors-yahoo.py` with:
  - worker pools
  - global limiter
  - adaptive throttle
  - batch DB writes
  - structured run summary
- Updated `.env.example` with new `YH_*` knobs.
- Updated runbook with conservative/balanced profiles and rollback steps.

## 10) Decision Log

- Parallelism is approved only with hard global throttling.
- `YH_SYMBOL_LIMIT` remains optional and operational.
- Throughput increase must never bypass provider-safe guardrails.
