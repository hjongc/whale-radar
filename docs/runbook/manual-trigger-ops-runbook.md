# Manual Trigger Ops Runbook

This runbook covers the operational contract for manual ops triggers under `GET /api/ops/*`.

- Routes: `/api/ops/discovery`, `/api/ops/ingest`, `/api/ops/enrichment`
- Auth: `Authorization: Bearer <CRON_SECRET>` (or `x-cron-secret` fallback)
- Local scope caveat: `enrichment` now executes local scripts (`scripts/enrich-cusip-ticker.mjs`, `scripts/refresh-identity-and-sectors-yahoo.py`, `scripts/auto-map-ticker-sectors.py`). `discovery` and `ingest` still return deterministic acceptance payloads in local-only mode.
- DB caveat: local Supabase Docker runtime is not available in this environment, so run-ledger SQL checks are documented for DB-backed environments and contract-checked locally via integration tests.

## 1) Prerequisites

1. Install dependencies:

```bash
npm install
pip install yfinance requests pandas tqdm
```

2. Start the app with an ops secret:

```bash
CRON_SECRET=task-22-secret npm run dev -- --hostname 127.0.0.1 --port 3000
```

3. Wait until Next.js reports ready, then verify a 200 root response:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/"
```

Expected output:

```text
200
```

Known non-blocking warning: Next.js may print an `allowedDevOrigins` warning for `127.0.0.1` in dev mode. Treat this as non-failure for this runbook.

## 1.1) Yahoo Enrichment Runtime Profiles

Use these profiles when running `npm run identity:refresh-ticker-yahoo`:

- Conservative (default):

```bash
YH_SEARCH_WORKERS=2 YH_SECTOR_WORKERS=3 YH_GLOBAL_RPS=1.5 YH_GLOBAL_BURST=3 YH_SEARCH_DELAY_MS=180 YH_SECTOR_DELAY_MS=220
```

- Balanced (after stable runs):

```bash
YH_SEARCH_WORKERS=3 YH_SECTOR_WORKERS=4 YH_GLOBAL_RPS=2.0 YH_GLOBAL_BURST=4 YH_SEARCH_DELAY_MS=120 YH_SECTOR_DELAY_MS=150
```

- Fast (supervised backfill only):

```bash
YH_SEARCH_WORKERS=4 YH_SECTOR_WORKERS=6 YH_GLOBAL_RPS=3.0 YH_GLOBAL_BURST=6
```

Rollback rule:

- If structured summary shows `request_429_ratio_pct > 3`, immediately switch back to Conservative and rerun with `YH_SYMBOL_LIMIT` set to a smaller batch (for example `300`).

## 2) Query Flag Contract

- `mode`: `manual` or `replay`
- `dry-run`: boolean (`1/0`, `true/false`, `yes/no`, `on/off`)
- `replay`: boolean
- `priority-only`: boolean, default `true`
- `scope`: `priority` or `targeted`, default `priority`

Guardrail:

- `scope=targeted` cannot be combined with `priority-only=true` (returns HTTP `400`, `error.code=invalid_query`).

## 3) Authorized Manual Trigger Flow (Happy Path)

### Step A, manual dry-run, bounded scope

```bash
curl -sS -w "\nHTTP_STATUS=%{http_code}\n" \
  -H "Authorization: Bearer task-22-secret" \
  "http://127.0.0.1:3000/api/ops/ingest?mode=manual&scope=priority&dry-run=true&replay=false&priority-only=true"
```

Expected status code:

```text
HTTP_STATUS=200
```

Expected response shape:

- `runId`: non-empty UUID string
- `target`: `ingest` (or requested target route)
- `flags.mode`: `manual`
- `flags.dryRun`: `true`
- `status.state`: `queued`
- `status.counts`: object with numeric counters
- `status.warnings`: array

For `target=enrichment`, `status.counts` includes additional quality-gate metrics:

- `scriptsExecuted`
- `qualityChecksEvaluated`
- `top50TickerMissingRatePct`
- `top50SectorCoveragePct`
- `top50UnknownSectorRatioPct`
- `nonPositiveHoldingRows`

### Step B, manual live trigger

```bash
curl -sS -w "\nHTTP_STATUS=%{http_code}\n" \
  -H "Authorization: Bearer task-22-secret" \
  "http://127.0.0.1:3000/api/ops/discovery?mode=manual&scope=priority&dry-run=false&replay=false&priority-only=true"
```

Expected status code:

```text
HTTP_STATUS=200
```

Expected response shape:

- `flags.dryRun`: `false`
- `status.state`: `queued`

### Step C, replay scenario

```bash
curl -sS -w "\nHTTP_STATUS=%{http_code}\n" \
  -H "Authorization: Bearer task-22-secret" \
  "http://127.0.0.1:3000/api/ops/enrichment?mode=replay&scope=targeted&dry-run=true&replay=true&priority-only=false"
```

Expected status code:

```text
HTTP_STATUS=200
```

Expected response shape:

- `flags.mode`: `replay`
- `flags.replay`: `true`
- `flags.scope`: `targeted`
- `flags.priorityOnly`: `false`
- `status.state`: `replayed`

## 4) Failure Drill and Incident Triage

### Drill A, unauthorized request

```bash
curl -sS -w "\nHTTP_STATUS=%{http_code}\n" \
  "http://127.0.0.1:3000/api/ops/ingest?mode=manual&scope=priority"
```

Expected:

- `HTTP_STATUS=401`
- `error.code=unauthorized`

### Drill B, invalid boolean flag

```bash
curl -sS -w "\nHTTP_STATUS=%{http_code}\n" \
  -H "Authorization: Bearer task-22-secret" \
  "http://127.0.0.1:3000/api/ops/ingest?dry-run=maybe"
```

Expected:

- `HTTP_STATUS=400`
- `error.code=invalid_query`
- Message includes accepted boolean tokens

### Drill C, contradictory scope and priority-only

```bash
curl -sS -w "\nHTTP_STATUS=%{http_code}\n" \
  -H "Authorization: Bearer task-22-secret" \
  "http://127.0.0.1:3000/api/ops/ingest?scope=targeted&priority-only=true"
```

Expected:

- `HTTP_STATUS=400`
- `error.code=invalid_query`
- Message includes `scope=targeted` and `priority-only=true` contradiction

### Drill D, misconfigured deployment secret

Run a separate instance with no `CRON_SECRET` (example on `3001`) and call any ops route.

```bash
npm run dev -- --hostname 127.0.0.1 --port 3001
curl -sS -w "\nHTTP_STATUS=%{http_code}\n" \
  -H "Authorization: Bearer task-22-secret" \
  "http://127.0.0.1:3001/api/ops/ingest?mode=manual"
```

Expected:

- `HTTP_STATUS=401`
- `error.code=misconfigured`
- Message: `CRON_SECRET is not configured on this deployment.`

### Triage Checklist

1. Confirm HTTP status first: `200`, `400`, or `401`.
2. Inspect `error.code` (`unauthorized`, `invalid_query`, `misconfigured`) for routing to fix path.
3. Re-run with known-good query string from section 3A to isolate auth/query issues from trigger logic.
4. If `200` but downstream data is stale, move to run-ledger integrity checklist and DB-backed checks below.

## 5) Run Ledger Integrity Checklist

Use this checklist after any manual/replay trigger.

### API-level (all environments)

- [ ] `runId` exists and is non-empty.
- [ ] `status.state` is one of `queued|running|succeeded|failed|replayed`.
- [ ] `status.counts` exists and all values are numbers.
- [ ] `status.warnings` is an array (empty allowed).

### DB-backed ledger checks (Supabase/Postgres environments)

Run SQL against your `run_ledger` table for the returned `runId`:

```sql
select
  run_id,
  run_status,
  request_signature,
  row_counts,
  warnings,
  started_at,
  ended_at
from run_ledger
where run_id = '<RUN_ID_FROM_RESPONSE>';
```

Pass criteria:

- [ ] One row exists for the run.
- [ ] `run_status` is valid for the scenario (`succeeded`, `replayed`, or `failed`).
- [ ] `request_signature` is present, and matches replay partner runs for same accession/input.
- [ ] `row_counts` is populated and consistent with the run type.
- [ ] `warnings` explains bounded/full-scope behavior when relevant.

### Local fallback integrity check (no DB runtime)

Validate replay contract by test, this checks deterministic replay behavior including signature and warning/row-count expectations:

```bash
npm run test -- src/test/integration/task-19-replay-contract.integration.test.ts
```

Expected:

- command exits `0`
- assertions verify replay status, stable request signature, and replay warning text

## 6) Evidence Capture and Naming Convention

Repository convention:

- Directory: `.sisyphus/evidence/`
- Pattern: `task-{N}-{scenario-slug}.{ext}`

Task 22 required evidence files:

- `.sisyphus/evidence/task-22-runbook-happy.log`
- `.sisyphus/evidence/task-22-runbook-failure.log`

Recommended execution pattern:

```bash
# happy run
bash <runbook-happy-script> > .sisyphus/evidence/task-22-runbook-happy.log 2>&1

# failure drill
bash <runbook-failure-script> > .sisyphus/evidence/task-22-runbook-failure.log 2>&1
```

## 7) Replay and Recovery Procedure

1. Re-run with replay mode and explicit bounded intent:

```bash
curl -sS -w "\nHTTP_STATUS=%{http_code}\n" \
  -H "Authorization: Bearer <CRON_SECRET>" \
  "http://127.0.0.1:3000/api/ops/ingest?mode=replay&scope=targeted&dry-run=true&replay=true&priority-only=false"
```

2. Verify replay contract in response and ledger checks.
3. If replay still fails, capture failing payload and status code in an evidence log and escalate with:
   - route called
   - full query string
   - HTTP status and error payload
   - affected `runId` values
