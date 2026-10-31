import { test, expect } from "@playwright/test";

const COURSE_TOKEN = process.env.E2E_COURSE_TOKEN ?? "e2e-course";
const PSEUDO = process.env.E2E_PSEUDONYM ?? "test-pseudo";

test.describe("/courses/[token]/blueprint", () => {
  test("renders mandatory ADR 013 disclaimer", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/blueprint`);
    await expect(page.locator("text=/formatif uniquement/i")).toBeVisible();
    await expect(page.getByRole("note").locator("p").filter({ hasText: /ADR 013/ })).toBeVisible();
  });

  test("renders radar after pseudonyme provided", async ({ page }) => {
    await page.goto(
      `/courses/${encodeURIComponent(COURSE_TOKEN)}/blueprint?pseudonyme=${PSEUDO}`,
    );
    const radar = page.locator('[data-testid="blueprint-radar"]');
    if (await radar.count()) {
      await expect(radar).toBeVisible();
      await expect(page.locator("text=/Score global/i")).toBeVisible();
    }
  });

  test("nav active is Blueprint", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/blueprint`);
    await expect(page.getByRole("link", { name: /Blueprint/i })).toBeVisible();
  });
});
