#!/usr/bin/env node
/** Audit practical activity-template behavior in a real local browser.
 * Usage: node tools/audit-practical-templates.mjs ACTIVITIES_DIR NEW_AUDIT_DIR
 */
import { createServer } from "node:http";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/teacher-dashboard/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const [activitiesArg, auditArg] = process.argv.slice(2);
if (!activitiesArg || !auditArg)
  throw new Error("Usage: audit-practical-templates.mjs ACTIVITIES_DIR NEW_AUDIT_DIR");

const activities = resolve(activitiesArg);
const audit = resolve(auditArg);
await mkdir(audit, { recursive: false });
const fixtureDir = join(audit, "browser-fixtures");
await mkdir(fixtureDir);
const report = {
  passed: false,
  boundary: "Real local Chromium over prepared public activities; no analysis, model, paid service, or external request",
  checks: [],
  screenshots: [],
  console_errors: [],
  external_requests: [],
};

function check(name, value, detail = "") {
  report.checks.push({ name, passed: Boolean(value), ...(detail ? { detail } : {}) });
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

function mime(path) {
  return extname(path) === ".html" ? "text/html; charset=utf-8" : "application/octet-stream";
}

function safePath(root, relative) {
  const path = resolve(root, relative);
  if (path !== root && !path.startsWith(root + "/")) throw new Error("outside root");
  return path;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const [namespace, ...parts] = decodeURIComponent(url.pathname).replace(/^\/+/, "").split("/");
    const root = namespace === "audit" ? audit : activities;
    const relative = namespace === "audit" ? parts.join("/") : [namespace, ...parts].join("/");
    const path = safePath(root, relative);
    response.writeHead(200, { "Content-Type": mime(path) });
    response.end(await readFile(path));
  } catch {
    response.writeHead(404); response.end("not found");
  }
});
await new Promise(resolveReady => server.listen(0, "127.0.0.1", resolveReady));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });

async function openPage(path, label, viewport = { width: 1360, height: 980 }) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.on("pageerror", error => report.console_errors.push(label + ": " + String(error)));
  page.on("request", request => {
    if (!request.url().startsWith(base) && !request.url().startsWith("blob:"))
      report.external_requests.push(label + ": " + request.url());
  });
  await page.goto(base + "/" + path);
  return page;
}

async function beginWithoutTrace(page) {
  await page.locator("#noTrace").click();
  check("trace choice moves focus to prediction", await page.evaluate(() => document.activeElement?.id === "prediction"));
  await page.locator("#prediction").fill("A bounded prediction made before viewing supplied results.");
  await page.locator("#reveal").click();
  check("reveal moves focus to the practical result", await page.evaluate(() => document.activeElement?.id === "experimentHeading"));
  check("progress identifies the observation step", await page.evaluate(() => document.querySelector("#progressObserve")?.getAttribute("aria-current") === "step"));
}

async function auditNewTemplate(templateId) {
  const indexPath = join(activities, templateId, "index.html");
  const exists = await fileExists(indexPath);
  check(templateId + ": prepared activity exists", exists);
  if (!exists) return;
  const page = await openPage(templateId + "/index.html", templateId);
  await beginWithoutTrace(page);
  const radios = page.locator('#experiment input[type="radio"]');
  check(templateId + ": exposes at least two native radio choices", await radios.count() >= 2);

  if (templateId === "diagnose-analysis") {
    const steps = page.locator('input[name="diagnosis-step"]');
    const repairs = page.locator('input[name="analysis-repair"]');
    check("diagnosis keeps step and repair judgments separate", await steps.count() >= 2 && await repairs.count() >= 2);
    await steps.first().check();
    await repairs.last().check();
    check("diagnosis prefixes semantic step choices", (await steps.first().getAttribute("value") || "").startsWith("step_"));
    check("diagnosis prefixes semantic repair choices", (await repairs.last().getAttribute("value") || "").startsWith("repair_"));
    const guidance = await page.locator("#diagnosisGuidance").innerText();
    check("diagnosis says supplied values were not executed", /supplied|captured/i.test(guidance) && /not run|does not run/i.test(guidance));
    check("diagnosis does not infer step correctness", /not.*correct|does not.*correct/i.test(await page.locator("#stepFeedback").innerText()));
    check("diagnosis labels the supported repair as a teaching criterion", /teaching criterion/i.test(await page.locator("#repairFeedback").innerText()));
    check("diagnosis result keeps its unit visible", (await page.locator("#repairResult").innerText()).trim().split(/\s+/).length >= 2);
  } else {
    const scenarios = page.locator('input[name="robustness-scenario"]');
    await scenarios.first().check();
    await scenarios.last().check();
    check("robustness prefixes semantic scenario choices", (await scenarios.last().getAttribute("value") || "").startsWith("scenario_"));
    const comparison = await page.locator("#scenarioFeedback").innerText();
    check("robustness compares scenario, baseline, and threshold", /baseline/i.test(comparison) && /threshold|criterion/i.test(comparison));
    check("robustness limits the conclusion to supplied scenarios", /supplied scenarios/i.test(comparison));
    check("robustness does not infer frequency or confidence", /frequency/i.test(comparison) && /confidence/i.test(comparison));
    check("robustness keeps metric units visible", (await page.locator("#scenarioValue").innerText()).trim().split(/\s+/).length >= 2);
  }

  await page.screenshot({ path: join(audit, templateId + "-desktop.png"), fullPage: true });
  report.screenshots.push(templateId + "-desktop.png");
  await page.close();

  const mobile = await openPage(templateId + "/index.html", templateId + " mobile", { width: 390, height: 844 });
  await beginWithoutTrace(mobile);
  check(templateId + ": revealed mobile layout has no horizontal overflow", await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ path: join(audit, templateId + "-mobile.png"), fullPage: true });
  report.screenshots.push(templateId + "-mobile.png");
  await mobile.close();
}

async function makePrecisionFixture() {
  const sourceDir = join(activities, "parameter-comparison");
  const activityText = await readFile(join(sourceDir, "activity.json"), "utf-8");
  const activity = JSON.parse(activityText);
  const config = activity.config;
  config.parameter = {
    id: "signed_gain", label: "Signed gain", unit: "×",
    min: -0.001, max: 0.001, step: 0.0001, baseline: -0.0002, variation: 0,
  };
  config.model = {
    kind: "linear_gain", fixed_input: -2, input_label: "Fixed voltage", input_unit: "V",
    output_label: "Computed current", output_unit: "A", equation: "current = gain × voltage",
  };
  config.oracle = { baseline_output: 0.0004, variation_output: 0, delta: -0.0004 };
  config.control = "The signed voltage stays fixed; only gain changes.";
  config.scope = "Compare a zero response with a small signed baseline while preserving the supplied units and precision.";
  config.prediction_prompt = "Predict the computed current when signed gain moves from -0.0002 to zero.";
  config.independent_checks = [
    { id: "small_baseline", description: "The supplied baseline calculation is +0.0004 A." },
    { id: "zero_variation", description: "Zero gain produces exactly 0.0000 A for the fixed input." },
  ];
  config.source = {
    id: "synthetic_precision_fixture",
    title: "Studium signed precision browser fixture",
    locator: "tools/audit-practical-templates.mjs",
    source_kind: "synthetic_fixture",
    statement: "These invented values exercise units, signed values, zero, and four-decimal precision.",
  };
  const configPath = join(fixtureDir, "precision-config.json");
  const outputDir = join(fixtureDir, "parameter-precision");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  const prepared = spawnSync(".venv/bin/python", [
    "tools/experience_templates.py", "prepare", "--template", "parameter-comparison",
    "--context", join(dirname(activities), "context.json"), "--out", outputDir, "--config", configPath,
  ], { cwd: process.cwd(), encoding: "utf-8" });
  if (prepared.status !== 0) throw new Error((prepared.stderr || prepared.stdout).trim());
  return join(outputDir, "index.html");
}

async function auditPrecisionAndKeyboard() {
  try {
    await makePrecisionFixture();
  } catch (error) {
    check("precision fixture can be derived from a prepared parameter activity", false, String(error));
    return;
  }
  const page = await openPage("audit/browser-fixtures/parameter-precision/index.html", "precision fixture");
  await beginWithoutTrace(page);
  const slider = page.getByLabel("Signed gain", { exact: true });
  const hasSlider = await slider.count() === 1;
  check("range control has an accessible parameter label", hasSlider);
  check("zero variation is displayed with its unit", await page.locator("#parameterValue").innerText() === "0.0000 ×");
  check("small positive baseline remains visible", await page.locator("#baselineValue").innerText() === "+0.0004 A");
  check("small negative change remains visible", await page.locator("#differenceValue").innerText() === "-0.0004 A");
  check("signed fixed input remains visible", await page.locator("#fixedInput").innerText() === "-2 V");
  if (hasSlider) {
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    check("keyboard changes the fine-grained slider by one step", await page.locator("#parameterValue").innerText() === "+0.0001 ×");
    check("range announces its displayed value and unit", await slider.getAttribute("aria-valuetext") === "+0.0001 ×");
  } else {
    check("keyboard changes the fine-grained slider by one step", false);
    check("range announces its displayed value and unit", false);
  }
  await page.screenshot({ path: join(audit, "parameter-precision.png"), fullPage: true });
  report.screenshots.push("parameter-precision.png");
  await page.close();
}

async function auditNoTraceCompletion() {
  const page = await openPage("parameter-comparison/index.html", "no-trace completion");
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  await beginWithoutTrace(page);
  await page.locator("#assistanceText").fill("I asked a peer to explain the units.");
  await page.locator("#requestAssistance").click();
  check("no-trace assistance says it was not recorded", /not recorded/i.test(await page.locator("#traceStatus").innerText()));
  check("no-trace assistance text is not silently discarded", await page.locator("#assistanceText").inputValue() !== "");
  await page.locator("#complete").click();
  await page.waitForTimeout(100);
  check("no-trace finish downloads no fabricated trace", downloads === 0 && await page.evaluate(() => events.length) === 0);
  check("no-trace finish truthfully confirms completion", /finished.*without.*trace/i.test(await page.locator("#traceStatus").innerText()));
  check("completion progress is exposed", await page.evaluate(() => document.querySelector("#progressConclude")?.getAttribute("aria-current") === "step"));
  check("no-trace finish locks activity controls", await page.locator("#complete").isDisabled());
  await page.close();
}

try {
  await auditNewTemplate("diagnose-analysis");
  await auditNewTemplate("conclusion-robustness");
  await auditPrecisionAndKeyboard();
  await auditNoTraceCompletion();
  check("browser emitted no console errors", report.console_errors.length === 0, report.console_errors.join("\n"));
  check("browser made no external requests", report.external_requests.length === 0, report.external_requests.join("\n"));
  report.passed = report.checks.every(item => item.passed);
} finally {
  await browser.close();
  await new Promise(resolveClosed => server.close(resolveClosed));
  await writeFile(join(audit, "report.json"), JSON.stringify(report, null, 2) + "\n");
}

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
