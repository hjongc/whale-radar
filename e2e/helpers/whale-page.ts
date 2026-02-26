import { expect, type Locator, type Page } from "@playwright/test";

const DEFAULT_WHALE_SLUG = "berkshire-hathaway";

function positionsRows(page: Page): Locator {
  return page.locator('[data-testid^="positions-row-"]');
}

export async function waitForWhalePositionsReady(page: Page): Promise<void> {
  await expect(page.getByRole("combobox")).toBeVisible();
  await expect.poll(async () => positionsRows(page).count()).toBeGreaterThan(0);
}

export async function openWhalePage(page: Page, whaleSlug = DEFAULT_WHALE_SLUG): Promise<void> {
  await page.goto(`/whales?whale=${whaleSlug}`);
  await waitForWhalePositionsReady(page);
}

export async function resolveTickerForInteraction(page: Page): Promise<string> {
  const preferredTickers = ["AAPL", "MSFT", "AMZN", "NVDA"];

  for (const ticker of preferredTickers) {
    if (await page.getByTestId(`positions-row-${ticker}`).count()) {
      return ticker;
    }
  }

  const tickers = await positionsRows(page).evaluateAll((rows) =>
    rows
      .map((row) => row.getAttribute("data-ticker"))
      .filter((ticker): ticker is string => Boolean(ticker))
  );

  if (tickers.length === 0) {
    throw new Error("Expected at least one positions row ticker.");
  }

  return [...tickers].sort((a, b) => a.localeCompare(b))[0];
}

export async function applyWhaleActionFilter(page: Page, filter: "ALL" | "NEW" | "ADD" | "REDUCE" | "KEEP"): Promise<void> {
  await page.getByRole("tab", { name: filter }).click();
  await expect(page.getByRole("tab", { name: filter })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("active-action-filter")).toContainText(filter);
}

export async function expectOnlyActionRows(page: Page, filter: "NEW" | "ADD" | "REDUCE" | "KEEP"): Promise<void> {
  await expect.poll(async () =>
    positionsRows(page).evaluateAll(
      (rows, action) => rows.every((row) => row.getAttribute("data-type") === action),
      filter
    )
  ).toBeTruthy();
}
