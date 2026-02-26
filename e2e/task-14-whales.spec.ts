import { expect, test } from "@playwright/test";

import { openWhalePage, waitForWhalePositionsReady } from "./helpers/whale-page";

test("whale selector syncs URL and banner context", async ({ page }) => {
  await page.goto("/whales");

  const whaleSelect = page.getByRole("combobox");
  await expect(whaleSelect).toBeVisible();
  await whaleSelect.selectOption("duquesne-family-office");
  await expect(page).toHaveURL(/whale=duquesne-family-office/);

  await whaleSelect.selectOption("berkshire-hathaway");
  await waitForWhalePositionsReady(page);
  await expect(page).toHaveURL(/whale=berkshire-hathaway/);
  await expect(page.locator(".wi-insight-banner")).toContainText("Berkshire Hathaway 보유 동향");

  await page.screenshot({
    fullPage: true,
    path: ".sisyphus/evidence/task-14-select-sync.png"
  });
});

test("whale search renders explicit no-results state", async ({ page }) => {
  await openWhalePage(page);

  await page
    .getByRole("searchbox", {
      name: "기관명 또는 대표 매니저 검색"
    })
    .fill("zzzz-nonexistent-whale");
  await expect(page.getByTestId("whale-search-no-results")).toBeVisible();

  await page.screenshot({
    fullPage: true,
    path: ".sisyphus/evidence/task-14-search-empty.png"
  });
});
