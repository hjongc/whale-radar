import { expect, test } from "@playwright/test";

import { applyWhaleActionFilter, expectOnlyActionRows, openWhalePage, waitForWhalePositionsReady } from "./helpers/whale-page";

test("filter chip happy path including KEEP", async ({ page }) => {
  await openWhalePage(page);

  await applyWhaleActionFilter(page, "KEEP");
  await expectOnlyActionRows(page, "KEEP");

  await applyWhaleActionFilter(page, "ALL");
  await waitForWhalePositionsReady(page);

  await page.screenshot({
    fullPage: true,
    path: ".sisyphus/evidence/task-16-keep-filter.png"
  });
});

test("latest chip selection wins after chart-triggered filter", async ({ page }) => {
  await openWhalePage(page);
  await page.click('[data-testid="change-mix-segment-ADD"]');
  await expect(page.getByTestId("active-action-filter")).toContainText("ADD");

  await applyWhaleActionFilter(page, "NEW");
  await expectOnlyActionRows(page, "NEW");

  await page.screenshot({
    fullPage: true,
    path: ".sisyphus/evidence/task-16-filter-sync.png"
  });
});
