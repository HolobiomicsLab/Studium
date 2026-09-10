#!/usr/bin/env node
/** Captures the real teacher UI backed by audit-collector-live.py on an isolated collector. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "apps/teacher-dashboard/package.json"));
const { chromium, expect } = require("@playwright/test");
const baseURL = process.env.TEACHER_URL ?? "http://127.0.0.1:3106";
const output = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(resolve(tmpdir(), "studium-teacher-ui-"));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const report = { boundary: "Real teacher frontend and real local collector; only the three seeded synthetic courses", views: [], screenshots: [] };

async function capture(name) {
  const measured = await page.evaluate(() => ({
    width: innerWidth, scrollWidth: document.documentElement.scrollWidth, sheets: document.styleSheets.length,
    heading: document.querySelector("article h2, main h1")?.textContent,
  }));
  assert.ok(measured.sheets > 0, "Stylesheet is loaded");
  assert.ok(measured.scrollWidth <= measured.width, `Horizontal overflow on ${name}`);
  report.views.push({ name, ...measured });
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  report.screenshots.push(`${name}.png`);
}

async function openCourse(token, route) {
  await page.goto(`${baseURL}/courses/${token}/${route}`);
  await expect(page.locator("article h2")).toBeVisible();
  await page.waitForLoadState("networkidle");
}

try {
  await page.goto(baseURL);
  await capture("teacher-home-desktop");
  await page.getByLabel("Identifiant du cours").fill("studium-audit-cohort");
  await page.getByRole("button", { name: "Ouvrir le cours" }).click();
  await expect(page.getByTestId("progress-cell")).toHaveCount(2);
  await expect(page.getByTestId("progress-cell").filter({ hasText: "s-quiz" })).toContainText("80%");
  const navigation = page.getByRole("navigation", { name: "Navigation du cours" });
  await expect(navigation.getByRole("link")).toHaveCount(12);
  const destinations = await navigation.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  for (const href of destinations) {
    await page.goto(`${baseURL}${href}`);
    await expect(page.locator("article h2")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("navigation", { name: "Navigation du cours" }).locator('[aria-current="page"]')).toHaveCount(1);
    await capture(`teacher-${href.split("/").pop()}-desktop`);
  }
  await openCourse("studium-audit-private", "progress");
  await expect(page.getByRole("heading", { name: /Chiffres retenus/ })).toBeVisible();
  await expect(page.getByTestId("progress-cell")).toHaveCount(0);
  await capture("teacher-private-desktop");
  await openCourse("studium-audit-anonymous", "progress");
  await expect(page.getByRole("note")).toContainText("unknown identity");
  await expect(page.getByTestId("progress-cell")).toHaveCount(0);
  await capture("teacher-unknown-identity");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL);
  await capture("teacher-home-mobile");
  await openCourse("studium-audit-cohort", "progress");
  await capture("teacher-progress-mobile");
  await page.getByRole("button", { name: /Afficher la navigation du cours/ }).click();
  await capture("teacher-navigation-mobile");
  await page.getByRole("navigation", { name: "Navigation du cours" }).getByRole("link", { name: "Calibration", exact: true }).click();
  await expect(page.locator("article h2")).toContainText("Calibration");
  await capture("teacher-calibration-mobile");
  await openCourse("studium-audit-private", "progress");
  await capture("teacher-private-mobile");
  assert.deepEqual(errors, [], "No uncaught browser errors");
  report.browserErrors = errors;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, ...report }, null, 2));
}
