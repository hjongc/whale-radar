# Refactoring Plan

## 1) Objectives and Non-Goals

- Reduce change risk in core data and UI flows without changing user-facing behavior.
- Decrease file-level complexity and coupling in aggregation/query and dashboard UI layers.
- Eliminate duplicated pipeline logic across Python/Node scripts.
- Improve test signal quality (fewer brittle assertions, less seed/copy coupling).
- Non-goal: redesigning product UX or changing API contracts in this pass.

## 2) Current Hotspots (Why this plan)

- Data aggregation monolith: `src/lib/data/aggregate-queries.ts` (~1191 LOC).
- Whale panel orchestration monolith: `src/components/whales/whale-insider-panel.tsx` (~569 LOC).
- Market panel mixes derivation + rendering: `src/components/market/market-hub-panel.tsx` (~418 LOC).
- Script duplication and drift risk:
  - `scripts/auto-map-ticker-sectors.py`
  - `scripts/auto-map-ticker-sectors.mjs`
  - `scripts/refresh-identity-and-sectors-yahoo.py`
  - `scripts/refresh-ticker-yahoo.py`
- Test brittleness in component/e2e assertions tied to classes, static text, and ordering.

## 3) Guiding Principles

- Behavior-preserving refactor first; feature changes later.
- Extract seams/interfaces before moving logic.
- Keep public API and route payloads stable.
- Prefer pure functions for heavy derivation logic.
- Replace implementation-detail tests with contract/behavior tests.

## 4) Three-Phase Execution Plan

### Phase 1 - Safety Net and Test Stabilization (highest priority)

**Duration:** 2-3 days  
**Risk:** Low  
**Primary outcome:** confidence to refactor larger modules safely

#### Work items

- Replace brittle assertions in component tests:
  - Move from class/querySelector checks to role/testid/semantic behavior checks in `src/test/component/whale-insider-panel.component.test.tsx`.
  - Reduce hard-coded seed-value dependence in `src/test/component/market-hub-panel.component.test.tsx`.
- Remove timing/order fragility in E2E:
  - Eliminate hard sleeps and `.first()`-based assumptions in `e2e/*.spec.ts`.
  - Introduce reusable E2E helpers for "open whale page / wait ready / apply filter".
- Consolidate duplicated fixture loaders:
  - Centralize parser and pipeline fixtures via `src/test/integration/helpers/pipeline-fixtures.ts` (or `src/test/helpers/fixtures.ts`).
- Add stable test builders/matchers:
  - Example: DTO builders + contract matchers shared across integration/component tests.

#### Deliverables

- Test helper module(s) and fixture builders.
- Updated flaky-prone specs.
- Baseline test report before/after (runtime + failure consistency).

#### Exit criteria

- No hard sleeps in critical E2E paths.
- Core suite green consistently across repeated local runs.
- Reduced copy/style-coupled assertions.

### Phase 2 - Core Data Module Decomposition

**Duration:** 4-6 days  
**Risk:** Medium  
**Primary outcome:** modular query/aggregation architecture with clear boundaries

#### Target file

- `src/lib/data/aggregate-queries.ts`

#### Proposed module split

- `src/lib/data/repo/*`
  - DB/Supabase fetch adapters and snapshot data retrieval.
- `src/lib/data/snapshot/*`
  - Snapshot assembly and normalization.
- `src/lib/data/aggregators/market.ts`
  - Market-level derivations.
- `src/lib/data/aggregators/whale.ts`
  - Whale-level derivations.
- `src/lib/data/formatters/*`
  - Shared percent/gap/label formatting helpers.
- Keep `aggregate-queries.ts` as a thin composition/facade layer initially.

#### Concrete refactors

- Remove duplicated map-building and previous-position logic (currently repeated around `src/lib/data/aggregate-queries.ts:876` and `src/lib/data/aggregate-queries.ts:1075`).
- Separate DB path vs fallback/mock path behind a strategy/provider interface.
- Extract deterministic, pure calculation functions and unit test them directly.
- Keep existing return DTO shape unchanged.

#### Deliverables

- New internal module boundaries and barrel exports.
- Characterization tests proving no payload contract regressions.
- Reduced LOC and cyclomatic complexity in `aggregate-queries.ts`.

#### Exit criteria

- Public API unchanged; integration tests pass.
- `aggregate-queries.ts` reduced to orchestration-level complexity.
- No duplicated `previousByCusip/previousByTicker` logic remaining.

### Phase 3 - UI Orchestration Split + Script Consolidation

**Duration:** 4-6 days  
**Risk:** Medium  
**Primary outcome:** simpler UI state flow and one canonical operational script path

#### A) Whale + Market panel refactor

**Targets**

- `src/components/whales/whale-insider-panel.tsx`
- `src/components/market/market-hub-panel.tsx`
- `src/components/common/route-fallbacks.tsx` (reuse surface)

**Work items**

- Extract Whale hooks:
  - `useWhaleQuerySync` (URL/search param sync)
  - `useWhaleDirectory` (manager list loading/retry)
  - `useWhaleHoldings` (table data fetch/state)
- Split presentational components from orchestration controller.
- Move Market derivation logic into pure utilities (view-model layer), keep panel mostly declarative render.

**Exit criteria**

- Component files are mostly rendering + composition.
- Hooks cover side effects and cancellation behavior cleanly.
- Existing UX and route behavior unchanged.

#### B) Script canonicalization

**Targets**

- `scripts/auto-map-ticker-sectors.py`
- `scripts/auto-map-ticker-sectors.mjs`
- `scripts/refresh-identity-and-sectors-yahoo.py`
- `scripts/refresh-ticker-yahoo.py`
- `scripts/enrich-cusip-ticker.mjs`

**Work items**

- Pick canonical runtime (Python or Node) for sector/identity refresh.
- Move shared concerns to reusable modules:
  - DB shell adapter (`run_psql`, SQL literal escaping)
  - shared SQL templates
  - provider client wrappers + retry/rate controls
- Keep non-canonical scripts as thin wrappers temporarily; remove after parity validation.
- Add command modes (`identity-only`, `sector-only`, `combined`) to reduce script fragmentation.

**Exit criteria**

- One source of truth for identity/sector mapping logic.
- No duplicated core SQL/query/upsert logic across two runtimes.
- Operational commands documented and reproducible.

## 5) Suggested Timeline (2-week practical plan)

### Week 1

- Day 1-2: Phase 1 test stabilization + helper extraction.
- Day 3-5: Phase 2 module seam creation + first extraction set.

### Week 2

- Day 1-2: Finish Phase 2 extraction and cleanup.
- Day 3-4: Phase 3A UI hook/component split.
- Day 5: Phase 3B script canonicalization scaffolding + parity checks.

## 6) Risk Register and Mitigations

- Regression in aggregate semantics
  - Mitigation: characterization tests before extraction, keep route payload contracts fixed.
- Subtle effect-order bugs in Whale panel
  - Mitigation: hook extraction with focused mount/unmount/abort tests.
- Script behavior drift during canonicalization
  - Mitigation: fixture-based parity run (same input snapshot => same writes/log summary).
- Over-scoping refactor
  - Mitigation: phase gates and small PRs (one concern per PR).

## 7) Success Metrics

- Complexity/size:
  - `aggregate-queries.ts` reduced significantly (target: orchestration-only footprint).
  - `whale-insider-panel.tsx` reduced to compositional container.
- Test quality:
  - Reduced brittle assertions tied to static copy/classes/order.
  - Lower flaky retry/re-run requirement in E2E.
- Duplication:
  - Shared DB helper and SQL templates used across scripts.
  - Canonical sector/identity pipeline path established.
- Delivery:
  - No API contract changes for aggregate routes.
  - All existing critical integration tests remain green.

## 8) PR Slicing Strategy (recommended)

- PR1: Test helper infrastructure + flaky test cleanup.
- PR2: Aggregate query seam extraction (no behavior change).
- PR3: Aggregate logic extraction (market/whale calculators).
- PR4: Whale panel hooks + presentational split.
- PR5: Market derivation extraction.
- PR6: Script runtime canonicalization + wrapper deprecation.

## 9) Runtime Environment Modes (Explicit execution options)

Use one of the following runtime profiles for every refactor run. Record the selected profile in the PR description and test report.

**Default profile for this project:** `local-remote`  
Run Next.js locally, use Supabase (deployed) as DB.

### Profile matrix

| Profile ID | App Server | Database | Typical use | Risk level |
| --- | --- | --- | --- | --- |
| `local-local` | Local (`npm run dev`) | Local/Sandbox DB | Fast iteration during refactor | Low |
| `local-remote` | Local (`npm run dev`) | Deployed DB | Validate query behavior against real-like data | Medium |
| `remote-remote` | Deployed app | Deployed DB | Final smoke and contract verification | High |
| `remote-local` | Deployed app | Local DB tunnel/proxy | Not recommended; use only for debugging infra | High |

### Required environment variables by profile

All profiles must provide values defined in `.env.example`, especially:

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PROJECT_REF`
- `CRON_SECRET`

Profile-specific expectations:

- `local-local`
  - `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`
  - Supabase variables point to local/sandbox project.
- `local-remote`
  - `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`
  - Supabase variables point to deployed project.
- `remote-remote`
  - `NEXT_PUBLIC_API_BASE_URL` points to deployed app URL.
  - Supabase variables point to deployed project.
- `remote-local`
  - Only if network tunneling/proxy is configured and documented.

### Recommended run commands per profile

#### `local-local`

```bash
npm run dev
npm run test
npm run test:e2e
```

#### `local-remote`

```bash
npm run dev
npm run test
# run only targeted integration/e2e suites that require remote data checks
npm run test:e2e
```

#### `remote-remote`

```bash
npm run build
npm run start
# run smoke checks against deployed endpoint
```

#### `remote-local`

```bash
# only for explicit infra debugging; avoid as standard refactor validation mode
```

### Execution policy by phase

- Phase 1 (test stabilization): default `local-remote`; use `local-local` only for fast isolated debugging.
- Phase 2 (data decomposition): `local-remote` as primary development/verification mode.
- Phase 3A (UI split): `local-remote` primary, optional final smoke in `remote-remote`.
- Phase 3B (script canonicalization): `local-remote` primary for realistic provider/DB behavior, optional `remote-remote` smoke for ops endpoints.

### Traceability requirement

Each PR should include:

- Selected profile ID (`local-local`, `local-remote`, `remote-remote`, or `remote-local`).
- Exact command set executed.
- Test scope executed (unit/component/integration/e2e).
- Any environment-specific caveats (for example, remote rate limits).
