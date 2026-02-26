# Local Supabase Migration/Reset Playbook

This playbook covers safe local reset and recovery for migration issues.

## Guardrails

- Local only: use these commands only against local Supabase runtime.
- Never run with production credentials or remote DB URL.
- Capture evidence before and after reset under `.sisyphus/evidence/`.
- Prefer `npx supabase db reset --local` over ad-hoc table drops for clean recovery.

## Baseline Recovery Flow (Controlled Reset)

1) Confirm stack status

```bash
npx supabase status
```

2) Run deterministic local reset

```bash
npx supabase db reset --local
```

Expected output includes:
- `Recreating database...`
- `Applying migration 20260221000100_whaleinsight_baseline.sql...`
- `Seeding data from supabase/seed.sql...`
- `Finished supabase db reset on branch main.`

3) Verify seeded baseline rows

```bash
docker exec -i supabase_db_whaleinsight-pro-mvp psql -U postgres -d postgres -c "\
select count(*) as institutions_count from public.institutions;\
select count(*) as filings_count from public.filings;\
select count(*) as positions_count from public.positions;\
select count(*) as run_ledger_count from public.run_ledger;\
"
```

## Failure Classification

- `daemon_unavailable`
  - Symptom: Docker socket/daemon unavailable.
  - Action: recover Docker first, then rerun reset.

- `migration_apply_failed`
  - Symptom: reset fails while applying migration SQL.
  - Action: inspect failing statement, patch migration branch locally, rerun reset.

- `seed_failed`
  - Symptom: migration succeeds but seed application fails.
  - Action: inspect `supabase/seed.sql` constraints and FK dependencies, rerun reset.

- `ordering_dependency_failure`
  - Symptom: FK/enum dependency errors similar to misordered application.
  - Action: do not manually replay partial statements; rerun full `db reset --local`.

## Misordered Migration Recovery Sequence

1. Stop partial/manual DDL attempts.
2. Re-run `npx supabase db reset --local` to rebuild from canonical migration order.
3. Re-verify baseline row counts and key seed accessions.
4. Record incident evidence and failing SQL signature.
