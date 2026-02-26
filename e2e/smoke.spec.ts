import { expect, test } from "@playwright/test";

test("dashboard shell smoke", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("dashboard-shell")).toBeVisible();
  await expect(page.getByTestId("dashboard-shell-title")).toHaveText("기관 보유공시 분석 대시보드");
  await expect(page.getByRole("navigation", { name: "대시보드 탭" })).toBeVisible();
});
