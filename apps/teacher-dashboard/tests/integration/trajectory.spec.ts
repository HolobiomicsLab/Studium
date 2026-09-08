import { test, expect } from "@playwright/test";

const COURSE_TOKEN = process.env.E2E_COURSE_TOKEN ?? "e2e-course";

test.describe("/courses/[token]/trajectory", () => {
  test("renders the page with header and nav", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/trajectory`);
    await expect(page.getByRole("heading", { name: /Cours/i })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Trajectoire longitudinale/i }),
    ).toBeVisible();
    await expect(page.locator("text=/Erreur API/i")).toHaveCount(0);
  });

  test("renders the chart container or empty state", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/trajectory`);
    const chartOrEmpty = page.locator(
      '[data-testid="trajectory-chart"], text=/Aucune donnée/i',
    );
    await expect(chartOrEmpty.first()).toBeVisible({ timeout: 10_000 });
  });

  test("navigation to other tabs is present", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/trajectory`);
    await expect(page.getByRole("link", { name: /Progression/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Calibration/i })).toBeVisible();
    // INT-STUDIUM-023: the tab's label, not its route, carries the indicator's name.
    await expect(page.getByRole("link", { name: /Critique \/ indice/i })).toBeVisible();
  });
});
