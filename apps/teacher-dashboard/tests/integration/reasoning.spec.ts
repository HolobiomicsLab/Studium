import { test, expect } from "@playwright/test";

const COURSE_TOKEN = process.env.E2E_COURSE_TOKEN ?? "e2e-course";

test.describe("/courses/[token]/reasoning", () => {
  test("renders page header and nav", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/reasoning`);
    await expect(page.getByRole("heading", { name: /Qualité du raisonnement/i })).toBeVisible();
    await expect(page.locator("text=/Erreur API/i")).toHaveCount(0);
  });

  test("renders breakdown container or empty state", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/reasoning`);
    const container = page.locator(
      '[data-testid="reasoning-breakdown"], text=/Aucun signal/i',
    );
    await expect(container.first()).toBeVisible({ timeout: 10_000 });
  });
});
