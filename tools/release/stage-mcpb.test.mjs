// tools/release/stage-mcpb.test.mjs — the Claude Desktop bundle (2026-11-27): staged from the built server, its manifest
// valid for the mcpb tool, and the server it names starts the way Claude Desktop starts it and offers the shipped demo.
// Needs the build (apps/studium-vscode/dist/lesson-mcp.cjs), as CI runs it after `pnpm build`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const version = JSON.parse(readFileSync(join(root, "apps/studium-vscode/package.json"), "utf8")).version;

/** Send JSON-RPC lines to a stdio server; resolve the replies by id once every id has answered. */
function rpc(child, requests, timeoutMs = 20000) {
  return new Promise((done, fail) => {
    const want = new Set(requests.filter((r) => r.id !== undefined).map((r) => r.id));
    const replies = new Map();
    let buffer = "";
    const timer = setTimeout(() => fail(new Error(`no reply to ${[...want]} after ${timeoutMs} ms`)), timeoutMs);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (want.has(message.id)) { replies.set(message.id, message); want.delete(message.id); }
        if (!want.size) { clearTimeout(timer); done(replies); }
      }
    });
    for (const request of requests) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...request })}\n`);
  });
}

test("the Claude Desktop bundle: a valid manifest, and the server it names starts and offers the demo", async () => {
  const work = mkdtempSync(join(tmpdir(), "studium-mcpb-"));
  try {
    const stage = join(work, "stage");
    execFileSync(process.execPath, [join(root, ".github/scripts/stage-mcpb.mjs"), version, stage], { stdio: "pipe" });
    const manifest = JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8"));
    assert.equal(manifest.name, "studium");
    assert.equal(manifest.version, version);
    assert.equal(manifest.server.type, "node", "Claude Desktop runs a node bundle with the Node it ships");
    assert.ok(existsSync(join(stage, manifest.server.entry_point)), "the entry point is in the bundle");
    assert.ok(existsSync(join(stage, manifest.icon)), "the icon is in the bundle");
    assert.ok(existsSync(join(stage, "server/shipped-lessons/discover-studium-fr/approval.json")), "the demo ships with its approval record");
    execFileSync(join(root, "node_modules/.bin/mcpb"), ["validate", join(stage, "manifest.json")], { stdio: "pipe" });

    const args = manifest.server.mcp_config.args.map((arg) => arg.replace("${__dirname}", stage));
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ...manifest.server.mcp_config.env, STUDIUM_HOME: join(work, "home"), STUDIUM_EPHEMERAL: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    try {
      const init = await rpc(child, [{ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcpb-test", version: "1" } } }]);
      assert.equal(init.get(1).result.serverInfo.version, version, "the bundled server is this version");
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      const listed = await rpc(child, [{ id: 2, method: "tools/call", params: { name: "list_lessons", arguments: { language: "fr" } } }]);
      const text = listed.get(2).result.content.map((part) => part.text ?? "").join("\n");
      assert.match(text, /discover-studium-fr/, "a fresh install is offered « Découvrir Studium »");
    } finally {
      child.kill();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
