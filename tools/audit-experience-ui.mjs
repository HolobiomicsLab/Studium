/** Exercise the real MCP public-context boundary and a host-generated viewer.
 * Run with tsx: audit-experience-ui.mjs EXISTING_CAPSULE_RUN_DIR NEW_OUTPUT_DIR CHECKED_REVIEW_DIR
 * The input directory must contain spectra.json and outputs/match.json from an external run.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { SessionHost, SessionWorkspace } from "../packages/lesson-session-host/src/index.ts";
import { buildMcpServer } from "../apps/lesson-mcp/src/server.ts";
const require = createRequire(new URL("../apps/teacher-dashboard/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const mcpRequire = createRequire(new URL("../apps/lesson-mcp/package.json", import.meta.url));
const { Client } = mcpRequire("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = mcpRequire("@modelcontextprotocol/sdk/inMemory.js");
const [inputArg, outputArg, reviewArg] = process.argv.slice(2);
if (!reviewArg) throw new Error("Usage: audit-experience-ui.mjs EXISTING_CAPSULE_RUN_DIR NEW_OUTPUT_DIR CHECKED_REVIEW_DIR");
const capsule = resolve(inputArg), out = resolve(outputArg);
await mkdir(out, { recursive: false });
const measured = JSON.parse(await readFile(join(capsule, "outputs/match.json"), "utf8"));
const spectra = JSON.parse(await readFile(join(capsule, "spectra.json"), "utf8"));
const bundle = {
  schema_version: "1.4", bundle_id: "synthetic-viewer-audit", source_plan_id: "audit-only",
  metadata: { title: "Synthetic spectra — viewer audit", target: "M2", duration_minutes: 10, language: "en", discipline: "Chemistry" },
  concepts: [{ id: "spectral-evidence", title: "Spectral evidence", description: "Interpret matching assumptions", bloom_level_target: "evaluate" }],
  scenes: [{ id: "inspect-matching", type: "concept", title: "What does a spectral score establish?", markdown: "Compare the role of precursor shift on illustrative spectra.",
    objective_refs: [], concept_refs: ["spectral-evidence"], estimated_seconds: 60, adaptation_hooks: [],
    render_assets: [{ kind: "data_csv", title: "Synthetic experimental peaks", payload: "mz,intensity\n"+spectra.experimental.peaks.map(p=>p.join(",")).join("\n"), provenance: "synthetic:metabo-judgment-demo", meta: { answer_key: "PRIVATE-CANARY" } }],
  }], rules: [], validated_by: "synthetic-test-fixture-only", validated_at: "2026-09-10T00:00:00Z",
};
await writeFile(join(out, "lesson.json"), JSON.stringify(bundle));
const host = new SessionHost({ bundlesRoot: out, live: false });
const server = buildMcpServer(host), client = new Client({ name: "experience-viewer-audit", version: "1" });
const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
const parse = r => JSON.parse(r.content[0].text);
const start = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "lesson.json", learner_id: "synthetic-audit" } }));
const context = parse(await client.callTool({ name: "get_operator_context", arguments: { session_id: start.session_id } }));
if (JSON.stringify(context).includes("PRIVATE-CANARY")) throw new Error("Answer metadata crossed public boundary");
await writeFile(join(out, "operator-context.json"), JSON.stringify(context, null, 2));
await new SessionWorkspace(host, join(out, ".studium-session")).writeStep(start.session_id);
const before = JSON.stringify(host.currentPresentation(start.session_id));
const builder = spawnSync(process.execPath, ["examples/literature-experience/build-viewer.mjs", join(capsule, "spectra.json"), join(capsule, "outputs/match.json"), join(out, "operator-context.json"), resolve(reviewArg), join(out, "viewer")], { encoding: "utf8" });
if (builder.status !== 0) throw new Error(builder.stderr);
const html = await readFile(join(out, "viewer/index.html"));
const web = createServer((_req,res) => { res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(html); });
await new Promise(r=>web.listen(0,"127.0.0.1",r));
const base = `http://127.0.0.1:${web.address().port}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "chrome", headless: true });
const report = { passed:false, measured, views:[], console_errors:[], external_requests:[], checks:[] };
function check(name, ok) {report.checks.push({name,passed:!!ok});if(!ok)throw new Error(name);}
try {
  const page = await browser.newPage({viewport:{width:1440,height:1050}});
  page.on("pageerror",e=>report.console_errors.push(String(e)));
  page.on("request",r=>{if(!r.url().startsWith(base)&&!r.url().startsWith("blob:"))report.external_requests.push(r.url());});
  await page.goto(base); await page.locator("#score").waitFor();
  check("external Python baseline agrees with browser implementation", Number(await page.locator("#score").innerText())===measured.score && Number(await page.locator("#matches").innerText())===measured.matched_peaks);
  await page.screenshot({path:join(out,"desktop.png"),fullPage:true});report.views.push("desktop");
  await page.locator("#shift").uncheck();
  const direct=Number(await page.locator("#score").innerText());
  check("removing precursor-aware matches changes scientific result", direct<measured.score);
  report.direct_score=direct;
  check("exploration does not rewrite external result",Number(await page.locator("#baseline").innerText())===measured.score);
  await page.screenshot({path:join(out,"direct-matching.png"),fullPage:true});report.views.push("direct");
  await page.locator("#reset").click();
  await page.locator("#tolerance").fill("0.00005");await page.locator("#tolerance").dispatchEvent("input");
  check("tighter tolerance changes matched peaks",Number(await page.locator("#matches").innerText())<measured.matched_peaks);
  await page.locator("#reset").click();
  check("confidence is not invented",await page.locator("#confidenceValue").innerText()==="not recorded");
  await page.locator("#reflection").fill("A matching rule changes the score; identity requires independent evidence.");
  const download = page.waitForEvent("download");await page.locator("#save").click();const file=await download;await file.saveAs(join(out,"observation.json"));
  const observation=JSON.parse(await readFile(join(out,"observation.json"),"utf8"));
  check("download preserves learner text and absent confidence",observation.confidence===null&&observation.assessed===false&&observation.judgment.startsWith("A matching rule"));
  await page.setViewportSize({width:390,height:844});
  check("mobile viewport has no horizontal overflow",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:join(out,"mobile.png"),fullPage:true});report.views.push("mobile");
  await page.keyboard.press("Tab");
  await page.emulateMedia({media:"print"});await page.pdf({path:join(out,"viewer.pdf"),format:"A4",printBackground:true});
  check("lesson presentation unchanged by viewer",JSON.stringify(host.currentPresentation(start.session_id))===before);
  check("no console errors or external requests",report.console_errors.length===0&&report.external_requests.length===0);
  report.passed=true;
} finally {
  await writeFile(join(out,"report.json"),JSON.stringify(report,null,2));
  await browser.close();await new Promise(r=>web.close(r));await client.close();await server.close();
}
console.log(JSON.stringify(report,null,2));
