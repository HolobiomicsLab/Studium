import { expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost, SessionWorkspace } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

it("uses one learner journal over MCP and files and rejects assistant-authored responses", async () => {
  const host = new SessionHost({ bundlesRoot: fileURLToPath(new URL("../../../fixtures/", import.meta.url)), live: false });
  const server = buildMcpServer(host);
  const client = new Client({ name: "journal-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const dir = await mkdtemp(join(tmpdir(), "experiment-mcp-"));
  await server.connect(st); await client.connect(ct);
  try {
    const { sessionId } = await host.create("capsule-loop-demo/lesson.json", "synthetic-learner");
    const scene_id = host.currentPresentation(sessionId).scene.id;
    const input = { kind: "predict", experiment_id: "e1", prediction: "  Student text\n", justification: "My reason", confidence: 1, consent: true, authorship: "learner" };
    const invalid = await client.callTool({ name: "record_experiment", arguments: { session_id: sessionId, scene_id, input: { ...input, authorship: "assistant" } } });
    expect(invalid.isError).toBe(true);
    const missing = await client.callTool({ name: "get_experiment_journal", arguments: { session_id: "missing" } });
    expect(missing.isError).toBe(true);
    const stale = await client.callTool({ name: "record_experiment", arguments: { session_id: sessionId, scene_id: "stale", input } });
    expect(stale.isError).toBe(true);
    const prediction = await client.callTool({ name: "record_experiment", arguments: { session_id: sessionId, scene_id, input } });
    expect(prediction.isError).not.toBe(true);
    const workspace = new SessionWorkspace(host, dir);
    await workspace.writeStep(sessionId);
    await writeFile(join(dir, "experiment-action.json"), JSON.stringify({ session_id: sessionId,
      scene_id: host.currentPresentation(sessionId).scene.id, input: { kind: "begin", experiment_id: "e1" } }));
    expect((await workspace.ingest(sessionId)).transition).toBe("experiment_recorded");
    const result = await client.callTool({ name: "get_experiment_journal", arguments: { session_id: sessionId } });
    const journal = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(journal).toEqual(JSON.parse(await readFile(join(dir, "experiment.json"), "utf8")));
    expect(journal.experiments[0].events.map((e: { input: { kind: string } }) => e.input.kind)).toEqual(["predict", "begin"]);
  } finally { await client.close(); await server.close(); await rm(dir, { recursive: true, force: true }); }
});
