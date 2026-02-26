# Local Supabase Readiness Gate

This checklist defines deterministic readiness checks before local persistence validation.

## Commands

1) Docker daemon health

```bash
docker info
```

Expected ready signal:
- command returns exit code `0`
- output includes both `Client:` and `Server:` sections

2) Supabase stack status

```bash
npx supabase status
```

Expected ready signal:
- command returns exit code `0`
- status output includes API/DB/Studio endpoints

3) Supabase start health gate

```bash
npx supabase start
```

Expected ready signal:
- command returns exit code `0`
- no container-health failure text

4) Port collision precheck (Supabase defaults)

```bash
lsof -nP -iTCP:54321 -iTCP:54322 -iTCP:54323
```

Interpretation:
- empty output: no local collision detected
- non-empty output: classify as `port_collision`

## Failure Taxonomy

- `daemon_unavailable`
  - Signature: `Cannot connect to the Docker daemon` or missing Docker socket.
  - Recovery:
    1. Start Docker Desktop.
    2. Re-run `docker info` until `Server:` is present.
    3. Re-run `npx supabase start`.

- `supabase_cli_failure`
  - Signature: Supabase CLI command exits non-zero with parser/runtime error not tied to daemon connectivity.
  - Recovery:
    1. Verify Node/npm tooling and `npx supabase --version`.
    2. Re-run with `--debug` to classify root cause.

- `port_collision`
  - Signature: `lsof` reports listeners on configured ports in `supabase/config.toml`.
  - Recovery:
    1. Stop conflicting process.
    2. Or adjust `supabase/config.toml` local ports.
    3. Re-run readiness checks.

- `service_unhealthy`
  - Signature: `npx supabase start` returns health-check failure despite daemon availability.
  - Recovery:
    1. Collect `npx supabase start --debug` output.
    2. Run `npx supabase stop` then retry `npx supabase start`.
    3. If still failing, perform controlled reset in A5 flow.

## Gate Rule

Proceed to A3 persistence workflow only when all of the following are true:
- `docker info` succeeds with `Server:` data.
- `npx supabase status` succeeds.
- `npx supabase start` succeeds.
- no unresolved `port_collision`.
