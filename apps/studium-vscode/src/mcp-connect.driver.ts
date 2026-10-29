// mcp-connect.driver.ts — unit tests for resolveTsx (the package-manager-tolerant tsx resolver),
// parseToolResult (tool-error surfacing) and forwardStderr/resolveLogSink (server diagnostics).
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/mcp-connect.driver.ts
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeServerLaunch, resolveServerLaunch, resolveTsx, parseToolResult, forwardStderr, resolveLogSink, serverBuildWarning, serverInfoLine, setLessonMcpLog, type LogSink, type ServerInfo } from "./mcp-connect.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", ".."); // apps/studium-vscode/src -> repo root

// 1) in the real monorepo it finds an existing tsx binary (not the PATH fallback).
{
  const t = resolveTsx(repoRoot);
  expect(t.endsWith("tsx"), "resolveTsx returns a tsx path/command");
  expect(t !== "tsx" && existsSync(t), `resolveTsx finds an installed tsx in the monorepo (got ${t})`);
}

// 2) when no candidate exists, it falls back to the bare command on PATH (never throws).
{
  expect(resolveTsx("/no/such/repo/root/xyz") === "tsx", "resolveTsx falls back to 'tsx' on PATH when no binary is found");
}

// helper: run parseToolResult and return the thrown message ("" when it did not throw).
function messageOf(res: unknown): string {
  try { parseToolResult("submit_run_result", res as any); return ""; }
  catch (e: any) { return String(e.message); }
}

// 3) a well-formed tool result is returned as parsed data.
{
  const data = parseToolResult("get_run_manifest", { content: [{ type: "text", text: `{"run_manifest":{"capsule_ref":"c1"}}` }] });
  expect((data.run_manifest as any)?.capsule_ref === "c1", "parseToolResult returns the parsed payload");
  const empty = parseToolResult("get_run_manifest", { content: [] });
  expect(Object.keys(empty).length === 0, "parseToolResult returns {} when the tool sent no content block");
}

// 4) a PLAIN-TEXT tool error surfaces the server's real message, not a JSON parse error.
{
  const m = messageOf({ isError: true, content: [{ type: "text", text: "session not found: sid-42" }] });
  expect(m.includes("session not found: sid-42"), `plain-text tool error keeps its message (got: ${m})`);
  expect(!/Unexpected token|JSON/i.test(m), `plain-text tool error is not a JSON parse error (got: ${m})`);
}

// 5) a JSON tool error surfaces data.error.
{
  const m = messageOf({ isError: true, content: [{ type: "text", text: `{"error":"run_result invalide"}` }] });
  expect(m === "submit_run_result: run_result invalide", `JSON tool error surfaces data.error (got: ${m})`);
}

// 6) an error payload WITHOUT an `error` field never yields the literal "undefined".
{
  const m = messageOf({ isError: true, content: [{ type: "text", text: `{"status":"rejected"}` }] });
  expect(!m.includes("undefined"), `error payload without .error never prints "undefined" (got: ${m})`);
  expect(m.includes("rejected"), `error payload without .error falls back to the raw text (got: ${m})`);
  const bare = messageOf({ isError: true, content: [] });
  expect(!bare.includes("undefined") && bare.length > "submit_run_result: ".length,
    `a contentless error yields a clear fallback message (got: ${bare})`);
}

// 7) a non-error result whose text is not JSON is reported as an error carrying that text.
{
  const m = messageOf({ content: [{ type: "text", text: "Traceback: lesson-mcp died" }] });
  expect(m.includes("Traceback: lesson-mcp died"), `non-JSON success text is surfaced verbatim (got: ${m})`);
}

// 8) forwardStderr pipes the server's stderr into the log sink, and tolerates a missing stream.
{
  const lines: string[] = [];
  const stream = new EventEmitter();
  forwardStderr(stream as any, (l) => lines.push(l));
  stream.emit("data", Buffer.from("lesson-mcp: ENOENT tsx\n"));
  expect(lines.length === 1 && lines[0] === "lesson-mcp: ENOENT tsx", `forwardStderr logs each stderr chunk (got: ${JSON.stringify(lines)})`);
  let threw = false;
  try { forwardStderr(null, () => {}); } catch { threw = true; }
  expect(!threw, "forwardStderr tolerates a null stream (stderr not piped)");
}

// 9) the stderr sink always resolves to something: caller's > installed channel > console.
{
  expect(typeof resolveLogSink() === "function", "resolveLogSink falls back to a console sink when nothing is installed");
  const installed: LogSink = () => {};
  setLessonMcpLog(installed);
  expect(resolveLogSink() === installed, "resolveLogSink uses the installed channel sink");
  const caller: LogSink = () => {};
  expect(resolveLogSink(caller) === caller, "an explicit per-connection sink wins over the installed one");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} mcp-connect assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — mcp-connect (resolveTsx + parseToolResult + stderr diagnostics) passed all ${checks} assertions.`);

// 8) resolveServerLaunch: repo checkout preferred (dev mode, live sources via tsx).
{
  const launch = resolveServerLaunch("/no/such/extension/path", repoRoot);
  expect(launch.args[0] === "src/index.ts" && launch.cwd.endsWith("apps/lesson-mcp"),
    "resolveServerLaunch prefers the repo checkout (tsx on live sources)");
  expect(describeServerLaunch(launch) === `source (${resolve(launch.cwd, "src/index.ts")})`,
    "describeServerLaunch names the resolved source entry path");
}

// 9) resolveServerLaunch: no repo -> the bundled server next to the extension, run as node.
{
  const ext = mkdtempSync(resolve(tmpdir(), "studium-ext-"));
  mkdirSync(resolve(ext, "dist"), { recursive: true });
  writeFileSync(resolve(ext, "dist/lesson-mcp.cjs"), "// bundled server stub\n");
  const launch = resolveServerLaunch(ext, "/no/such/repo");
  expect(launch.command === process.execPath && launch.args[0].endsWith("lesson-mcp.cjs"),
    "resolveServerLaunch falls back to the bundled server via the host executable");
  expect(launch.env?.ELECTRON_RUN_AS_NODE === "1",
    "bundled launch sets ELECTRON_RUN_AS_NODE so the Electron host runs it as node");
  expect(describeServerLaunch(launch) === "bundled (dist/lesson-mcp.cjs)",
    "describeServerLaunch names the embedded bundle");
}

// 10) resolveServerLaunch: neither -> an actionable error naming the setting.
{
  let msg = "";
  try { resolveServerLaunch("/no/such/extension", "/no/such/repo"); }
  catch (e: any) { msg = String(e.message); }
  expect(msg.includes("studium.repoRoot"), "missing-everything error names the studium.repoRoot setting");
}

// 11) get_server_info is rendered as one diagnostic line with build and runtime identity.
{
  const info: ServerInfo = {
    name: "studium-lesson",
    version: "0.1.0",
    build: { origin: "bundled", built_at: "2026-10-29T09:30:00Z", git_sha: "33bf561" },
    tools: ["get_server_info", "start_lesson_session"],
    bundles_root: "/lessons",
    data_dir: null,
    model_backend: "none",
  };
  const line = serverInfoLine(info);
  expect(line === "[studium-lesson] v0.1.0 bundled 2026-10-29T09:30:00Z sha=33bf561 tools=2 bundles_root=/lessons data_dir=none model_backend=none",
    `serverInfoLine formats the complete payload (got: ${line})`);
  expect(serverBuildWarning(info, repoRoot, () => "33bf561") === null,
    "matching clean bundled and checkout SHAs produce no warning");
  const stale = serverBuildWarning(info, repoRoot, () => "eb5b1e1");
  expect(!!stale?.includes("WARNING") && stale.includes("33bf561") && stale.includes("eb5b1e1"),
    `a stale bundled server reports both identities (got: ${stale})`);
  const dirty = serverBuildWarning({ ...info, build: { ...info.build, git_sha: "eb5b1e1-dirty" } }, repoRoot, () => "eb5b1e1");
  expect(!!dirty?.includes("WARNING") && dirty.includes("dirty"),
    `a dirty server build emits a WARNING (got: ${dirty})`);
}

if (failures.length) { console.error(`FAIL (${failures.length}/${checks}):`); for (const f of failures) console.error("  - " + f); process.exit(1); }
console.log(`OK — mcp-connect driver passed all ${checks} assertions`);
