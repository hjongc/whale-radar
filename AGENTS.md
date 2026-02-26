# AGENTS.md

Guide for agentic coding tools operating in this repository.

## 1) Repo Snapshot

- Framework: Next.js 14 App Router + React 18.
- Language: TypeScript (`strict: true`).
- Tests: Vitest (jsdom) + Playwright.
- Package manager: npm (`package-lock.json` present).
- Path alias: `@/*` -> `src/*`.
- Main folders:
  - `src/app`: routes and API handlers.
  - `src/components`: UI components.
  - `src/lib`: domain/data/ops/network logic.
  - `src/test`: unit/component/integration tests.
  - `e2e`: Playwright specs.

## 2) Install and Local Dev

```bash
npm install
npm run dev
npm run dev -- --hostname 127.0.0.1 --port 3000
```

## 3) Build/Lint/Test Commands

From `package.json`:

```bash
npm run build
npm run start
npm run lint
npm run test
npm run test:e2e
npm run scan:client-secrets
```

Additional useful check (no script exists yet):

```bash
npx tsc --noEmit
```

Recommended pre-merge gate:

```bash
npm run lint && npm run test && npm run build
```

## 4) Single-Test Commands (Most Important)

Vitest via npm forwarding (`--` is required):

```bash
# single file
npm run test -- src/lib/metrics/vwap.test.ts

# single test title
npm run test -- -t "computes quarter window VWAP"

# single file + single title
npm run test -- src/lib/metrics/vwap.test.ts -t "computes quarter window VWAP"
```

Playwright via npm forwarding:

```bash
# single spec
npm run test:e2e -- e2e/smoke.spec.ts

# single title pattern
npm run test:e2e -- -g "smoke"

# headed / debug
npm run test:e2e -- --headed e2e/smoke.spec.ts
npm run test:e2e -- --debug e2e/smoke.spec.ts
```

## 5) Testing Layout

- Unit: `src/test/unit/*.unit.test.ts` and many `src/lib/**/*.test.ts` files.
- Component: `src/test/component/*.component.test.tsx`.
- Integration: `src/test/integration/*.integration.test.tsx`.
- E2E: `e2e/*.spec.ts`.
- Vitest config: `vitest.config.ts` with `environment: "jsdom"` and `setupFiles: ["./src/test/setup.ts"]`.

Testing expectations:

- Prefer semantic selectors (`getByRole`, `getByLabel`) before `data-testid`.
- Keep tests deterministic; use in-memory/fixed fixtures where available.
- Validate API contracts with status code + payload shape checks.

## 6) Style Rules from Existing Code

### Imports

- Use ESM imports, double quotes, and semicolons.
- Prefer alias imports (`@/lib/...`, `@/components/...`) for internal modules.
- Typical ordering:
  1) framework/external imports,
  2) blank line,
  3) internal alias imports.
- Use `import type` for type-only imports when possible.

### Formatting

- Keep current code style consistent:
  - double quotes,
  - semicolons,
  - trailing commas where formatter applies.
- Favor small pure helper functions for parsing/validation transforms.
- Keep route files lean; put reusable logic in `src/lib/*`.

### Types and Contracts

- Preserve `strict` TypeScript behavior; avoid `any`.
- Define explicit interfaces/types for DTOs, options, and dependency injection.
- Prefer union/string-literal types for constrained values.
- Narrow `unknown` in catches before using error values.

### Naming

- Components/types/interfaces/classes: PascalCase.
- Functions/variables: camelCase.
- Constants and enum-like arrays: UPPER_SNAKE_CASE.
- Filenames: kebab-case (`whale-insider-panel.tsx`, `aggregate-route-handlers.ts`).
- Test names: behavior/contract oriented (clear expected outcomes).

### Error Handling

- Throw meaningful `Error` messages for invariant/validation failures.
- In API routes, map known errors to structured JSON and correct status codes.
- Unknown route errors should return safe `500` payloads.
- In client effects, explicitly ignore abort cancellations (`AbortError`).

## 7) API and Ops Notes

- API routes live under `src/app/api/*`.
- Ops triggers (`/api/ops/*`) depend on auth via `CRON_SECRET` contract.
- Keep query validation strict (`mode`, `scope`, boolean flags) and deterministic.
- Operational scripts available:
  - `npm run identity:enrich-cusip-ticker`
  - `npm run identity:refresh-ticker-yahoo`
  - `npm run sectors:auto-map`
  - `npm run portfolios:refresh`
  - `npm run whales:snapshots:refresh`

## 8) Cursor/Copilot Rule Files Check

Checked and not found in this repo:

- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

If these files are later added, treat them as higher-priority local instructions and update this file.

## 9) Agent Working Agreement

- Make minimal, targeted changes; avoid unrelated refactors.
- Do not commit secrets (`.env*`, private keys, tokens).
- Add/update tests when behavior changes.
- Run the smallest relevant test scope first, then broader checks.
- For broad changes, run full gate: lint + tests + build.
- Keep this `AGENTS.md` updated when scripts, tooling, or conventions change.
