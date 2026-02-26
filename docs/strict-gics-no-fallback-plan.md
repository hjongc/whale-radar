# Strict GICS No-Fallback Data Collection Plan

Last updated: 2026-02-24
Scope: Top-50 market/whales aggregates, sector classification, identity enrichment
Constraints: FMP excluded, sector fallback minimized

## 1) Principles

- Sector classification follows GICS only.
- No inferred sector fallback at serve time.
- Supabase is storage/serving/lineage backend, not primary market-data truth.
- Missing mappings stay explicit as `Unknown`/`Unclassified` until resolved.

## 2) Source-of-Truth Model

- Filing and holdings truth: SEC ingest pipeline.
- Price and gap enrichment truth: Yahoo price pipeline.
- Identity mapping truth: deterministic resolver chain without FMP.
- Sector mapping truth: curated `security_sector_map` rows with GICS code+label.

## 3) Target Data Contracts

### 3.1 `security_identity_map`

- Keep active/inactive versioned rows.
- Required fields: `cusip`, `ticker`, `source`, `source_version`, `confidence`, `updated_at`.
- Rule: exactly one active row per CUSIP.

### 3.2 `security_sector_map`

- Store only valid GICS sectors.
- Required fields: `sector_code`, `sector_label`, `source`, `source_version`, `confidence`, `updated_at`.
- Rule: active mapping must have GICS-compliant code/label pair.
- Non-GICS or ambiguous values are not promoted to active mappings.

## 4) Resolver Strategy (FMP Excluded)

### 4.1 CUSIP -> Ticker

Priority chain:
1. Direct filing symbol from parsed positions.
2. Existing active `security_identity_map`.
3. SEC-derived reference matching (company ticker registry + deterministic issuer/cik rules).
4. Approved identifier resolver (for example OpenFIGI) with throttling and confidence score.

Rules:
- No ad-hoc regex guessing for ticker generation.
- Low-confidence candidates are parked for review, not activated.

### 4.2 Ticker -> GICS Sector

Priority chain:
1. Existing active GICS mapping with valid lineage.
2. Approved upstream sector source mapped to canonical GICS taxonomy.

Rules:
- No runtime fallback to ad-hoc sector buckets.
- If unresolved, keep `Unknown`/`Unclassified`.

## 5) Serving Behavior (Strict Mode)

- API aggregate logic returns sector only from active GICS mapping.
- Remove or disable sector fallback branches that infer from alternative labels.
- For unresolved sectors, preserve explicit unknown state and lineage reason.
- UI displays unknown status without synthetic substitutions.

## 6) Pipeline Design

### 6.1 Batch Jobs

- Identity backfill job:
  - input: unresolved CUSIPs from latest canonical Top-50 holdings
  - output: upserted `security_identity_map` rows with lineage
- Sector backfill job:
  - input: resolved tickers without active GICS mapping
  - output: upserted `security_sector_map` rows with lineage

### 6.2 Scheduling

- Daily incremental refresh for identity and sector maps.
- Manual replay endpoint for targeted recovery.
- Deterministic batch ordering and checkpoint resume.

### 6.3 Failure Handling

- Retry with exponential backoff.
- Dead-letter unresolved records with reason codes.
- Do not partially activate uncertain mappings.

## 7) Quality Gates and SLAs

### 7.1 KPI Targets

- `top50_institution_count = 50`
- `top50_ticker_missing_rate_pct <= 20`
- `top50_sector_coverage_pct >= 80`
- `top50_unknown_sector_ratio_pct <= 15`
- `non_positive_holding_rows = 0`

### 7.2 Freshness SLA

- Identity map freshness: <= 24h from last successful run.
- Sector map freshness: <= 24h from last successful run.
- Breach behavior: warning threshold then hard gate on repeated breach windows.

### 7.3 Deployment Gate

- No production promotion if sector coverage/unknown ratio KPI misses threshold.
- No production promotion if lineage completeness is below target.

## 8) Observability and Lineage

- Persist run-level metrics: scanned, inserted, updated, skipped, failed, duration.
- Persist row-level provenance: source, source_version, confidence, effective window.
- Add dashboard tiles for coverage, freshness, and failure-rate trends.

## 9) Execution Plan

### Phase A - Contract Hardening (0.5d)

- Validate `security_sector_map` contract for strict GICS-only active rows.
- Add checks for missing `source_version` and stale `updated_at`.

### Phase B - FMP Removal and Resolver Replacement (1.5d)

- Replace FMP calls in identity and sector scripts with approved providers.
- Keep script interfaces and ops trigger contract stable.

### Phase C - Strict Serve Path (1.0d)

- Refactor aggregate query sector resolution to no-fallback strict mode.
- Ensure unknowns are explicit and counted.

### Phase D - Gates and Regression Tests (1.0d)

- Extend SQL quality checks and CI assertions.
- Add DB-path integration tests for strict sector behavior.

### Phase E - Staging Backfill and Cutover (1.0d)

- Run one-time staged backfill.
- Measure KPI deltas.
- Enable scheduled refresh and monitor for 7 days.

## 10) Risks and Mitigations

- Resolver API rate limits
  - Mitigation: throttling, checkpointing, resumable runs.
- Ambiguous identifier mappings
  - Mitigation: confidence threshold + manual review queue.
- Coverage drop after fallback removal
  - Mitigation: pre-cutover staged backfill and strict release gates.

## 11) Definition of Done

- FMP references removed from enrichment path.
- Sector serve path is strict GICS with no synthetic fallback.
- KPI thresholds pass in staging and remain stable for 7 days.
- Lineage and freshness observability operational.
