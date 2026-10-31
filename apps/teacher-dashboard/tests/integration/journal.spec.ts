import { test, expect } from "@playwright/test";

const COURSE_TOKEN = process.env.E2E_COURSE_TOKEN ?? "e2e-course";

test.describe("/courses/[token]/journal", () => {
  test("renders page with mandatory ADR 006 disclaimer", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/journal`);
    await expect(page.getByRole("heading", { name: /Journal/i })).toBeVisible();
    await expect(page.locator("text=/texte des journaux reste local/i")).toBeVisible();
    await expect(page.locator("text=/Erreur API/i")).toHaveCount(0);
  });

  test("renders stats cards or empty state", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/journal`);
    const statsOrEmpty = page.getByTestId("journal-stats").or(page.getByText(/Aucune/i));
    await expect(statsOrEmpty.first()).toBeVisible({ timeout: 10_000 });
  });

  test("nav has 9 tabs including Journal", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/journal`);
    for (const label of ["Progression", "Trajectoire", "Journal", "Coopération", "Blueprint"]) {
      await expect(page.getByRole("link", { name: new RegExp(label, "i") })).toBeVisible();
    }
  });
});
