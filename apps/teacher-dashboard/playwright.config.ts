import { defineConfig, devices } from "@playwright/test";

const COLLECTOR_BASE_URL =
  process.env.ANALYTICS_BASE_URL ?? "http://localhost:8003";
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT ?? "3001");

/**
 * Playwright config for the teacher-dashboard.
 *
 * Two execution paths:
 *
 * 1. CI / orchestrated (tools/e2e-c2.sh):
 *    - analytics-collector is already running on $ANALYTICS_BASE_URL.
 *    - tools/e2e-c2.sh starts the Next dev server itself.
 *    - This config skips the `webServer` block when DASHBOARD_PORT_EXTERNAL=1,
 *      letting the orchestrator own server lifecycle.
 *
 * 2. Local dev:
 *    - We start the Next dev server via the `webServer` block.
 *    - The collector must be running externally (see tools/e2e-c2.sh for the
 *      uvicorn invocation, or run analytics-collector manually on port 8003).
 */
const externalServer = process.env.DASHBOARD_PORT_EXTERNAL === "1";

export default defineConfig({
  testDir: "./tests/integration",
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${DASHBOARD_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
      },
    },
  ],
  ...(externalServer
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          port: DASHBOARD_PORT,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          env: {
            ANALYTICS_BASE_URL: COLLECTOR_BASE_URL,
          },
        },
      }),
});
