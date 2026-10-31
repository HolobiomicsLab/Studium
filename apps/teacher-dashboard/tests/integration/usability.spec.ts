import { expect, test, type Locator, type Page } from "@playwright/test";

const COURSE_TOKEN = process.env.E2E_COURSE_TOKEN ?? "e2e-course";
const MINIMUM_TOUCH_TARGET = 44;
const LOCAL_BROWSER = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

test.use({
  launchOptions: LOCAL_BROWSER ? { executablePath: LOCAL_BROWSER } : undefined,
});

async function expectMinimumHeight(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, "the control should have a rendered box").not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(MINIMUM_TOUCH_TARGET);
}

async function openCourse(page: Page) {
  await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/progress`);
  await expect(page.getByRole("heading", { name: /Progression par scène/i })).toBeVisible();
}

test.describe("teacher dashboard shell", () => {
  test("marks the active destination and groups all twelve course views", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openCourse(page);

    const navigation = page.getByRole("navigation", { name: "Navigation du cours" });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("link")).toHaveCount(12);
    await expect(navigation.getByRole("link", { name: "Progression" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    for (const group of ["Vue d’ensemble", "Apprentissages", "Pratiques", "Pilotage"]) {
      await expect(navigation.getByText(group, { exact: true })).toBeVisible();
    }

    for (const link of await navigation.getByRole("link").all()) {
      await expectMinimumHeight(link);
    }
  });

  test("opens a compact course menu and navigates at 390 px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCourse(page);

    const menuButton = page.getByRole("button", { name: "Afficher la navigation du cours" });
    await expect(menuButton).toBeVisible();
    await expectMinimumHeight(menuButton);
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");

    await menuButton.click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    const navigation = page.getByRole("navigation", { name: "Navigation du cours" });
    await expect(navigation.getByRole("link", { name: "Calibration", exact: true })).toBeVisible();
    await navigation.getByRole("link", { name: "Calibration", exact: true }).click();

    await expect(page).toHaveURL(
      new RegExp(`/courses/${encodeURIComponent(COURSE_TOKEN)}/calibration$`),
    );
    const movedMenuButton = page.getByRole("button", {
      name: /Afficher la navigation du cours, vue actuelle : Calibration/,
    });
    await expect(movedMenuButton).toBeVisible();
    await movedMenuButton.click();
    await expect(
      page
        .getByRole("navigation", { name: "Navigation du cours" })
        .getByRole("link", { name: "Calibration", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });

  test("gives the course-entry controls touch-sized targets", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expectMinimumHeight(page.getByLabel("Identifiant du cours"));
    await expectMinimumHeight(page.getByRole("button", { name: "Ouvrir le cours" }));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
});
