import { test, expect } from "@playwright/test";

/**
 * Integration spec for the teacher-dashboard /courses/[token]/progress page.
 *
 * This spec is invoked by `tools/e2e-c2.sh` after the WDIO student parcours has
 * populated the analytics-collector with telemetry events. It also runs
 * standalone against any collector exposing the same /metrics/progress
 * contract.
 *
 * Pre-condition (orchestrator):
 *   - analytics-collector listening on $ANALYTICS_BASE_URL (default
 *     http://localhost:8003)
 *   - dashboard Next dev server on port $DASHBOARD_PORT (default 3001,
 *     started by `webServer` config unless DASHBOARD_PORT_EXTERNAL=1)
 *   - course token `e2e-course` populated with ≥4 scenes via WDIO (cf.
 *     telemetry-end-to-end.spec.ts assertion).
 *
 * The course token is overridable via $E2E_COURSE_TOKEN for re-use with other
 * test corpora.
 */

const COURSE_TOKEN = process.env.E2E_COURSE_TOKEN ?? "e2e-course";

test.describe("/courses/[token]/progress", () => {
  test("renders the page with course header and nav", async ({ page }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/progress`);

    // Header reflects the course token.
    await expect(page.getByRole("heading", { name: /Cours/i })).toBeVisible();
    await expect(page.locator("code", { hasText: COURSE_TOKEN })).toBeVisible();

    // Section heading present.
    await expect(
      page.getByRole("heading", { name: /Progression par scène/i }),
    ).toBeVisible();

    // No API error banner.
    await expect(page.locator("text=/Erreur API/i")).toHaveCount(0);
  });

  test("renders at least one progress cell from collector data", async ({
    page,
  }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/progress`);

    const cells = page.locator('[data-testid="progress-cell"]');
    // Wait up to 10s for SSR fetch to complete and DOM to mount.
    await expect(cells.first()).toBeVisible({ timeout: 10_000 });

    // After WDIO parcours: ≥4 scenes (see e2e-c2.sh assertion).
    // Standalone runs may have fewer; assert ≥1 here so the spec stays useful
    // for smoke tests against any populated collector.
    const count = await cells.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // Each cell carries a percentage + a learner count. Verify the first one
    // matches the rendered shape.
    const first = cells.first();
    await expect(first).toContainText(/%/);
    await expect(first).toContainText(/apprenant/);
  });

  test("navigation links to calibration and autonomy are present", async ({
    page,
  }) => {
    await page.goto(`/courses/${encodeURIComponent(COURSE_TOKEN)}/progress`);

    await expect(page.getByRole("link", { name: /Calibration/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Autonomie/i })).toBeVisible();
  });
});
