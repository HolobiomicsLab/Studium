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

  test("names the withdrawn instrument instead of implying an empty learner trajectory", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/trajectory`);
    // INT-STUDIUM-030 withdrew this endpoint for every class.
    await expect(page.getByRole("heading", { name: "Indicateur indisponible" })).toBeVisible();
    await expect(page.getByTestId("trajectory-chart")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Chiffres retenus/ })).toHaveCount(0);
  });

  test("navigation to other tabs is present", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/trajectory`);
    await expect(page.getByRole("link", { name: /Progression/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Calibration/i })).toBeVisible();
    // INT-STUDIUM-023: the tab's label, not its route, carries the indicator's name.
    await expect(page.getByRole("link", { name: /Critique \/ indice/i })).toBeVisible();
  });
});
