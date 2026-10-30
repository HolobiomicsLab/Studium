/** Reproduce the synthetic VS Code pane interaction and visual audit. */
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../", import.meta.url)));
if (!process.argv[2]) throw new Error("Usage: node tools/audit-vscode-harness.mjs NEW_OUTPUT");
const out = resolve(process.argv[2]);
await mkdir(out, { recursive: false });
const browserRequire = createRequire(resolve(repo, "apps/teacher-dashboard/package.json"));
const { chromium } = browserRequire("@playwright/test");
const css = await readFile(resolve(repo, "apps/studium-vscode/media/artifact-pane.css"), "utf8");
const renderer = await readFile(resolve(repo, "apps/studium-vscode/media/artifact-pane.js"), "utf8");
const katexCss = await readFile(resolve(repo, "apps/studium-vscode/node_modules/katex/dist/katex.min.css"), "utf8");
const katexJs = await readFile(resolve(repo, "apps/studium-vscode/node_modules/katex/dist/katex.min.js"), "utf8");
const report = { scope: "Production artifact pane CSS/JS in Chrome with the local KaTeX package asset copied by the extension vendor task; synthetic scene; no VS Code Extension Host.", checks: [] };
const check = (name, passed) => {
  report.checks.push({ name, passed: Boolean(passed) });
  if (!passed) throw new Error(name);
};

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 720 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="fr"><head><style>${katexCss}\n${css}</style></head><body><div id="pane"></div></body></html>`);
  await page.addScriptTag({ content: katexJs });
  await page.addScriptTag({ content: renderer });
  await page.evaluate(() => {
    window.__messages = [];
    window.__send = (message) => window.__messages.push(message);
    window.__render({
      scene: {
        type: "comparison",
        title: "Comparer deux interprétations spectrales",
        prompt: "Repère la différence qui change la conclusion scientifique.",
        artifact_a: "A attribue le pic principal à une fragmentation attendue.",
        artifact_b: "B tient compte de l’adduit et conserve l’incertitude.",
      },
      scene_assets: [{ kind: "equation_latex", title: "Écart de masse", payload: "\\Delta m = m_{obs} - m_{th}" }],
      progress: { index: 3, total: 8 },
      reviewDue: ["concept:adduits"],
      calibration: [],
    });
  });
  check("narrow panel has no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check("primary target is at least 44px high", await page.locator(".primary").evaluate((node) => node.getBoundingClientRect().height >= 44));
  check("equation uses the intended local KaTeX renderer", await page.locator(".asset .katex").count() === 1);
  await page.screenshot({ path: resolve(out, "lesson-narrow.png"), fullPage: true });

  await page.locator("textarea").fill("La seconde interprétation distingue observation et hypothèse.");
  await page.evaluate(() => { const button = document.querySelector(".primary"); button.click(); button.click(); });
  check("double submit emits one learner action", await page.evaluate(() => window.__messages.length === 1));
  check("pending state is accessible", await page.locator("#pane").getAttribute("aria-busy") === "true");
  await page.screenshot({ path: resolve(out, "lesson-pending.png"), fullPage: true });

  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "action_error", message: "Le service ne répond plus." } })));
  check("action failure preserves the scene", await page.locator(".scene-head").count() === 1);
  check("action failure is visible inline", (await page.locator("#action-status").innerText()).includes("Le service ne répond plus"));

  await page.evaluate(() => {
    const theme = document.documentElement.style;
    theme.setProperty("--vscode-editor-background", "#f7f5ef");
    theme.setProperty("--vscode-editor-foreground", "#24211d");
    theme.setProperty("--vscode-editorWidget-background", "#fffdf8");
    theme.setProperty("--vscode-panel-border", "#d7d1c5");
    theme.setProperty("--vscode-descriptionForeground", "#6b655d");
    theme.setProperty("--vscode-textLink-foreground", "#1f5e7a");
    theme.setProperty("--vscode-button-background", "#285f78");
    window.__render({ scene: { type: "concept", title: "Vérifier avant de conclure", markdown: "Distingue **observation**, interprétation et limite." }, scene_assets: [], progress: { index: 1, total: 4 } });
  });
  check("VS Code light-theme background is honored", await page.evaluate(() => getComputedStyle(document.body).backgroundColor === "rgb(247, 245, 239)"));
  await page.screenshot({ path: resolve(out, "lesson-light.png"), fullPage: true });

  await page.setViewportSize({ width: 920, height: 700 });
  await page.evaluate(() => document.documentElement.removeAttribute("style"));
  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "error", message: "Connexion refusée (fixture)." } })));
  check("fatal error names the recovery path", (await page.locator(".error-pane").innerText()).includes("Studium: Open Lesson"));
  await page.screenshot({ path: resolve(out, "connection-error.png"), fullPage: true });
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(resolve(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report));
