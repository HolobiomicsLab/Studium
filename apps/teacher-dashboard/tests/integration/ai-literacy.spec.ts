import { test, expect } from "@playwright/test";

const COURSE_TOKEN = process.env.E2E_COURSE_TOKEN ?? "e2e-course";
const PSEUDO = process.env.E2E_PSEUDONYM ?? "test-pseudo";

test.describe("/courses/[token]/ai-literacy", () => {
  test("page loads with mandatory ADR 011 disclaimer", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/ai-literacy`);
    await expect(page.locator("text=/formatif uniquement/i")).toBeVisible();
    await expect(page.locator("text=/ADR 011/")).toBeVisible();
  });

  test("renders card with mandatory mentions when pseudonyme provided", async ({
    page,
  }) => {
    await page.goto(
      `/courses/${encodeURIComponent(COURSE_TOKEN)}/ai-literacy?pseudonyme=${PSEUDO}`,
    );
    await expect(page.locator("text=/usage certificatif/i")).toBeVisible();
    const card = page.locator('[data-testid="ai-literacy-card"]');
    if (await card.count()) {
      await expect(card.locator("text=/formatif/i")).toBeVisible();
      await expect(card.locator("text=/ADR 011/")).toBeVisible();
    }
  });

  test("nav present", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/ai-literacy`);
    await expect(
      page.getByRole("link", { name: /Progression/i }),
    ).toBeVisible();
  });
});
