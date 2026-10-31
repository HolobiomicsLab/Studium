import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost, SessionWorkspace, operatorContext } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

describe("operator context over the MCP transport", () => {
  it("agrees with the file channel and returns a protocol error for unknown sessions", async () => {
    const fixtures = resolve(fileURLToPath(new URL("../../../fixtures/", import.meta.url)));
    const host = new SessionHost({ bundlesRoot: fixtures, live: false, dataDir: null }); // I-10: in memory
    const server = buildMcpServer(host);
    const client = new Client({ name: "operator-audit", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const dir = await mkdtemp(join(tmpdir(), "operator-mcp-"));
    await server.connect(st); await client.connect(ct);
    try {
      const { sessionId } = await host.create("capsule-loop-demo/lesson.json", "synthetic-audit");
      const before = JSON.stringify(host.currentPresentation(sessionId));
      const result = await client.callTool({ name: "get_operator_context", arguments: { session_id: sessionId } });
      const content = result.content as Array<{ text: string }>;
      expect(JSON.parse(content[0]!.text)).toEqual(operatorContext(host, sessionId));
      await new SessionWorkspace(host, dir).writeStep(sessionId);
      const task = await readFile(join(dir, "task.md"), "utf8");
      const match = task.match(/<!-- studium-operator-context -->\n```json\n([\s\S]*?)\n```/);
      expect(JSON.parse(match![1]!)).toEqual(JSON.parse(content[0]!.text));
      expect(JSON.stringify(host.currentPresentation(sessionId))).toBe(before);
      const missing = await client.callTool({ name: "get_operator_context", arguments: { session_id: "missing" } });
      expect(missing.isError).toBe(true);
    } finally {
      await client.close(); await server.close(); await rm(dir, { recursive: true, force: true });
    }
  });
});
