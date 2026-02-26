import { expect, test } from "@playwright/test";

import { openWhalePage } from "./helpers/whale-page";

test("positions table renders without lineage badges", async ({ page }) => {
  await openWhalePage(page);

  const positionsTable = page.getByRole("table").first();
  await expect(positionsTable).toBeVisible();
  await expect(positionsTable.getByRole("columnheader", { name: "Ticker" })).toBeVisible();
  await expect(positionsTable.getByRole("columnheader", { name: "Value ($k)" })).toBeVisible();
  await expect(positionsTable.getByRole("columnheader", { name: "Shares" })).toBeVisible();
  await expect(positionsTable.locator(".lineage-badge")).toHaveCount(0);
  await expect(positionsTable.locator(".lineage-warning")).toHaveCount(0);
});

test("positions pagination is usable", async ({ page }) => {
  await openWhalePage(page);

  const pagination = page.getByTestId("positions-pagination");
  if ((await pagination.count()) > 0) {
    await expect(pagination).toBeVisible();
    await expect(pagination).toContainText("1 / ");

    await page.getByRole("button", { name: "다음" }).click();
    await expect(pagination).toContainText("2 / ");

    await page.getByRole("button", { name: "이전" }).click();
    await expect(pagination).toContainText("1 / ");
    return;
  }

  const rows = page.locator('[data-testid^="positions-row-"]');
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  expect(rowCount).toBeLessThanOrEqual(20);
});
