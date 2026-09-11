#!/usr/bin/env node
/** Audit five prepared activity templates in a real local browser.
 * Usage: node tools/audit-activity-templates.mjs ACTIVITIES_DIR NEW_AUDIT_DIR
 */
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/teacher-dashboard/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const [activitiesArg, auditArg] = process.argv.slice(2);
if (!activitiesArg || !auditArg) throw new Error("Usage: audit-activity-templates.mjs ACTIVITIES_DIR NEW_AUDIT_DIR");
const activities = resolve(activitiesArg), audit = resolve(auditArg);
await mkdir(audit, { recursive: false });
const report = { passed: false, checks: [], screenshots: [], console_errors: [], external_requests: [] };
const check = (name, value) => { report.checks.push({ name, passed: Boolean(value) }); if (!value) throw new Error(name); };
const mime = path => extname(path) === ".html" ? "text/html; charset=utf-8" : "application/octet-stream";
const server = createServer(async (request, response) => {
  try {
    const relative = decodeURIComponent(new URL(request.url, "http://localhost").pathname).replace(/^\/+/, "");
    const path = resolve(activities, relative || "linked-representations/index.html");
    if (!path.startsWith(activities + "/")) throw new Error("outside root");
    response.writeHead(200, { "Content-Type": mime(path) }); response.end(await readFile(path));
  } catch {
    response.writeHead(404); response.end("not found");
  }
});
await new Promise(resolveReady => server.listen(0, "127.0.0.1", resolveReady));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });

async function saveDownload(page, trigger, target) {
  const pending = page.waitForEvent("download");
  await trigger();
  const download = await pending;
  await download.saveAs(target);
  return JSON.parse(await readFile(target, "utf-8"));
}

function validateTrace(path) {
  return spawnSync(".venv/bin/python", ["tools/learner_trace.py", "validate", path], {
    cwd: process.cwd(), encoding: "utf-8",
  });
}

async function openTemplate(templateId, viewport = { width: 1360, height: 980 }) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", error => report.console_errors.push(templateId + ": " + String(error)));
  page.on("request", request => {
    if (!request.url().startsWith(base) && !request.url().startsWith("blob:"))
      report.external_requests.push(templateId + ": " + request.url());
  });
  await page.goto(base + "/" + templateId + "/index.html");
  return page;
}

async function auditTemplate(templateId) {
  const page = await openTemplate(templateId);
  check(templateId + ": prediction waits for explicit trace choice", await page.locator("#prediction").isDisabled());
  check(templateId + ": expected answers hidden before prediction", await page.locator("#checks").isHidden());
  await page.locator("#startTrace").click();
  const earlyPath = join(audit, templateId + "-early-actions.json");
  const early = await saveDownload(page, () => page.locator("#exportEarly").click(), earlyPath);
  check(templateId + ": early partial trace has only opted-in start", early.events.length === 1 && early.events[0].kind === "activity_started");
  check(templateId + ": trace binds complete activity digest", /^[0-9a-f]{64}$/.test(early.activity_sha256 || ""));
  check(templateId + ": early trace validates with shared schema", validateTrace(earlyPath).status === 0);
  await page.locator("#prediction").fill("Synthetic audit prediction before reveal.");
  await page.locator("#predictionConfidence").selectOption("2");
  await page.locator("#reveal").click();
  check(templateId + ": results and expected checks reveal after prediction", await page.locator("#result").isVisible() && await page.locator("#checks").isVisible());
  if (templateId === "linked-representations") {
    check("linked: checked baseline has one edge and four nodes", await page.locator("#edgeCount").innerText() === "1" && await page.locator("#nodeCount").innerText() === "4");
    await page.getByRole("button", { name: "Use checked variation 0.64" }).click();
    check("linked: meaningful threshold change exposes three edges", await page.locator("#edgeCount").innerText() === "3");
    await page.locator('button[data-choice-id="MassBank_analogue_CH2"]').click();
    check("linked: stable ID reaches selected node and spectrum", (await page.locator("#spectrumTitle").innerText()).includes("MassBank_analogue_CH2") && (await page.locator("svg.spectrum").getAttribute("aria-label")).includes("MassBank_analogue_CH2"));
    const spectrumText = await page.locator("svg.spectrum").textContent();
    check("linked: spectrum shows m/z and normalized-intensity ticks", spectrumText.includes("m/z") && spectrumText.includes("Relative intensity") && spectrumText.includes("1"));
    check("linked: same stable ID highlights candidate row", await page.locator('tr[data-node-id="MassBank_analogue_CH2"]').evaluate(row => row.classList.contains("selected")));
    check("linked: numeric edge columns remain legible", await page.locator("#edgeTable tbody tr:first-child td:nth-child(2)").evaluate(cell => getComputedStyle(cell).whiteSpace === "nowrap"));
  } else if (templateId === "parameter-comparison") {
    check("comparison: exact baseline model output is visible", await page.locator("#fixedInput").innerText() === "4.0 a.u." && await page.locator("#baselineValue").innerText() === "6.0 a.u.");
    check("comparison: exact initial response delta is visible", await page.locator("#differenceValue").innerText() === "+2.0 a.u.");
    await page.locator("#parameter").fill("2.5");
    await page.locator("#parameter").dispatchEvent("input");
    check("comparison: varying gain recomputes response delta", await page.locator("#differenceValue").innerText() === "+4.0 a.u.");
  } else if (templateId === "evidence-claim") {
    await page.locator('input[value="claim_supported"]').check();
    check("evidence: learner judgment uses visible source-backed choices", (await page.locator("#claimFeedback").innerText()).startsWith("Supported within this fixture."));
  }
  if (templateId === "diagnose-analysis" || templateId === "conclusion-robustness") {
    const choices = page.locator('#experiment input[type="radio"]');
    check(templateId + ": exposes learner-selectable evidence", await choices.count() >= 2);
    check(templateId + ": choice descriptions start below their titles", await page.locator("#experiment .choice").evaluateAll(labels => labels.every(label => {
      const title = label.querySelector(".choice-title"), detail = label.querySelector(".choice-detail");
      return !detail || detail.getClientRects()[0].top >= title.getBoundingClientRect().bottom - 1;
    })));
    await choices.first().check();
    await choices.last().check();
    check(templateId + ": records real selections", await page.evaluate(() => events.filter(event => event.kind === "learner_choice_selected").length >= 2));
  }
  await page.locator("#assistanceText").fill("Explain the displayed relation, without answering for me.");
  await page.locator("#requestAssistance").click();
  await page.locator("#observation").fill("Observed synthetic relation for " + templateId + ".");
  await page.locator("#conclusion").fill("The bounded fixture supports only the displayed conclusion.");
  await page.screenshot({ path: join(audit, templateId + "-desktop.png"), fullPage: true });
  report.screenshots.push(templateId + "-desktop.png");
  const actionsPath = join(audit, templateId + "-actions.json");
  const finalTrace = await saveDownload(page, () => page.locator("#complete").click(), actionsPath);
  check(templateId + ": final trace has ordered prediction, reveal and completion", finalTrace.events[1].data.phase === "prediction" && finalTrace.events[2].kind === "results_revealed" && finalTrace.events.at(-1).kind === "activity_completed");
  check(templateId + ": final trace validates with shared schema", validateTrace(actionsPath).status === 0);
  const eventCount = await page.evaluate(() => {
    const before = events.length, control = document.querySelector("#result input");
    if (control) { control.value = control.value; control.dispatchEvent(new Event("input", { bubbles: true })); }
    return [before, events.length, control ? control.disabled : true];
  });
  check(templateId + ": completion locks controls and logging", eventCount[0] === eventCount[1] && eventCount[2] === true);
  await page.close();
}

async function auditNoTrace() {
  const page = await openTemplate("parameter-comparison");
  await page.locator("#noTrace").click();
  await page.locator("#prediction").fill("Continue without collecting actions.");
  await page.locator("#reveal").click();
  await page.locator("#parameter").fill("2.5");
  await page.locator("#parameter").dispatchEvent("input");
  check("no-trace path never backfills observed actions", await page.evaluate(() => events.length) === 0);
  check("no-trace path cannot enable export later", await page.locator("#exportEarly").isDisabled() && await page.locator("#startTrace").isDisabled());
  await page.close();
}

try {
  for (const templateId of ["linked-representations", "parameter-comparison", "evidence-claim", "diagnose-analysis", "conclusion-robustness"])
    await auditTemplate(templateId);
  await auditNoTrace();
  const mobile = await openTemplate("linked-representations", { width: 390, height: 844 });
  check("mobile layout has no horizontal overflow", await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ path: join(audit, "linked-representations-mobile.png"), fullPage: true });
  report.screenshots.push("linked-representations-mobile.png");
  await mobile.close();
  check("browser emitted no console errors or external requests", report.console_errors.length === 0 && report.external_requests.length === 0);
  report.passed = true;
} finally {
  await browser.close();
  await new Promise(resolveClosed => server.close(resolveClosed));
  await writeFile(join(audit, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report, null, 2));
