import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

const FIXTURES = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "fixtures");

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
    for (const n of ["start_lesson_session", "get_current_scene", "submit_response", "get_scene_artifacts", "request_hint", "submit_turn", "explain_last_adaptation", "get_session_state", "end_session", "get_run_manifest", "submit_run_result"]) {
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
  it("redacts the answer key from the quiz scene shipped to the client, yet still grades a submit server-side", async () => {
    const client = await connect(bundlesDir());
    const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "mini.json" } }) as never);
    const sid = started["session_id"] as string;
    // advance intro → quiz, then read the client-facing presentation
    await client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "ack" } } });
    const cur = parse(await client.callTool({ name: "get_current_scene", arguments: { session_id: sid } }) as never);
    const scene = (cur["presentation"] as { scene: Record<string, unknown> }).scene;
    expect(scene["type"]).toBe("quiz");
    // choices keep id + text but NOT the correct flag
    const choices = scene["choices"] as Array<Record<string, unknown>>;
    expect(choices.map((c) => c["text"])).toEqual(["A", "B"]);
    for (const c of choices) expect("correct" in c).toBe(false);
    // no answer-bearing field anywhere in the serialized transport
    const wire = JSON.stringify(cur);
    expect(wire).not.toContain("\"correct\"");
    // the server still grades the (correct) choice server-side (quiz is the last scene → complete)
    const t = parse(await client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "quiz_choice", choiceId: "b" } } }) as never);
    expect((t["transition"] as { kind: string }).kind).toBe("complete");
    const st = parse(await client.callTool({ name: "get_session_state", arguments: { session_id: sid } }) as never);
    // c1 was answered (graded server-side from the full scene's `correct` flag) → recorded attempt
    const cs = (st["state"] as { concept_states: Record<string, { total_attempts: number }> }).concept_states;
    expect(cs["c1"]?.total_attempts).toBeGreaterThanOrEqual(1);
  });

  it("redacts claims / key_points / model_* from active-learning scenes on the client transport", async () => {
    // A bundle whose scenes carry every answer-bearing field family.
    const ACTIVE = {
      ...MINI, bundle_id: "active-001",
      scenes: [
        { id: "f0", type: "spot_the_flaw", title: "F", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
          flawed_content: "N is 1s2 2s2 2p4", claims: [{ id: "k1", text: "wrong", flaws_expected: ["hund"] }],
          model_correction: "N is 1s2 2s2 2p3", rubric: { completeness: 1, evidence_quality: 1, tone: 1 } },
        { id: "e0", type: "explain_back", title: "E", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
          prompt: "Explain it", key_points: [{ id: "k1", text: "x", cues: ["node"] }],
          model_explanation: "reveal", rubric: { completeness: 1, evidence_quality: 1, tone: 1 } },
      ],
    };
    const d = mkdtempSync(join(tmpdir(), "mcp-")); dirs.push(d); writeFileSync(join(d, "active.json"), JSON.stringify(ACTIVE));
    const client = await connect(d);
    const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "active.json" } }) as never);
    const sid = started["session_id"] as string;
    // first scene (spot_the_flaw) is shipped in the start presentation
    const scene = (started["presentation"] as { scene: Record<string, unknown> }).scene;
    expect(scene["type"]).toBe("spot_the_flaw");
    expect(scene["flawed_content"]).toBe("N is 1s2 2s2 2p4"); // attemptable field kept
    expect("claims" in scene).toBe(false);
    expect("model_correction" in scene).toBe(false);
    const wire0 = JSON.stringify(started);
    expect(wire0).not.toContain("model_correction");
    expect(wire0).not.toContain("flaws_expected");
    expect(wire0).not.toContain("hund"); // the matcher cue never reaches the client
    // submit grades server-side and advances to the explain_back scene (also redacted)
    const t = parse(await client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "flaw_report", text: "the 2p filling violates hund's rule" } } }) as never);
    const next = (t["transition"] as { presentation: { scene: Record<string, unknown> } }).presentation.scene;
    expect(next["type"]).toBe("explain_back");
    expect(next["prompt"]).toBe("Explain it");
    expect("key_points" in next).toBe(false);
    expect("model_explanation" in next).toBe(false);
    const wire1 = JSON.stringify(t);
    expect(wire1).not.toContain("model_explanation");
    expect(wire1).not.toContain("\"cues\"");
  });

  it("end_session forgets the session", async () => {
    const client = await connect(bundlesDir());
    const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "mini.json" } }) as never);
    const sid = started["session_id"] as string;
    const ended = parse(await client.callTool({ name: "end_session", arguments: { session_id: sid } }) as never);
    expect(ended["forgotten"]).toBe(true);
  });
});

describe("lesson-mcp — learner-time run protocol parity (run.json / run_result.json over MCP)", () => {
  const BUNDLE = "capsule-loop-demo/lesson.json"; // intro + reproduction(run_manifest) + spot_the_flaw(reference_from_run)
  const PASS = {
    ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457",
    artifacts: ["outputs/stats.csv", "figures/decay.png"],
    checks: [{ check: "file exists: outputs/stats.csv", passed: true }],
  };
  const start = async (client: Client) =>
    (parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: BUNDLE } }) as never))["session_id"] as string;
  const ackIntro = async (client: Client, sid: string) =>
    client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "ack" } } }); // intro -> run scene
  const sceneType = async (client: Client, sid: string) =>
    ((parse(await client.callTool({ name: "get_current_scene", arguments: { session_id: sid } }) as never))["presentation"] as { scene: { type: string } }).scene.type;

  it("get_run_manifest is null on a non-run scene, returns the (non-answer-bearing) manifest on the run scene", async () => {
    const client = await connect(FIXTURES);
    const sid = await start(client);
    expect((parse(await client.callTool({ name: "get_run_manifest", arguments: { session_id: sid } }) as never))["run_manifest"]).toBeNull();
    await ackIntro(client, sid);
    const m = (parse(await client.callTool({ name: "get_run_manifest", arguments: { session_id: sid } }) as never))["run_manifest"] as { cmd: string[]; expected_outputs: string[] };
    expect(m.cmd).toEqual(["python", "scripts/run.py"]);
    expect(m.expected_outputs).toContain("outputs/stats.csv");
    expect(JSON.stringify(m)).not.toContain("k_fit"); // no author landmark / expected values
  });

  it("submit_run_result gates on ran && passed — self-heals (no advance) on a failed run", async () => {
    const client = await connect(FIXTURES);
    const sid = await start(client);
    await ackIntro(client, sid);
    const a = parse(await client.callTool({ name: "submit_run_result", arguments: { session_id: sid, run_result: { ran: false, passed: false } } }) as never);
    expect(a["status"]).toBe("run_incomplete");
    expect(a["transition"]).toBeNull();
    expect(await sceneType(client, sid)).toBe("reproduction"); // still on the run scene (no advance)
    const b = parse(await client.callTool({ name: "submit_run_result", arguments: { session_id: sid, run_result: { ran: true, passed: false, checks: [{ check: "file exists: outputs/stats.csv", passed: false }] } } }) as never);
    expect(b["status"]).toBe("run_failed_checks");
    expect(await sceneType(client, sid)).toBe("reproduction");
  });

  it("a passing run advances, grounds the later judgment on the LEARNER's run (redacted), and feeds trust_calibration", async () => {
    const client = await connect(FIXTURES);
    const sid = await start(client);
    await ackIntro(client, sid);
    const r = parse(await client.callTool({ name: "submit_run_result", arguments: { session_id: sid, run_result: PASS } }) as never);
    expect(r["status"]).toBe("ran");
    expect(r["learner_run_recorded"]).toBe(true);
    expect((r["transition"] as { kind: string }).kind).toBe("next"); // advanced to the judgment

    const cur = parse(await client.callTool({ name: "get_current_scene", arguments: { session_id: sid } }) as never);
    const scene = (cur["presentation"] as { scene: Record<string, unknown> }).scene;
    expect(scene["type"]).toBe("spot_the_flaw");
    expect((scene["reference_result"] as { landmark?: string }).landmark).toContain("k_fit=0.4212"); // the LEARNER's run
    expect("claims" in scene).toBe(false); // answer key still redacted over MCP
    expect(JSON.stringify(cur)).not.toContain("model_correction");

    const arts = parse(await client.callTool({ name: "get_scene_artifacts", arguments: { session_id: sid } }) as never);
    const execAsset = (arts["scene_assets"] as Array<{ kind: string; meta?: { landmark?: string } }>).find((a) => a.kind === "executed_result");
    expect(execAsset?.meta?.landmark).toContain("k_fit=0.4212");

    await client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "flaw_report", text: "k a des unites (1/temps), pas sans dimension" } } });
    const st = parse(await client.callTool({ name: "get_session_state", arguments: { session_id: sid } }) as never);
    const cs = (st["state"] as { concept_states: Record<string, { trust_calibration_samples?: number }> }).concept_states["c-kinetics"];
    expect(cs?.trust_calibration_samples).toBeGreaterThanOrEqual(1); // judging YOUR OWN run fed trust over MCP
  });

  it("submit_run_result on a NON-run scene is rejected (not_a_run_scene), never advances", async () => {
    const client = await connect(FIXTURES);
    const sid = await start(client); // still on intro (not a run scene)
    const r = parse(await client.callTool({ name: "submit_run_result", arguments: { session_id: sid, run_result: PASS } }) as never);
    expect(r["status"]).toBe("not_a_run_scene");
    expect(r["transition"]).toBeNull();
    expect(await sceneType(client, sid)).toBe("intro");
  });
});
