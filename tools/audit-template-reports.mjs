#!/usr/bin/env node
/** Verify exported learner reports in the portable and existing Observatory MySTRA views. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) throw new Error('Usage: audit-template-reports.mjs REPORTS_ROOT NEW_AUDIT_DIR');
const reports = resolve(inputArg), output = resolve(outputArg);
await mkdir(output);
const require = createRequire(join(root, 'apps/teacher-dashboard/package.json'));
const { chromium } = require('@playwright/test');
const python = `import sys, socket
from pathlib import Path
sys.path.insert(0, str(Path(sys.argv[1])/'services/observatory'))
from observatory_app import create_app
from observatory_config import ObservatoryConfig
import uvicorn
reports=Path(sys.argv[2])
cfg=ObservatoryConfig(course_root=reports,courses=(),eval_root=reports/'absent-eval',validity_root=reports/'absent-validity',harness_refresh=0)
sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen(128)
print(sock.getsockname()[1],flush=True)
uvicorn.Server(uvicorn.Config(create_app(cfg),log_level='warning')).run(sockets=[sock])
`;
const server = spawn(join(root, '.venv/bin/python'), ['-c', python, root, reports], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stderr.on('data', chunk => { serverLog += chunk.toString(); });
let browser;
const result = { passed: false, checks: [], console_errors: [], external_requests: [], synthetic: true };

async function snapshot(directory) {
  const hashes = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(hashes, await snapshot(path));
    else if (entry.isFile()) hashes[path] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return hashes;
}
function check(name, value) {
  result.checks.push({ name, passed: Boolean(value) });
  assert.ok(value, name);
}
try {
  const port = await new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error('Local Observatory did not start')), 15000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Observatory exited ${code}: ${serverLog}`)); });
    server.stdout.once('data', chunk => { clearTimeout(timer); resolvePort(Number(chunk.toString().trim())); });
  });
  assert.ok(Number.isInteger(port) && port > 0);
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50 && !ready; attempt++) {
    try { ready = (await fetch(base)).ok; } catch { /* Startup has not bound the application yet. */ }
    if (!ready) await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(ready, 'Local Observatory ready');
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => result.console_errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['file:', 'data:'].includes(url.protocol) && url.origin !== base) result.external_requests.push(request.url());
  });
  const before = await snapshot(reports);
  for (const name of ['linked-representations', 'parameter-comparison', 'evidence-claim', 'host-journal']) {
    const report = JSON.parse(await readFile(join(reports, name, 'report.json'), 'utf8'));
    check(`${name}: original text excluded by default`, report.privacy.original_text === 'excluded_by_default');
    await page.goto(pathToFileURL(join(reports, name, 'index.html')).href);
    check(`${name}: portable report has content`, (await page.locator('h1').innerText()).includes('Learner'));
    await page.screenshot({ path: join(output, `${name}-portable.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    check(`${name}: portable mobile has no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(output, `${name}-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1360, height: 1000 });
    const validation = await (await page.request.get(`${base}/api/courses/${name}/validation`)).json();
    check(`${name}: native validator accepts ASTRA`, validation.status === 'ok');
    const response = await page.goto(`${base}/courses/${name}/mystra#trace`);
    check(`${name}: native MySTRA HTTP 200`, response.status() === 200);
    check(`${name}: native MySTRA reads structured report`, (await page.locator('main').innerText()).includes('Learner activity technical report'));
    const trace = await page.locator('#trace').innerText();
    check(`${name}: native MySTRA displays event sequence`, /prediction|predict|Learner Text|learner_text/i.test(trace));
    await page.screenshot({ path: join(output, `${name}-native-mystra.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    check(`${name}: native MySTRA mobile has no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(output, `${name}-native-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1360, height: 1000 });
  }
  check('Report artifacts are unchanged by both viewers', JSON.stringify(await snapshot(reports)) === JSON.stringify(before));
  check('No browser errors or external requests', result.console_errors.length === 0 && result.external_requests.length === 0);
  result.passed = true;
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await Promise.race([exited, new Promise(done => setTimeout(done, 5000))]);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  await writeFile(join(output, 'observatory.log'), serverLog);
  await writeFile(join(output, 'report.json'), JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result));
