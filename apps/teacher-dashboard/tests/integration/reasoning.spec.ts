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
    // Three states, not two (INT-STUDIUM-030 R1): the breakdown, "no signals arrived", and
    // "signals arrived but every scene's own contributors were under the floor". The third
    // used to render as the second, which is a false claim about the course rather than a
    // missing state — and a locator listing only two states would have kept passing on it.
    const container = page.getByTestId("reasoning-breakdown")
      .or(page.getByTestId("withheld-notice")).or(page.getByText(/Aucun signal/i));
    await expect(container.first()).toBeVisible({ timeout: 10_000 });
  });
});
