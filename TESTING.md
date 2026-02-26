# Testing Guide

This repository uses a three-layer test layout:

- `src/test/unit/*.unit.test.ts`: isolated unit tests for pure modules and contracts.
- `src/test/component/*.component.test.tsx`: component rendering assertions with React Testing Library.
- `src/test/integration/*.integration.test.tsx`: cross-component behavior checks in a jsdom environment.
- `e2e/*.spec.ts`: browser smoke and end-to-end tests with Playwright.

## Commands

- `npm run test`: runs unit, component, and integration suites through Vitest.
- `npm run test:e2e`: runs Playwright smoke tests with local web server bootstrapping.

## Selector Conventions

- Prefer semantic role-based locators first (`getByRole`, `getByLabel`).
- Use `data-testid` only for shell anchors that need durable smoke coverage.
- Keep selector names stable and feature-scoped (for example, `dashboard-shell-title`).
