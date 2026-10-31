#!/usr/bin/env node
/** Exercise the real local Observatory over audit-mystra-fixtures.py's synthetic courses. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'apps/teacher-dashboard/package.json'));
const { chromium, expect } = require('@playwright/test');
const base = process.env.OBSERVATORY_URL ?? 'http://127.0.0.1:8114';
if (process.argv.length < 4) throw new Error('Usage: node tools/audit-mystra-ui.mjs FIXTURE_DIR OUTPUT_DIR');
const fixtures = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
assert.equal(JSON.parse(await readFile(resolve(fixtures, 'fixtures.json'))).synthetic, true);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
const external = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (new URL(request.url()).origin !== new URL(base).origin) external.push(request.url());
});
const report = { boundary: 'Real local FastAPI/Jinja and ASTRA validator; synthetic artifacts, zero model calls.', views: [], screenshots: [] };

async function snapshot(directory) {
  const records = {};
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name);
    const info = await stat(path);
    if (info.isDirectory()) Object.assign(records, await snapshot(path));
    else records[path] = { mtime: info.mtimeMs, hash: createHash('sha256').update(await readFile(path)).digest('hex') };
  }
  return records;
}

async function capture(name) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scrollWidth <= dimensions.width, `Horizontal overflow: ${name}`);
  report.views.push({ name, ...dimensions });
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
  report.screenshots.push(`${name}.png`);
}

async function open(path) {
  const response = await page.goto(`${base}${path}`);
  assert.equal(response.status(), 200, path);
  await expect(page.locator('main h1')).toBeVisible();
}

try {
  const before = await snapshot(resolve(fixtures, 'courses'));
  await open('/');
  await capture('observatory-index-desktop');
  await open('/courses/review-demo');
  await page.locator('a[href="/courses/review-demo/mystra"]').first().click();
  await expect(page.locator('main')).toContainText('MySTRA');
  const payload = await (await page.request.get(`${base}/api/courses/review-demo/mystra`)).json();
  assert.equal(payload.course.analyses.length, 2);
  assert.equal(payload.review.bundles.length, 2);
  for (const text of ['Evidence audit — synthetic', 'Synthetic quotation for reviewer inspection.',
    'Synthetic quiz accepts answer B.', 'b1', 'b2', 'synthetic-concept',
    'snapshots/synthetic-source-v3.txt', 'synthetic-fixture-no-git-commit', 'Synthetic context before.', 'page=7']) {
    await expect(page.locator('main')).toContainText(text);
  }
  await capture('mystra-desktop');
  const markdown = await page.request.get(`${base}/courses/review-demo/provenance.myst.md`);
  assert.match(markdown.headers()['content-type'], /text\/markdown/);
  const source = await markdown.text();
  for (const text of ['evidence_audit', 'review/b1/astra.yaml', 'review/b2/astra.yaml',
    'review:s2:key_correctness', 'Synthetic quotation for reviewer inspection.']) assert.ok(source.includes(text), text);
  await writeFile(resolve(output, 'provenance.myst.md'), source);
  const validation = await (await page.request.get(`${base}/api/courses/review-demo/validation`)).json();
  assert.equal(validation.status, 'ok');
  assert.equal(validation.returncode, 0);
  report.validation = validation;
  await open('/courses/review-demo/mystra');
  const validated = await (await page.request.get(`${base}/api/courses/review-demo/mystra`)).json();
  assert.equal(validated.validation.status, 'ok');
  await capture('mystra-validated');
  const closedBeforePrint = await page.locator('details:not([open]):not(.studium-help):not(.studium-help-more)').count();
  assert.ok(closedBeforePrint > 0, 'Print probe must start with collapsed evidence');
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(page.locator('details:not([open]):not(.studium-help):not(.studium-help-more)')).toHaveCount(0);
  await expect(page.getByText('defect_s2_key_correctness_ev0', { exact: true })).toBeVisible();
  await capture('mystra-print');
  await page.pdf({ path: resolve(output, 'mystra-print.pdf'), format: 'A4', printBackground: true });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('details:not([open]):not(.studium-help):not(.studium-help-more)')).toHaveCount(closedBeforePrint);
  report.printExpandedAndRestored = true;
  await page.emulateMedia({ media: 'screen' });
  await open('/courses/review-demo/review');
  await capture('scene-review-desktop');
  await open('/courses/no-review/mystra');
  await expect(page.locator('main')).toContainText('missing review/astra.yaml');
  await capture('mystra-no-review');
  await open('/courses/partial-course/mystra');
  await expect(page.locator('main')).toContainText('unreadable universes/broken.yaml');
  await capture('mystra-partial');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of [['/', 'observatory-index-mobile'], ['/courses/review-demo', 'provenance-mobile'],
    ['/courses/review-demo/mystra', 'mystra-mobile'], ['/courses/review-demo/review', 'scene-review-mobile']]) {
    await open(path);
    await capture(name);
  }
  await open('/courses/review-demo/mystra');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveAttribute('href', '#main');
  await page.keyboard.press('Enter');
  await expect(page.locator(':focus')).toHaveAttribute('id', 'main');
  const targets = await page.locator('.report-actions a, .report-actions button').evaluateAll(items => items.map(item => ({ text: item.textContent.trim(), height: item.getBoundingClientRect().height })));
  assert.equal(targets.length, 4, 'Primary actions must be exercised');
  for (const target of targets) assert.ok(target.height >= 44, JSON.stringify(target));
  report.primaryTargets = targets;
  assert.deepEqual(await snapshot(resolve(fixtures, 'courses')), before, 'Viewer and validator leave artifact bytes and mtimes unchanged');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  report.browserErrors = errors;
  report.externalRequests = external;
  report.readOnly = true;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
