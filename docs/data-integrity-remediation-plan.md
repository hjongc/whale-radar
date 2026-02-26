# Data Integrity Remediation Plan and Sprint Plan

Last updated: 2026-02-24
Scope: Top-50 institution selection, holdings completeness, CUSIP/ticker integrity, GICS sector automation

## 1) Goals and Success Criteria

### Primary goals
- Make Top-50 institution selection deterministic and consistent across APIs/UI.
- Ensure each selected institution has valid latest-filing holdings with quantity/value integrity.
- Recover ticker coverage from CUSIP-heavy holdings and track mapping provenance.
- Convert GICS mapping from manual script dependency into reliable automated ops pipeline.

### Success criteria (D+7 after rollout)
- Top-50 consistency: `100%` (same institution universe across manager directory and market aggregate).
- Top-50 ticker missing rate: `<= 20%`.
- Ticker mapping precision: `>= 98%` (weekly stratified sample QA).
- Top-50 sector mapping coverage: `>= 80%`.
- Top-50 unknown/unclassified sector ratio: `<= 15%`.
- Enrichment run success rate: `>= 99%`.
- Data freshness SLA: `<= 24h` for ticker and sector enrichment outputs.

### SLA metric definitions
- Freshness clock for ticker mapping: `now() - security_identity_map.updated_at` (active mapping row used at query time).
- Freshness clock for sector mapping: `now() - security_sector_map.updated_at` (active mapping row used at query time).
- Success-rate denominator: all scheduled + manual enrichment attempts in rolling 7 days.

## 2) Current Risks (Observed)

### A. Top-50 mismatch risk
- Directory path applies `slice(0, 50)` while market tracked count can use broader snapshot semantics.
- Snapshot naming implies top-50 but source loading is broader before post-filtering.

### B. Holdings quality risk
- Holdings table has quantity/value columns, but small number of non-positive value/share rows exist.
- Large filing fetch limits may truncate rows under heavy records if not guarded.

### C. CUSIP/Ticker integrity risk
- CUSIP is generally populated, but ticker is mostly null in latest top-50 holdings.
- Parser captures symbol when present, but symbol is often absent in filing XML.
- Fallback mapping chain is too shallow for production-grade coverage.

### D. GICS pipeline risk
- Sector map table exists with constraints, but refresh is effectively manual script driven.
- Prior DB heuristic function path was removed; no always-on automation currently guaranteed.

## 3) Target Architecture

### 3.1 Canonical latest and Top-50 selection
- Define canonical latest filing per institution using:
  - filing form in (`13F-HR`, `13F-HR/A`)
  - sort key: `report_period DESC`, `filing_date DESC`, `accession_number DESC`
- Tie-break policy (required for deterministic rank outputs):
  - if total latest value is tied, sort by `institution_name ASC`, then `institution_id ASC`.
- Rank institutions by sum of `value_usd_thousands` from each institution's canonical latest filing.
- Fix shared Top-50 universe as rank `<= 50` and reuse it for all downstream aggregates.

### 3.2 Ticker recovery chain
- Build deterministic resolution chain:
  1. direct parsed symbol from filing position
  2. active CUSIP->ticker map (`security_identity_map`)
  3. active CUSIP->ticker map from sector map (temporary compatibility)
  4. external resolver backfill (batched + rate-limited)
- Persist source, version, confidence, and update timestamp for each mapping.

### 3.2.1 `security_identity_map` data contract
- Recommended columns:
  - `id uuid primary key default gen_random_uuid()`
  - `cusip text not null`
  - `ticker text not null`
  - `source text not null`
  - `source_version text not null`
  - `confidence numeric(3,2) not null default 1.00`
  - `effective_from timestamptz not null default timezone('utc', now())`
  - `effective_to timestamptz`
  - `is_active boolean not null default true`
  - `created_at timestamptz not null default timezone('utc', now())`
  - `updated_at timestamptz not null default timezone('utc', now())`
- Constraints and indexes:
  - `cusip` format check: `^[A-Z0-9]{8,9}$`
  - `ticker` format check: `^[A-Z.]{1,10}$`
  - confidence bounds: `0 <= confidence <= 1`
  - partial unique index on active identity: `(cusip) where is_active = true`
  - index for active ticker lookup: `(ticker) where is_active = true`
- Lifecycle rule:
  - on replacement, deactivate previous active row for CUSIP and insert new active row (no hard overwrite of lineage).

### 3.3 Sector automation
- Keep `security_sector_map` as serving map.
- Run scheduled enrichment that:
  - scans unresolved/changed tickers
  - applies mapping provider
  - upserts with source/version/confidence
  - deactivates stale mappings safely
- Trigger from ops endpoint and scheduled cron.

## 4) Implementation Plan (Detailed)

### Phase 0 - Baseline and Observability (0.5 day)

### Tasks
- Add baseline SQL checks for:
  - top-50 coverage
  - ticker missing rate
  - sector mapping coverage
  - non-positive shares/value
- Document baseline metrics and target thresholds.

### Deliverables
- `docs/data-quality-baseline.md`
- `scripts/sql/quality-checks.sql`

### Done when
- Baseline numbers are reproducible locally and in staging.

---

### Phase 1 - Canonical Top-50 and Latest Filing Semantics (1.5 days)

### Tasks
- Refactor aggregate query layer to derive a single canonical Top-50 universe first.
- Ensure both manager directory and market aggregate consume same Top-50 source.
- Align naming (`top50`) with actual behavior and remove hidden broad prefetch semantics.

### Candidate files
- `src/lib/data/aggregate-queries.ts`
- `src/lib/data/types.ts` (if metadata fields are needed)
- Optional DB views/migrations for canonical latest/top50 views

### Acceptance tests
- Manager directory returns exactly 50 in DB path.
- Market tracked institution count equals 50 and matches manager directory universe.
- Deterministic ranking under tie conditions.

### Done when
- API contracts for Top-50 are consistent and tested.

---

## Phase 2 - CUSIP/Ticker Recovery and Provenance (3 days)

### Tasks
- Add mapping table for identity resolution:
  - `security_identity_map(cusip, ticker, source, source_version, confidence, is_active, updated_at)`
- Implement enrichment job to backfill ticker by CUSIP.
- Integrate fallback chain into aggregate query resolution path.
- Add guardrails for malformed ticker aliases and normalization.

### Candidate files
- New migration under `supabase/migrations/*_add_security_identity_map.sql`
- `src/lib/data/aggregate-queries.ts`
- `scripts/enrich-cusip-ticker.mjs` (new)
- optional helper under `src/lib/enrichment/*`

### Acceptance tests
- Top-50 ticker missing rate drops to target band in staging dataset.
- Ticker mapping precision meets sampling threshold (`>= 98%`).
- Mapping provenance (source/version/confidence) is visible and queryable.
- No duplicate active mapping for same CUSIP.

### Done when
- Ticker resolution chain is deterministic and measurable.

---

## Phase 3 - GICS Automation via Ops Pipeline (2 days)

### Tasks
- Convert sector refresh script usage into ops-triggered execution path.
- Add scheduled run integration and idempotent upsert behavior.
- Introduce quality checks for unknown/unmapped sector ratio.

### Candidate files
- `src/lib/ops/trigger.ts`
- `src/app/api/ops/enrichment/route.ts`
- `scripts/auto-map-ticker-sectors.mjs`
- `docs/runbook/manual-trigger-ops-runbook.md` (update)

### Acceptance tests
- A single ops enrichment call refreshes sector map and reports counts.
- Top-50 sector mapping coverage reaches target threshold.
- Unknown/unclassified ratio alarms when threshold exceeded.

### Done when
- Sector mapping is automated and observable (not operator-memory dependent).

---

## Phase 4 - API/UI Contract and Test Hardening (2 days)

### Tasks
- Add DB-path integration tests (not only mock-source tests).
- Add contract tests:
  - Top-50 universe consistency across endpoints
  - ticker fallback correctness
  - sector enrichment freshness behavior
- Keep UI copy aligned with real source-of-truth counts.

### Candidate files
- `src/lib/data/aggregate-queries.test.ts`
- `src/test/integration/*`
- `src/components/market/market-hub-panel.tsx` (if count wording changes)

### Acceptance tests
- CI fails on Top-50 mismatch regression.
- CI fails on ticker/sector coverage regression below thresholds.

### Done when
- Regression vectors are protected in CI.

---

## Phase 5 - Rollout, Verification, Alerting (1 day)

### Tasks
- Deploy migrations and run one-time backfill.
- Activate scheduled enrichment.
- Run post-deploy quality checklist.
- Wire alerts for coverage/freshness/failure-rate thresholds.

### Backfill and reprocessing strategy
- Run in chunks with checkpointing (`last_processed_cusip` and `processed_count`) to allow safe resume.
- Keep deterministic batch ordering by `cusip ASC`.
- Retry failed chunks with exponential backoff; park persistent failures into dead-letter table/log.
- Emit run ledger summary: scanned, inserted, updated, skipped, failed, duration.

### Rollback plan
- If KPI regression is detected after cutover:
  1. switch API read path back to pre-cutover query mode via feature flag
  2. pause scheduled enrichment jobs
  3. keep new tables but deactivate new active mappings (`is_active=false`) for affected source version
  4. restore previous stable mapping snapshot from backup/export
  5. rerun quality checks and reopen traffic
- Rollback exit condition: core KPI returns to pre-release baseline or better.

### Rollout order
1. Schema migration(s)
2. Backfill job execution
3. API logic switch to canonical Top-50 and ticker chain
4. Scheduled enrichment activation
5. Monitoring and alerts enablement

### Done when
- All KPI checks pass in staging and production smoke checks.

## 5) Sprint Plan (Execution-Ready)

### Sprint 1 (Week 1): Stabilize Core Semantics + Ticker Recovery Foundation

### Tickets
- SP1-01 Baseline SQL and quality doc
  - Output: baseline scripts + documented initial metrics
  - Effort: 0.5d
- SP1-02 Canonical latest filing selector
  - Output: shared latest-filing selector function/view
  - Effort: 0.5d
- SP1-03 Canonical Top-50 selector and endpoint alignment
  - Output: manager directory + market aggregate same universe
  - Effort: 1.0d
- SP1-04 Add `security_identity_map` migration
  - Output: schema + indexes + constraints
  - Effort: 0.5d
- SP1-05 Implement ticker enrichment job (batch + idempotent)
  - Output: runnable enrichment script + run stats
  - Effort: 1.0d
- SP1-06 Integrate ticker fallback chain in aggregate queries
  - Output: improved ticker population in API responses
  - Effort: 0.5d
- SP1-07 Cross-endpoint universe contract test
  - Output: explicit assertion that directory Top-50 equals market aggregate universe
  - Effort: 0.5d

### Sprint 1 Definition of Done
- Top-50 endpoint consistency tests pass.
- Ticker missing rate materially reduced versus baseline in staging.
- All new schema and scripts documented.

---

### Sprint 2 (Week 2): GICS Automation + Hardening + Rollout

### Tickets
- SP2-01 Enrichment ops trigger implementation (replace stub behavior)
  - Output: real execution path and status reporting
  - Effort: 1.0d
- SP2-02 Sector auto-map pipeline integration and schedule
  - Output: automated periodic refresh
  - Effort: 0.5d
- SP2-03 Sector coverage quality gates and alert thresholds
  - Output: quality query + alert config
  - Effort: 0.5d
- SP2-04 DB-path integration tests for Top-50/ticker/sector
  - Output: CI regression coverage
  - Effort: 1.0d
- SP2-05 UI/API contract verification and copy alignment
  - Output: market tracking count semantics aligned
  - Effort: 0.5d
- SP2-06 Production rollout + post-deploy verification report
  - Output: release checklist and KPI validation log
  - Effort: 0.5d
- SP2-07 Rollback rehearsal
  - Output: verified rollback runbook and measured RTO
  - Effort: 0.5d

### Sprint 2 Definition of Done
- Sector mapping automation is live and repeatable.
- KPI thresholds met in post-deploy checks.
- Regression tests and alarms operational.

## 6) Risk Register and Mitigations

- External resolver rate limit or outage
  - Mitigation: queue + retry/backoff + incremental resume checkpoint
- Identifier ambiguity (multiple tickers for one CUSIP over time)
  - Mitigation: active/inactive versioning + effective timestamps + confidence scoring
- Ranking drift from late filings/amendments
  - Mitigation: deterministic latest selector + periodic recompute + lineage checks
- Sector taxonomy/provider drift
  - Mitigation: pinned source version and explicit refresh logs

## 7) Operational Checklist (Runbook Snapshot)

- Daily
  - Run/verify enrichment job status
  - Check ticker missing and sector coverage dashboards
- Weekly
  - Review unresolved CUSIPs and unknown sectors
  - Validate top-50 stability and major rank jumps
- Release time
  - Run baseline SQL checks pre/post
  - Confirm API contract test suite passed

## 8) Immediate Next Actions

1. Approve this plan as execution baseline.
2. Start Sprint 1 with SP1-01 to SP1-04 in parallel.
3. Run first staging backfill and measure KPI delta before Sprint 2 starts.
