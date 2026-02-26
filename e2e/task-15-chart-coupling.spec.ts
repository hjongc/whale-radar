import { expect, test } from "@playwright/test";

import { openWhalePage, resolveTickerForInteraction, waitForWhalePositionsReady } from "./helpers/whale-page";

test("gap bar click highlights matching position row", async ({ page }) => {
  await openWhalePage(page);

  const ticker = await resolveTickerForInteraction(page);
  const targetRow = page.getByTestId(`positions-row-${ticker}`);
  await expect(targetRow).toBeVisible();

  const gapBar = page.getByTestId(`gap-bar-${ticker}`);
  await expect(gapBar).toBeVisible();

  await gapBar.click();
  await expect(targetRow).toHaveClass(/row-highlight/);

  await expect
    .poll(async () => {
      return await targetRow.evaluate((row) => {
        const rect = row.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
      });
    })
    .toBeTruthy();

  await page.screenshot({
    fullPage: true,
    path: ".sisyphus/evidence/task-15-gap-click.png"
  });
});

test("unknown action label shows fallback and keeps filter unchanged", async ({ page }) => {
  await page.route(/\/api\/aggregates\/whales\/berkshire(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as {
      actionMix: Array<{ type: string; count: number }>;
    };

    await route.fulfill({
      response,
      json: {
        ...payload,
        actionMix: [{ type: "LEGACY", count: 2 }, ...payload.actionMix]
      }
    });
  });

  await openWhalePage(page);

  const rows = page.locator('[data-testid^="positions-row-"]');
  const initialRowCount = await rows.count();
  await expect(page.getByTestId("active-action-filter")).toContainText("ALL");

  await page.click('[data-testid="change-mix-segment-UNKNOWN"]');

  await expect(page.getByTestId("action-label-warning")).toContainText(
    'Unsupported action label "Unsupported (LEGACY)". Filter remains unchanged.'
  );
  await expect(page.getByTestId("active-action-filter")).toContainText("ALL");

  await waitForWhalePositionsReady(page);
  const afterClickRowCount = await rows.count();
  expect(afterClickRowCount).toBe(initialRowCount);

  await page.screenshot({
    fullPage: true,
    path: ".sisyphus/evidence/task-15-unknown-label.png"
  });
});
