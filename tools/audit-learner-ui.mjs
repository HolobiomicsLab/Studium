#!/usr/bin/env node
/** Local Chromium audit of the learner frontend with an explicit in-memory Tauri IPC double.
 * Run after starting Vite: node tools/audit-learner-ui.mjs [output-directory].
 * Fixtures are read unchanged; native storage, Keychain and telemetry delivery are not tested.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "apps/teacher-dashboard/package.json"));
const { chromium, expect } = require("@playwright/test");
const baseURL = process.env.LEARNER_URL ?? "http://127.0.0.1:5186";
const output = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(resolve(tmpdir(), "studium-learner-ui-"));
await mkdir(output, { recursive: true });
const paths = ["fixtures/m3/demo-metabolomics/lesson.json", "fixtures/m6/demo-atomistique/lesson.json", "fixtures/atomistique-l1/lesson.json"];
const fixtures = await Promise.all(paths.map(async (path) => {
  const raw = await readFile(resolve(root, path), "utf8");
  return { path, sha256: createHash("sha256").update(raw).digest("hex"), lesson: JSON.parse(raw) };
}));
const report = { boundary: "Real browser/frontend; in-memory IPC double; unchanged fixture lessons; no native storage or model calls", fixtures: fixtures.map(({ path, sha256 }) => ({ path, sha256 })), checks: [], findings: [], screenshots: [] };
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
const errors = [];

async function capture(page, name) {
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  report.screenshots.push(`${name}.png`);
}

async function checkLayout(page, name) {
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(layout.scrollWidth <= layout.width, `${name} overflows: ${JSON.stringify(layout)}`);
  report.checks.push({ name, ...layout });
}

async function openPage({ width = 1280, mode = "normal", corpus = fixtures.slice(0, 2) } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(error.message));
  // This test-only boundary is installed before the real application loads.
  await page.addInitScript(({ fixtures, mode }) => {
    let consent = null;
    window.__AUDIT_FAIL_LISTING__ = mode === "error";
    const states = new Map();
    const entries = fixtures.map(({ lesson, path }) => ({ path, bundle_id: lesson.bundle_id, title: lesson.metadata.title, n_scenes: lesson.scenes.length }));
    window.__TAURI_INTERNALS__ = { invoke: async (command, args = {}) => {
      switch (command) {
        case "get_consent": return consent;
        case "set_consent": consent = args.record; return;
        case "list_bundles":
          if (window.__AUDIT_FAIL_LISTING__) throw "Dossier inaccessible (audit synthétique)";
          return mode === "empty" ? [] : entries;
        case "load_bundle": {
          const fixture = fixtures.find(({ path }) => path === args.path);
          if (!fixture) throw "lesson.json absent (audit synthétique)";
          return JSON.stringify(fixture.lesson);
        }
        case "get_pseudonyme": return "synthetic-ui-audit";
        case "load_state": return states.get(args.lessonId) ?? null;
        case "save_state": states.set(args.lessonId, args.stateValue); return;
        case "append_event": return;
        case "telemetry_outbox_drain": return [];
        case "telemetry_outbox_count": return 0;
        case "telemetry_outbox_push": return;
        case "delete_all_data": states.clear(); consent = null; return;
        default: throw new Error(`Unimplemented audit IPC: ${command}`);
      }
    } };
  }, { fixtures: corpus, mode });
  await page.goto(baseURL);
  await expect(page.getByRole("heading", { name: "Bienvenue dans Studium" })).toBeVisible();
  return page;
}

async function grantRequiredConsent(page) {
  await expect(page.getByRole("button", { name: "Continuer", exact: true })).toBeDisabled();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Continuer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mes leçons" })).toBeVisible();
}

try {
  const page = await openPage();
  await capture(page, "consent-desktop");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Aller au contenu" })).toBeFocused();
  report.checks.push({ name: "keyboard skip link is the first focus target", passed: true });
  await grantRequiredConsent(page);
  await expect(page.getByTestId("library-load-bundle")).toHaveCount(2);
  await capture(page, "library-desktop");
  await checkLayout(page, "library desktop");
  const search = page.getByRole("searchbox", { name: "Rechercher une leçon" });
  await search.fill("METABOLOMIQUE");
  await expect(page.getByTestId("library-load-bundle")).toHaveCount(1);
  await search.fill("no-match");
  await page.getByRole("button", { name: "Effacer la recherche" }).click();
  await expect(page.getByTestId("library-load-bundle")).toHaveCount(2);
  report.checks.push({ name: "accent-insensitive search and clear", passed: true });
  await page.getByTestId("library-load-bundle").first().click();
  await expect(page.getByTestId("lesson-player")).toBeVisible();
  await expect(page.getByRole("link", { name: "Réglages", exact: true })).toHaveCount(0);
  await capture(page, "lesson-desktop");
  // Drive visible controls only; never read answer keys to select a response.
  let steps = 0;
  while (!(await page.getByRole("heading", { name: "Leçon terminée", exact: true }).isVisible()) && steps < 20) {
    const position = await page.locator(".player-position").textContent();
    const radios = page.getByRole("radio");
    if (await radios.count() && await radios.first().isEnabled()) {
      await radios.first().check();
      await page.getByRole("button", { name: "Quitter la leçon", exact: true }).click();
      await page.getByRole("button", { name: "Rester dans la leçon" }).click();
      await expect(radios.first()).toBeChecked();
      await capture(page, `quiz-${steps}`);
      await page.getByRole("button", { name: "Soumettre", exact: true }).click();
    }
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    try {
      await expect.poll(() => page.evaluate(() => document.querySelector(".player-position")?.textContent ?? "complete"), { timeout: 1500 }).not.toBe(position);
    } catch {
      report.findings.push({ name: "Continue did not advance or reset the scene", position, step: steps });
      await capture(page, `continue-without-progress-${steps}`);
    }
    steps += 1;
  }
  await expect(page.getByRole("heading", { name: "Leçon terminée", exact: true })).toBeVisible();
  await capture(page, "lesson-complete");
  report.checks.push({ name: "unchanged metabolomics fixture completed through visible controls", scenes: steps });
  report.checks.push({ name: "cancelling lesson exit preserves the unsent quiz choice", passed: true });
  await page.getByRole("link", { name: "Réglages", exact: true }).click();
  await page.getByRole("button", { name: "Effacer mes données", exact: true }).click();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.getByRole("button", { name: "Oui, tout effacer" })).toHaveCount(0);
  await capture(page, "settings-desktop");
  report.checks.push({ name: "data deletion can be cancelled", passed: true });
  await page.close();

  const mobile = await openPage({ width: 390 });
  await checkLayout(mobile, "consent mobile");
  await capture(mobile, "consent-mobile");
  await grantRequiredConsent(mobile);
  assert.equal(await mobile.evaluate(() => scrollY), 0, "Next screen opens at its top");
  await checkLayout(mobile, "library mobile");
  await capture(mobile, "library-mobile");
  const target = await mobile.getByTestId("library-load-bundle").first().boundingBox();
  assert.ok(target.height >= 44 && target.width >= 44);
  await mobile.getByTestId("library-load-bundle").first().click();
  await expect(mobile.getByTestId("lesson-player")).toBeVisible();
  await checkLayout(mobile, "lesson mobile");
  await capture(mobile, "lesson-mobile");
  await mobile.getByRole("button", { name: "Quitter la leçon", exact: true }).click();
  await capture(mobile, "lesson-exit-mobile");
  await mobile.getByRole("button", { name: "Quitter et revenir à la bibliothèque" }).click();
  await expect(mobile.getByTestId("library-load-bundle")).toHaveCount(2);
  await mobile.close();

  const failed = await openPage({ mode: "error" });
  await grantRequiredConsent(failed);
  await expect(failed.getByRole("alert")).toContainText("Dossier inaccessible");
  await capture(failed, "library-error");
  await failed.evaluate(() => { window.__AUDIT_FAIL_LISTING__ = false; });
  await failed.getByRole("button", { name: "Réessayer" }).click();
  await expect(failed.getByTestId("library-load-bundle")).toHaveCount(2);
  await failed.goto(`${baseURL}/lesson/missing?bundle=missing`);
  await expect(failed.getByRole("alert")).toContainText("lesson.json absent");
  await capture(failed, "lesson-error");
  report.checks.push({ name: "native string errors surface and listing retries", passed: true });
  await failed.close();

  const empty = await openPage({ mode: "empty" });
  await grantRequiredConsent(empty);
  await expect(empty.getByRole("heading", { name: "Aucune leçon installée." })).toBeVisible();
  await capture(empty, "library-empty");
  await empty.close();

  const unsupported = await openPage({ width: 390, corpus: fixtures.slice(2) });
  await grantRequiredConsent(unsupported);
  await unsupported.getByTestId("library-load-bundle").first().click();
  for (let scene = 0; scene < 3; scene += 1) {
    const position = await unsupported.locator(".player-position").textContent();
    if (await unsupported.getByRole("radio").count()) {
      await unsupported.getByRole("radio").first().check();
      await unsupported.getByRole("button", { name: "Soumettre", exact: true }).click();
    }
    await unsupported.getByRole("button", { name: "Continuer", exact: true }).click();
    await expect.poll(() => unsupported.locator(".player-position").textContent()).not.toBe(position);
  }
  const notice = unsupported.getByTestId("unsupported-scene");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Rien n’est évalué ici");
  const noticeStyle = await notice.evaluate((element) => ({ padding: parseFloat(getComputedStyle(element).paddingLeft), background: getComputedStyle(element).backgroundColor }));
  assert.ok(noticeStyle.padding >= 16 && noticeStyle.background !== "rgba(0, 0, 0, 0)");
  await checkLayout(unsupported, "unsupported scene mobile");
  await capture(unsupported, "unsupported-scene-mobile");
  await unsupported.close();
  report.checks.push({ name: "unsupported scene remains a padded warning and says it is unassessed", passed: true });
  assert.deepEqual(errors, [], "No uncaught browser errors");
  report.checks.push({ name: "uncaught browser errors", count: errors.length });
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
