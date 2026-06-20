import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

const MINI = {
  schema_version: "1.4", bundle_id: "mini-001", source_plan_id: "p",
  metadata: { title: "M", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [
    { id: "s0", type: "intro", title: "I", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "hi",
      evidence: { abs_asset: { asset_type: "equation_latex", payload_inline: "\\cos\\theta", prov_derived_from: "doi:x" },
        enrichment_metadata: { enricher_version: "1", perspicacite_mode_used: "basic", timestamp: "t", degraded: false } } },
    { id: "s1", type: "quiz", title: "Q", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
      question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }], feedback_correct: "y", feedback_incorrect: "n", hints: ["look again at the prompt"] },
  ],
  rules: [], validated_by: "teacher", validated_at: "2026-06-10T08:00:00Z",
};
const dirs: string[] = [];
function bundlesDir(): string { const d = mkdtempSync(join(tmpdir(), "mcp-")); dirs.push(d); writeFileSync(join(d, "mini.json"), JSON.stringify(MINI)); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function parse(res: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const first = res.content[0];
  if (!first || first.type !== "text" || !first.text) throw new Error("no text content");
  return JSON.parse(first.text);
}

async function connect(bundlesRoot: string) {
  const host = new SessionHost({ bundlesRoot, live: false });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

describe("lesson-mcp tools", () => {
  it("lists the lesson tools", async () => {
    const client = await connect(bundlesDir());
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ["start_lesson_session", "get_current_scene", "submit_response", "get_scene_artifacts", "request_hint", "submit_turn", "explain_last_adaptation", "get_session_state", "end_session"]) {
      expect(names).toContain(n);
    }
  });
  it("get_scene_artifacts returns the normalized render manifest for the current scene", async () => {
    const client = await connect(bundlesDir());
    const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "mini.json" } }) as never);
    const sid = started["session_id"] as string;
    const a = parse(await client.callTool({ name: "get_scene_artifacts", arguments: { session_id: sid } }) as never);
    const assets = a["scene_assets"] as Array<{ kind: string; payload?: string }>;
    expect(assets.length).toBe(1);
    expect(assets[0]!.kind).toBe("equation_latex");
    expect(assets[0]!.payload).toBe("\\cos\\theta");
  });
  it("request_hint returns an authored hint on a quiz, then null once the per-visit cap is reached", async () => {
    const client = await connect(bundlesDir());
    const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "mini.json" } }) as never);
    const sid = started["session_id"] as string;
    // advance intro → quiz, then pull a hint
    await client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "ack" } } });
    const h1 = parse(await client.callTool({ name: "request_hint", arguments: { session_id: sid } }) as never);
    expect((h1["hint"] as { hint: string; index: number }).hint).toBe("look again at the prompt");
    expect((h1["hint"] as { index: number }).index).toBe(0);
    // standard scaffolding caps at 1 hint per visit → second request yields null
    const h2 = parse(await client.callTool({ name: "request_hint", arguments: { session_id: sid } }) as never);
    expect(h2["hint"]).toBeNull();
  });
  it("drives intro → quiz to a next transition and reads state", async () => {
    const client = await connect(bundlesDir());
    const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "mini.json" } }) as never);
    const sid = started["session_id"] as string;
    expect((started["presentation"] as { scene: { id: string } }).scene.id).toBe("s0");
    const t1 = parse(await client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "ack" } } }) as never);
    expect((t1["transition"] as { kind: string }).kind).toBe("next");
    const st = parse(await client.callTool({ name: "get_session_state", arguments: { session_id: sid } }) as never);
    expect((st["state"] as { lesson_id: string }).lesson_id).toBe("mini-001");
  });
  it("end_session forgets the session", async () => {
    const client = await connect(bundlesDir());
    const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "mini.json" } }) as never);
    const sid = started["session_id"] as string;
    const ended = parse(await client.callTool({ name: "end_session", arguments: { session_id: sid } }) as never);
    expect(ended["forgotten"]).toBe(true);
  });
});
