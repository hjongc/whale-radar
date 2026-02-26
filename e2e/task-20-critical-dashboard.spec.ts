import { expect, test, type Page } from "@playwright/test";

import { applyWhaleActionFilter, expectOnlyActionRows, resolveTickerForInteraction, waitForWhalePositionsReady } from "./helpers/whale-page";

async function captureFailureSnapshot(page: Page, testTitle: string) {
  const sanitizedTitle = testTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  await page.screenshot({
    fullPage: true,
    path: `.sisyphus/evidence/task-20-failure-${sanitizedTitle}.png`
  });
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    await captureFailureSnapshot(page, testInfo.title);
  }
});

test("core dashboard journey covers tab, selection, gap highlight, and pie coupling", async ({ page }) => {
  await page.goto("/market");
  await expect(page.locator("#section-market")).toBeVisible();

  await page.getByRole("button", { name: "운용사 동향" }).click();
  await expect(page.locator("#section-whale")).toBeVisible();

  await expect(page.locator(".whale-select")).toBeVisible();
  await page.selectOption(".whale-select", "berkshire-hathaway");
  await expect(page).toHaveURL(/\/market\?whale=berkshire-hathaway/);
  await expect(page.locator(".wi-insight-banner")).toContainText("Berkshire Hathaway 보유 동향");

  await waitForWhalePositionsReady(page);
  const focusTicker = await resolveTickerForInteraction(page);
  const focusedRow = page.getByTestId(`positions-row-${focusTicker}`);
  await expect(focusedRow).toBeVisible();

  await page.getByTestId(`gap-bar-${focusTicker}`).click();
  await expect(focusedRow).toHaveClass(/row-highlight/);

  await page.getByTestId("change-mix-segment-NEW").click();
  await expect(page.getByTestId("active-action-filter")).toContainText("NEW");
  await expect(page.getByRole("tab", { name: "NEW" })).toHaveAttribute("aria-selected", "true");
  await expectOnlyActionRows(page, "NEW");

  await page.screenshot({
    fullPage: true,
    path: ".sisyphus/evidence/task-20-core-journey.png"
  });
});

test.describe("mobile regression path", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("mobile controls remain visible and interactions remain usable", async ({ page }) => {
    await page.goto("/whales?whale=berkshire-hathaway");

    await expect(page.locator(".whale-select")).toBeVisible();
    const whaleDirectorySearch = page.getByRole("searchbox", {
      name: "기관명 또는 대표 매니저 검색"
    });
    await expect(whaleDirectorySearch).toBeVisible();
    await whaleDirectorySearch.fill("berkshire");
    await expect(page.locator(".whale-select")).toBeVisible();

    const controlsInViewport = await page
      .locator(".whale-select")
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      });
    expect(controlsInViewport).toBeTruthy();

    await waitForWhalePositionsReady(page);
    const focusTicker = await resolveTickerForInteraction(page);

    await page.getByTestId(`gap-bar-${focusTicker}`).click();
    await expect(page.getByTestId(`positions-row-${focusTicker}`)).toHaveClass(/row-highlight/);

    await applyWhaleActionFilter(page, "NEW");
    await expectOnlyActionRows(page, "NEW");

    await page.screenshot({
      fullPage: true,
      path: ".sisyphus/evidence/task-20-mobile-journey.png"
    });
  });
});
