#!/usr/bin/env node
/**
 * Capture actual local web surfaces. No downloads, fixtures masquerading as
 * screenshots, external requests or UI reconstruction.
 *
 * Requires the dashboard and Observatory to be running. See v2-verification.md.
 */
import { createRequire } from "node:module";
import { access, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import assert from "node:assert/strict";

const output = dirname(fileURLToPath(import.meta.url));
const root = resolve(output, "../../..");
const require = createRequire(join(root, "apps/teacher-dashboard/package.json"));
const { chromium } = require("@playwright/test");
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}
function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Capture URLs must use local HTTP services.");
  }
  return url;
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function localBrowser() {
  const explicit = process.env.STUDIUM_BROWSER_EXECUTABLE;
  if (explicit) {
    if (!await exists(explicit)) throw new Error("STUDIUM_BROWSER_EXECUTABLE does not exist.");
    return explicit;
  }
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const entries = await readdir(cache).catch(() => []);
  for (const entry of entries.filter((name) => name.startsWith("chromium_headless_shell-")).sort().reverse()) {
    const candidate = join(cache, entry, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
    if (await exists(candidate)) return candidate;
  }
  for (const candidate of [chromium.executablePath(), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error("No local Chromium or Chrome is installed. This script never installs browsers.");
}

if (args.includes("--help")) {
  console.log("node docs/assets/screenshots/capture-web.mjs [--dashboard http://127.0.0.1:3107] [--observatory http://127.0.0.1:8124] [--course review-demo] [--pane-dir PATH] [--check]");
  process.exit(0);
}
const dashboard = localUrl(option("--dashboard", "http://127.0.0.1:3107"));
const observatory = localUrl(option("--observatory", "http://127.0.0.1:8124"));
const course = option("--course", "review-demo");
const paneDirectory = option("--pane-dir", "/private/tmp/claude-502/-Users-nothiasl-git/a0fed7d0-0208-4880-a9de-285b07349593/scratchpad/pane-snapshots");
const executablePath = await localBrowser();
if (args.includes("--check")) {
  console.log(JSON.stringify({ script: "valid", executablePath, dashboard: dashboard.href, observatory: observatory.href, paneDirectoryExists: await exists(paneDirectory), browserLaunched: false }, null, 2));
  process.exit(0);
}

const manifest = { capturedAt: new Date().toISOString(), executablePath, screenshots: [], checks: [], skipped: [] };
const browser = await chromium.launch({ executablePath, headless: true });
try {
  async function capture({ name, url, theme = "light", width = 1440, height = 1000, description }) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme, locale: "fr-FR", reducedMotion: "reduce" });
    const external = [];
    const errors = [];
    await context.route("**/*", async (route) => {
      const target = new URL(route.request().url());
      if (["data:", "file:", "blob:"].includes(target.protocol) || ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) return route.continue();
      external.push(target.origin);
      return route.abort();
    });
    await context.addCookies([
      { name: "studium-locale", value: "fr", url: dashboard.href },
      { name: "studium-theme", value: theme, url: dashboard.href },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(url, { waitUntil: "networkidle" });
    if (response) assert(response.ok(), `HTTP ${response.status()} at ${url}`);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(external.length, 0, `External requests: ${external.join(", ")}`);
    assert.equal(errors.length, 0, `Browser errors: ${errors.join("; ")}`);
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      heading: document.querySelector("h1")?.textContent?.trim(),
      background: getComputedStyle(document.body).backgroundColor,
      figures: [...document.querySelectorAll("figure")].map((figure) => ({ caption: !!figure.querySelector("figcaption"), table: !!figure.querySelector("table") })),
    }));
    assert(layout.scrollWidth <= width + 1, `Horizontal page overflow: ${layout.scrollWidth} > ${width}`);
    assert(layout.heading, "A visible page heading is required.");
    const path = join(output, name);
    await page.screenshot({ path, type: "png", fullPage: false, animations: "disabled", scale: "css" });
    const bytes = (await stat(path)).size;
    assert(bytes <= 300_000, `${name} exceeds 300 KB (${bytes} bytes).`);
    manifest.screenshots.push({ path: `docs/assets/screenshots/${name}`, bytes, width, height, theme, description });
    manifest.checks.push({ name, ...layout, externalRequests: external.length, browserErrors: errors.length });
    await context.close();
  }

  const discovery = await browser.newPage();
  const response = await discovery.goto(new URL("/library", dashboard).href);
  assert(response?.ok(), "Dashboard library is not available.");
  const review = await discovery.locator('a[href^="/library/"][href$="/review"]').first().getAttribute("href");
  assert(review, "The library needs at least one real lesson for review captures.");
  await discovery.close();

  for (const theme of ["light", "dark"]) {
    await capture({ name: `teacher-library-${theme}.png`, url: new URL("/library", dashboard).href, theme, description: "Teacher course library from BUNDLES_ROOT." });
    await capture({ name: `teacher-review-${theme}.png`, url: new URL(review, dashboard).href, theme, description: "Read-only lesson outline, readiness and approval command." });
    await capture({ name: `observatory-mystra-${theme}.png`, url: new URL(`/courses/${encodeURIComponent(course)}/mystra`, observatory).href, theme, description: "Observatory MySTRA report using the shared current theme." });
  }
  await capture({ name: "teacher-library-mobile.png", url: new URL("/library", dashboard).href, width: 390, height: 1000, description: "Course library at 390 CSS pixels." });

  const snapshots = (await readdir(paneDirectory).catch(() => [])).filter((name) => name.endsWith(".html")).sort();
  if (snapshots.length === 0) manifest.skipped.push({ target: "VS Code lesson pane", reason: "No HTML snapshot in the supplied directory." });
  for (const [index, snapshot] of snapshots.slice(0, 2).entries()) {
    // The producer owns the snapshot; render its HTML as supplied without rebuilding dist.
    await readFile(join(paneDirectory, snapshot), "utf8");
    await capture({ name: `vscode-lesson-pane-${index + 1}.png`, url: pathToFileURL(join(paneDirectory, snapshot)).href, theme: snapshot.includes("dark") ? "dark" : "light", description: `VS Code pane HTML snapshot: ${snapshot}` });
  }
  await writeFile(join(output, "capture-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  await browser.close();
}
