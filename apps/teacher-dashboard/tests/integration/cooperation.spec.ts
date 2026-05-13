import { test, expect } from "@playwright/test";

const COURSE_TOKEN = process.env.E2E_COURSE_TOKEN ?? "e2e-course";

test.describe("/courses/[token]/cooperation", () => {
  test("renders M4-deferred disclaimer", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/cooperation`);
    await expect(page.locator("text=/En attente de M4/i")).toBeVisible();
  });

  test("renders 4 KPI cards", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/cooperation`);
    const container = page.locator('[data-testid="cooperation-stats"]');
    await expect(container).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Sessions/i)).toBeVisible();
    await expect(page.getByText(/Convergence/i)).toBeVisible();
    await expect(page.getByText(/Couverture rôles/i)).toBeVisible();
    await expect(page.getByText(/Votes\/session/i)).toBeVisible();
  });

  test("nav active is Coopération", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/cooperation`);
    await expect(page.getByRole("link", { name: /Coopération/i })).toBeVisible();
  });
});
