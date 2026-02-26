import { expect, test } from "@playwright/test";

import { waitForWhalePositionsReady } from "./helpers/whale-page";

test("loading skeleton appears during delayed whale fetch", async ({ page }) => {
  let releaseRouteBlock = () => {};
  const routeBlocker = new Promise<void>((resolve) => {
    releaseRouteBlock = () => resolve();
  });

  await page.route(/\/api\/aggregates\/whales\/berkshire(\?.*)?$/, async (route) => {
    await routeBlocker;
    await route.continue();
  });

  const navigation = page.goto("/whales?whale=berkshire-hathaway");

  await expect
    .poll(async () => page.locator('[data-testid="loading-placeholder"]:visible').count(), {
      timeout: 15000
    })
    .toBeGreaterThan(0);

  releaseRouteBlock();
  await navigation;

  await page.screenshot({
    fullPage: true,
    path: ".sisyphus/evidence/task-18-loading-state.png"
  });

  await waitForWhalePositionsReady(page);
  await expect(page.getByTestId("loading-placeholder")).toHaveCount(0);
});

test("error panel appears with retry action on whale API failure", async ({ page }) => {
  await page.route(/\/api\/aggregates\/whales\/berkshire(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "forced_failure",
          message: "Forced API failure for resilience QA"
        }
      })
    });
  });

  await page.goto("/whales?whale=berkshire-hathaway");

  await expect(page.locator(".error-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry manager load" })).toBeVisible();

  await page.screenshot({
    fullPage: true,
    path: ".sisyphus/evidence/task-18-error-boundary.png"
  });
});
