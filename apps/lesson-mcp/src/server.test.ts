import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost } from "@studium/lesson-session-host";
import packageJson from "../package.json" with { type: "json" };
import { buildMcpServer } from "./server.js";

const FIXTURES = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "fixtures");

const MINI = {
  schema_version: "1.4", bundle_id: "mini-001", source_plan_id: "p",
  metadata: { title: "M", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [
    { id: "s0", type: "intro", title: "I", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "hi",
      evidence: { abs_asset: { asset_type: "equation_latex", payload_inline: "\\cos\\theta", prov_derived_from: "doi:x",
        legend: [{ symbol: "θ", meaning: "angle" }] },
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

/** The durable data folder of the test running inside withDurableData; otherwise every host keeps
 * its state in memory, whatever the developer's environment says (I-10: never their STUDIUM_DATA_DIR
 * or ~/.studium). */
let durableDataDir: string | null = null;

async function connect(bundlesRoot: string, live = false) {
  const host = new SessionHost({ bundlesRoot, live, dataDir: durableDataDir });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

async function withDurableData<T>(fn: (dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), "mcp-data-"));
  dirs.push(dataDir);
  const previousDataDir = process.env["STUDIUM_DATA_DIR"];
  const previousSecret = process.env["STUDIUM_PSEUDO_SECRET"];
  process.env["STUDIUM_DATA_DIR"] = dataDir;
  process.env["STUDIUM_PSEUDO_SECRET"] = "mcp-durable-test-secret";
  durableDataDir = dataDir;
  try { return await fn(dataDir); }
  finally {
    durableDataDir = null;
    if (previousDataDir === undefined) delete process.env["STUDIUM_DATA_DIR"];
    else process.env["STUDIUM_DATA_DIR"] = previousDataDir;
    if (previousSecret === undefined) delete process.env["STUDIUM_PSEUDO_SECRET"];
    else process.env["STUDIUM_PSEUDO_SECRET"] = previousSecret;
  }
}

function quizBundle(bundleId: string, conceptId: string, sceneId = "q-shared") {
  return {
    schema_version: "1.4", bundle_id: bundleId, source_plan_id: "p",
    metadata: { title: bundleId, target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
    concepts: [{ id: conceptId, title: "C", description: "d", bloom_level_target: "understand" }],
    scenes: [
      { id: sceneId, type: "quiz", title: "Q", objective_refs: [], concept_refs: [conceptId], estimated_seconds: 0, adaptation_hooks: [],
        question: "?", choices: [{ id: "wrong", text: "wrong", correct: false }, { id: "right", text: "right", correct: true }],
        feedback_correct: "y", feedback_incorrect: "n", hints: [] },
    ],
    rules: [], validated_by: "teacher", validated_at: "2026-06-10T08:00:00Z",
  };
}

function displayedChoiceId(started: Record<string, unknown>, textValue = "right"): string {
  const scene = (started["presentation"] as { scene: { choices: Array<{ id: string; text: string }> } }).scene;
  const choice = scene.choices.find((candidate) => candidate.text === textValue);
  if (!choice) throw new Error(`choice not found: ${textValue}`);
  return choice.id;
}

describe("lesson-mcp tools", () => {
  it("reports its package version and complete sorted tool surface", async () => {
    const client = await connect(bundlesDir());
    const tools = (await client.listTools()).tools;
    const names = tools.map((tool) => tool.name).sort();
    const info = parse(await client.callTool({ name: "get_server_info", arguments: {} }) as never);
    expect(info["version"]).toBe(packageJson.version);
    expect(info["tools"]).toEqual(names);
    expect(info["tools"]).toEqual([...names].sort());
    // 25 lesson operations + the four C1 study tools (sprint 2026-10-30): list_lessons, get_study_plan,
    // start_review_session, rate_recall; + the three C1 authoring tools (get_authoring_guide,
    // prepare_sources, create_lesson) and the two C1 teacher tools (review_lesson, class_report),
    // wired at integration: 29 + 5 = 34.
    expect(names).toHaveLength(34);
    for (const name of ["get_authoring_guide", "prepare_sources", "create_lesson", "review_lesson", "class_report"]) {
      expect(names).toContain(name);
    }
    expect(names).toContain("forget_session");
    expect(names).toContain("list_community_bundles");
    expect(names).toContain("get_operator_context");
    expect(names).toContain("get_server_info");
    expect(names).toContain("record_experiment");
    expect(names).toContain("get_experiment_journal");
    expect(names).toContain("set_session_language");

    const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? "";
    expect(description("submit_response")).toContain("submit_run_result first");
    expect(description("submit_response")).toContain("DISPLAYED choice id");
    expect(description("submit_response")).toContain("{kind:\"confidence\", pre, post}");
    expect(description("submit_response")).toContain("returns_to");
    expect(description("submit_response")).toContain("skipped_scene_ids");
    expect(description("submit_response")).toContain("scenes_detoured");
    expect(description("submit_response")).toContain("mastery");
    expect(description("get_current_scene")).toContain("EVIDENCE");
    expect(description("get_scene_artifacts")).toContain("not an answer key");
    expect(description("end_session")).toContain("keeps");
    expect(description("end_session")).toContain("forget_session");
    expect(description("forget_session")).toContain("Right to be forgotten");
    expect(description("forget_session")).toContain("irreversible");
    expect(description("list_community_bundles")).toContain("course_id");
    expect(description("list_community_bundles")).toContain("start_lesson_session");
    expect(description("start_lesson_session")).toContain("authoring.notice");
  });
  it("get_next_reinforcement distinguishes no history, nothing due, and due", async () => {
    const client = await connect(bundlesDir());
    const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "mini.json", learner_id: "you" } }) as never);
    const sid = started.session_id as string;
    const empty = parse(await client.callTool({ name: "get_next_reinforcement", arguments: { session_id: sid } }) as never);
    expect(empty).toMatchObject({ reinforcement: null, due: [], reason: "no_history", next_due_at: null });
    // s0 intro → ack; s1 quiz → answer correctly so c1 reaches mastery (bloom "understand" ⇒ w=0.5 ⇒
    // alpha 2.5 / beta 1 = 0.714 ≥ 0.6 minMastery gate)
    await client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "ack" } } });
    await client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "quiz_choice", choiceId: "b" } } });

    // freshly answered ⇒ nothing has decayed yet ⇒ no reinforcement routed
    const fresh = parse(await client.callTool({ name: "get_next_reinforcement", arguments: { session_id: sid } }) as never);
    expect(fresh.reinforcement).toBeNull();
    expect(fresh.reason).toBe("nothing_due");
    expect(Number.isInteger(fresh.next_due_at)).toBe(true);

    // far in the future ⇒ c1's recall has decayed ⇒ route to the RETRIEVAL scene covering c1 (the quiz
    // s1, preferred over the intro s0)
    const future = Date.UTC(2035, 0, 1);
    const due = parse(await client.callTool({ name: "get_next_reinforcement", arguments: { session_id: sid, now_ms: future } }) as never);
    const r = due.reinforcement as { concept_id: string; scene_id: string; due_at: number; retrievability: number; source: string } | null;
    expect(r).not.toBeNull();
    expect(r?.concept_id).toBe("c1");
    expect(r?.scene_id).toBe("s1");
    expect(r?.source).toBe("session");
    expect(Number.isInteger(r?.due_at)).toBe(true);
    expect(r?.retrievability).toBeLessThan(1);
    expect(due.reason).toBe("due");
    expect(due.next_due_at).toBeNull();
    expect((due.due as unknown[])).toHaveLength(1);
  });

  it("get_next_reinforcement returns every due concept in priority order", async () => {
    const d = mkdtempSync(join(tmpdir(), "mcp-")); dirs.push(d);
    const twoDue = {
      ...quizBundle("two-due", "c-high", "q-high-1"),
      concepts: [
        { id: "c-high", title: "High", description: "d", bloom_level_target: "remember" },
        { id: "c-low", title: "Low", description: "d", bloom_level_target: "understand" },
      ],
      scenes: [
        quizBundle("x", "c-high", "q-high-1").scenes[0],
        quizBundle("x", "c-high", "q-high-2").scenes[0],
        quizBundle("x", "c-low", "q-low").scenes[0],
      ],
    };
    writeFileSync(join(d, "two.json"), JSON.stringify(twoDue));
    const client = await connect(d);
    let current = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "two.json", learner_id: "ordered" } }) as never);
    const sid = current.session_id as string;
    for (let index = 0; index < 3; index += 1) {
      const choiceId = displayedChoiceId(current);
      const response = parse(await client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "quiz_choice", choiceId } } }) as never);
      const transition = response.transition as { kind: string; presentation?: unknown };
      if (transition.presentation) current = { presentation: transition.presentation };
    }

    const result = parse(await client.callTool({
      name: "get_next_reinforcement",
      arguments: { session_id: sid, now_ms: Date.UTC(2035, 0, 1) },
    }) as never);
    const due = result.due as Array<{ concept_id: string }>;
    expect(due.map((target) => target.concept_id)).toEqual(["c-high", "c-low"]);
    expect(result.reinforcement).toEqual(due[0]);
  });

  it("validates reinforcement identity and preserves unknown-session errors", async () => {
    const client = await connect(bundlesDir());
    const missing = await client.callTool({ name: "get_next_reinforcement", arguments: {} }) as {
      isError?: boolean; content: Array<{ type: string; text?: string }>;
    };
    expect(missing.isError).toBe(true);
    expect(parse(missing).error).toMatch(/session_id.*learner_id|learner_id.*session_id/);

    const unknown = await client.callTool({
      name: "get_next_reinforcement", arguments: { session_id: "missing" },
    }) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
    expect(unknown.isError).toBe(true);
    expect(parse(unknown).error).toMatch(/session not found/);
  });
  it("get_scene_artifacts returns the normalized render manifest for the current scene", async () => {
    const client = await connect(bundlesDir());
    const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "mini.json" } }) as never);
    const sid = started["session_id"] as string;
    const a = parse(await client.callTool({ name: "get_scene_artifacts", arguments: { session_id: sid } }) as never);
    const assets = a["scene_assets"] as Array<{ kind: string; payload?: string; legend?: Array<{ symbol: string; meaning: string }> }>;
    expect(assets.length).toBe(1);
    expect(assets[0]!.kind).toBe("equation_latex");
    expect(assets[0]!.payload).toBe("\\cos\\theta");
    expect(assets[0]!.legend).toEqual([{ symbol: "θ", meaning: "angle" }]);
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
    // The legend shown on the intro's equation comes back as a notation reminder: with the hint, and
    // still once the hints are spent — it is public material, not a metered hint.
    expect(h1["notation"]).toEqual([{ symbol: "θ", meaning: "angle" }]);
    expect(h2["notation"]).toEqual([{ symbol: "θ", meaning: "angle" }]);
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

  it("end_session closes while forget_session remains the irreversible erasure path", async () => {
    const client = await connect(bundlesDir());
    const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "mini.json" } }) as never);
    const sid = started["session_id"] as string;
    const ended = parse(await client.callTool({ name: "end_session", arguments: { session_id: sid } }) as never);
    expect(ended).toEqual({ closed: true, state_kept: true });

    const second = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "mini.json" } }) as never);
    const forgotten = parse(await client.callTool({
      name: "forget_session", arguments: { session_id: second["session_id"] },
    }) as never);
    // L-13: the reply says what was erased and what stays (it used to be {forgotten: true} alone).
    expect(forgotten).toMatchObject({ forgotten: true, scope: "lesson" });
    expect(forgotten["erased"]).toEqual(expect.arrayContaining([{ kind: "lesson_progress", lessons: ["M"] }]));
    expect(typeof forgotten["display_markdown"]).toBe("string");
  });

  it("end_session says when the learner's progress could not be kept, rather than state_kept: true (L-11, CC-6)", async () => {
    await withDurableData(async (dataDir) => {
      const d = mkdtempSync(join(tmpdir(), "mcp-")); dirs.push(d);
      writeFileSync(join(d, "A.json"), JSON.stringify(quizBundle("lesson-A", "c-a", "q-a")));
      const client = await connect(d);
      const a = parse(await client.callTool({
        name: "start_lesson_session", arguments: { bundle_ref: "A.json", learner_id: "kepler" },
      }) as never);
      await client.callTool({
        name: "submit_response",
        arguments: { session_id: a.session_id, input: { kind: "quiz_choice", choiceId: displayedChoiceId(a) } },
      });
      const folder = readdirSync(dataDir).find((name) => existsSync(join(dataDir, name, "profile.json")));
      writeFileSync(join(dataDir, folder!, "profile.json"), "{ torn");
      const ended = parse(await client.callTool({ name: "end_session", arguments: { session_id: a.session_id } }) as never);
      expect(ended).toMatchObject({ closed: true, state_kept: false });
      expect(ended["persistence_warning"]).toMatch(/profile\.json/);
    });
  });

  it("closing lesson A keeps mastery and profile reinforcement for lesson B and learner-only routing", async () => {
    await withDurableData(async () => {
      const d = mkdtempSync(join(tmpdir(), "mcp-")); dirs.push(d);
      writeFileSync(join(d, "A.json"), JSON.stringify(quizBundle("lesson-A", "c-shared", "q-a")));
      const bundleB = quizBundle("lesson-B", "c-shared", "q-b-review");
      bundleB.scenes.unshift({
        id: "b-intro", type: "intro", title: "Intro", objective_refs: [], concept_refs: ["c-shared"],
        estimated_seconds: 0, adaptation_hooks: [], markdown: "review",
      } as never);
      writeFileSync(join(d, "B.json"), JSON.stringify(bundleB));
      const client = await connect(d);

      const a = parse(await client.callTool({
        name: "start_lesson_session", arguments: { bundle_ref: "A.json", learner_id: "kepler" },
      }) as never);
      expect(a.resume).toEqual({ kind: "new", scene_id: "q-a", scenes_completed: 0 });
      await client.callTool({
        name: "submit_response",
        arguments: { session_id: a.session_id, input: { kind: "quiz_choice", choiceId: displayedChoiceId(a) } },
      });
      expect(parse(await client.callTool({
        name: "end_session", arguments: { session_id: a.session_id },
      }) as never)).toEqual({ closed: true, state_kept: true });

      const b = parse(await client.callTool({
        name: "start_lesson_session", arguments: { bundle_ref: "B.json", learner_id: "kepler" },
      }) as never);
      const mastery = (b.presentation as { learnerSnapshot: { conceptMastery: Record<string, number> } })
        .learnerSnapshot.conceptMastery["c-shared"];
      expect(mastery).toBeGreaterThan(0.6);

      const future = Date.UTC(2035, 0, 1);
      const inSession = parse(await client.callTool({
        name: "get_next_reinforcement", arguments: { session_id: b.session_id, now_ms: future },
      }) as never);
      expect(inSession.reinforcement).toMatchObject({
        concept_id: "c-shared", scene_id: "q-b-review", source: "profile",
      });

      await client.callTool({ name: "end_session", arguments: { session_id: b.session_id } });
      const withoutSession = parse(await client.callTool({
        name: "get_next_reinforcement", arguments: { learner_id: "kepler", now_ms: future },
      }) as never);
      // HJ-1: a learner-only query used to return scene_id null — nothing to play. It now names the
      // lesson and the scene the concept was last graded in (lesson B only showed its intro).
      expect(withoutSession.reinforcement).toMatchObject({
        concept_id: "c-shared", scene_id: "q-a", source: "profile", bundle_ref: "A.json", lesson_title: "lesson-A",
      });
    });
  });

  it("a completed lesson starts as a retake and offers profile-backed review", async () => {
    const client = await connect(bundlesDir());
    const first = parse(await client.callTool({
      name: "start_lesson_session", arguments: { bundle_ref: "mini.json", learner_id: "retake" },
    }) as never);
    expect(first.resume).toEqual({ kind: "new", scene_id: "s0", scenes_completed: 0 });
    const sid = first.session_id as string;
    await client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "ack" } } });
    const current = parse(await client.callTool({ name: "get_current_scene", arguments: { session_id: sid } }) as never);
    const answer = displayedChoiceId({ presentation: current.presentation }, "B");
    await client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "quiz_choice", choiceId: answer } } });
    await client.callTool({ name: "end_session", arguments: { session_id: sid } });

    const retake = parse(await client.callTool({
      name: "start_lesson_session",
      arguments: { bundle_ref: "mini.json", learner_id: "retake", now_ms: Date.UTC(2035, 0, 1) },
    }) as never);
    expect(retake.resume).toEqual({ kind: "completed", scene_id: "s0", scenes_completed: 2 });
    expect((retake.presentation as { scene: { id: string } }).scene.id).toBe("s0");
    expect((retake.due as Array<{ concept_id: string; source: string }>)).toEqual([
      expect.objectContaining({ concept_id: "c1", source: "profile" }),
    ]);
  });

  it("forget_session erases this lesson state and the cross-lesson profile", async () => {
    await withDurableData(async () => {
      const d = mkdtempSync(join(tmpdir(), "mcp-")); dirs.push(d);
      writeFileSync(join(d, "A.json"), JSON.stringify(quizBundle("lesson-A", "c-shared", "q-a")));
      const bundleB = quizBundle("lesson-B", "c-shared", "q-b");
      bundleB.scenes.unshift({
        id: "b-intro", type: "intro", title: "Intro", objective_refs: [], concept_refs: ["c-shared"],
        estimated_seconds: 0, adaptation_hooks: [], markdown: "review",
      } as never);
      writeFileSync(join(d, "B.json"), JSON.stringify(bundleB));
      const client = await connect(d);

      const a = parse(await client.callTool({
        name: "start_lesson_session", arguments: { bundle_ref: "A.json", learner_id: "erase-me" },
      }) as never);
      await client.callTool({
        name: "submit_response",
        arguments: { session_id: a.session_id, input: { kind: "quiz_choice", choiceId: displayedChoiceId(a) } },
      });
      await client.callTool({ name: "end_session", arguments: { session_id: a.session_id } });

      const warm = parse(await client.callTool({
        name: "start_lesson_session", arguments: { bundle_ref: "B.json", learner_id: "erase-me" },
      }) as never);
      expect(Object.keys((warm.presentation as { learnerSnapshot: { conceptMastery: object } }).learnerSnapshot.conceptMastery)).toContain("c-shared");
      await client.callTool({
        name: "submit_response", arguments: { session_id: warm.session_id, input: { kind: "ack" } },
      });
      // L-13: the reply says what was erased and what stays (it used to be {forgotten: true} alone).
      expect(parse(await client.callTool({
        name: "forget_session", arguments: { session_id: warm.session_id },
      }) as never)).toMatchObject({ forgotten: true, scope: "lesson", erased: expect.arrayContaining([{ kind: "learner_profile" }]) });

      const cold = parse(await client.callTool({
        name: "start_lesson_session", arguments: { bundle_ref: "B.json", learner_id: "erase-me" },
      }) as never);
      // L-6: a fresh, unmeasured concept is explicit null, never zero or an absent entry.
      expect((cold.presentation as { learnerSnapshot: { conceptMastery: object } }).learnerSnapshot.conceptMastery).toEqual({ "c-shared": null });
      expect(cold.resume).toEqual({ kind: "new", scene_id: "b-intro", scenes_completed: 0 });
    });
  });
});

describe("lesson-mcp — learner-time run protocol parity (run.json / run_result.json over MCP)", () => {
  const BUNDLE = "capsule-loop-demo/lesson.json"; // intro + reproduction(run_manifest) + spot_the_flaw(reference_from_run)
  // A COMPLETE honest run: every declared verify_check reported — the attestation quarantines an
  // under-reported run from grounding (learner_run_recorded=false), which is its job, not a bug.
  const PASS = {
    ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457",
    artifacts: ["outputs/stats.csv", "figures/decay.png"],
    checks: [{ check: "file exists: outputs/stats.csv", passed: true },
             { check: "file exists: figures/decay.png", passed: true }],
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

  it("submit_response returns run-required until submit_run_result records the run", async () => {
    const client = await connect(FIXTURES);
    const sid = await start(client);
    await ackIntro(client, sid);

    const blocked = await client.callTool({
      name: "submit_response",
      arguments: { session_id: sid, input: { kind: "ack" } },
    }) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
    expect(blocked.isError).toBe(true);
    expect(parse(blocked)["error"]).toBe(
      "run required: call get_run_manifest, run it, then submit_run_result",
    );
    expect(await sceneType(client, sid)).toBe("reproduction");

    const submitted = parse(await client.callTool({
      name: "submit_run_result",
      arguments: { session_id: sid, run_result: PASS },
    }) as never);
    expect(submitted["learner_run_recorded"]).toBe(true);
    expect((submitted["transition"] as { kind: string }).kind).toBe("next");
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

const OPEN_BOOK_FR = "Leçon auto-rédigée\u00a0: les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert). ";
// D5 (sprint 2026-10-30): without a judge the notice no longer promises keyword feedback; it says the
// learner compares with the reference and their self-rating schedules reviews, never mastery.
// B2: L-5 uses tu/French spacing; RFR-09 omits reproduction claims from this intro + quiz fixture.
const SELF_STUDY_NOTICE_FR_WITHOUT_JUDGE = OPEN_BOOK_FR + "Sans juge modèle, les scènes de production ne sont pas " +
  "évaluées\u00a0: compare ta réponse à la référence affichée et note ton rappel\u202f; cette note règle tes révisions, " +
  "jamais ta maîtrise.";
const SELF_STUDY_NOTICE_FR_WITH_JUDGE = OPEN_BOOK_FR + "Les scènes de production sont évaluées par le modèle.";
const SELF_STUDY_BUNDLE = {
  ...MINI, bundle_id: "self-001",
  metadata: { ...MINI.metadata, authoring: { mode: "self_study", author_is_learner: true } },
  validated_by: "SELF-STUDY — not teacher-validated",
};

/** A bundles root with one course directory whose community/ holds MINI zipped as community-k1.zip. */
function communityRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "mcp-community-")); dirs.push(root);
  const stage = mkdtempSync(join(tmpdir(), "mcp-zip-")); dirs.push(stage);
  writeFileSync(join(stage, "lesson.json"), JSON.stringify(MINI));
  mkdirSync(join(root, "kepler", "community"), { recursive: true });
  writeFileSync(join(root, "kepler", "lesson.json"), JSON.stringify(MINI));
  // zip -j keeps the entry name "lesson.json", the one loadBundleZip reads.
  execFileSync("zip", ["-j", "-q", join(root, "kepler", "community", "community-k1.zip"), join(stage, "lesson.json")]);
  return root;
}

describe("lesson-mcp — community bundles and authoring", () => {
  it("list_community_bundles finds a course's community bundle, startable by its bundle_ref", async () => {
    const client = await connect(communityRoot());
    const listed = parse(await client.callTool({ name: "list_community_bundles", arguments: { course_id: "kepler" } }) as never);
    expect(listed).toEqual({ bundles: [{ bundle_ref: "kepler/community/community-k1.zip", course_id: "kepler", item_id: "k1" }] });
    const all = parse(await client.callTool({ name: "list_community_bundles", arguments: {} }) as never);
    expect(all).toEqual(listed);

    const bundleRef = (listed.bundles as Array<{ bundle_ref: string }>)[0]!.bundle_ref;
    const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: bundleRef } }) as never);
    expect(typeof started.session_id).toBe("string");
    expect((started.presentation as { scene: { id: string } }).scene.id).toBe("s0");
  });

  it("list_community_bundles reports an invalid course_id as a tool error", async () => {
    const client = await connect(communityRoot());
    const res = await client.callTool({ name: "list_community_bundles", arguments: { course_id: "../kepler" } }) as {
      isError?: boolean; content: Array<{ type: string; text?: string }>;
    };
    expect(res.isError).toBe(true);
    expect(parse(res).error).toMatch(/invalid course_id/);
  });

  it("start_lesson_session says who wrote the lesson, top-level and on every presentation", async () => {
    const teacherClient = await connect(bundlesDir());
    const teacher = parse(await teacherClient.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "mini.json" } }) as never);
    // C5 adds approval; B2 also exposes the drafter, inferred for older bundles without a declaration.
    const teacherBlock = {
      mode: "teacher", author_is_learner: false, drafted_by: "teacher", validated: true, judge: false, notice: null,
      approval: { recorded: false, matches: false },
    };
    expect(teacher.authoring).toEqual(teacherBlock);
    expect((teacher.presentation as { authoring?: unknown }).authoring).toEqual(teacherBlock);

    const d = mkdtempSync(join(tmpdir(), "mcp-")); dirs.push(d);
    writeFileSync(join(d, "self.json"), JSON.stringify(SELF_STUDY_BUNDLE));
    const client = await connect(d);
    const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "self.json" } }) as never);
    const block = {
      mode: "self_study", author_is_learner: true, drafted_by: "learner", validated: false, judge: false, notice: SELF_STUDY_NOTICE_FR_WITHOUT_JUDGE,
      approval: { recorded: false, matches: false }, // C5
    };
    expect(started.authoring).toEqual(block);
    expect((started.presentation as { authoring?: unknown }).authoring).toEqual(block);
    const sid = started.session_id as string;
    const current = parse(await client.callTool({ name: "get_current_scene", arguments: { session_id: sid } }) as never);
    expect((current.presentation as { authoring?: unknown }).authoring).toEqual(block);
    const next = parse(await client.callTool({ name: "submit_response", arguments: { session_id: sid, input: { kind: "ack" } } }) as never);
    expect((next.transition as { presentation: { authoring?: unknown } }).presentation.authoring).toEqual(block);
    const context = parse(await client.callTool({ name: "get_operator_context", arguments: { session_id: sid } }) as never);
    expect(context.authoring).toEqual(block);
  });

  it("a live host (judge model) reports judge: true and the judged notice", async () => {
    const d = mkdtempSync(join(tmpdir(), "mcp-")); dirs.push(d);
    writeFileSync(join(d, "self.json"), JSON.stringify(SELF_STUDY_BUNDLE));
    const previous = process.env["STUDIUM_PSEUDO_SECRET"];
    process.env["STUDIUM_PSEUDO_SECRET"] = "mcp-judge-test-secret"; // live mode refuses the default secret
    try {
      const client = await connect(d, true);
      const started = parse(await client.callTool({ name: "start_lesson_session", arguments: { bundle_ref: "self.json" } }) as never);
      expect(started.authoring).toEqual({
        // B2 exposes the learner drafter here too, independently of judge availability.
        mode: "self_study", author_is_learner: true, drafted_by: "learner", validated: false, judge: true, notice: SELF_STUDY_NOTICE_FR_WITH_JUDGE,
        approval: { recorded: false, matches: false }, // C5
      });
    } finally {
      if (previous === undefined) delete process.env["STUDIUM_PSEUDO_SECRET"];
      else process.env["STUDIUM_PSEUDO_SECRET"] = previous;
    }
  });
});

// L-12 (SEC-1, RT-8d): create_lesson and prepare_sources always write into the learner's library, the
// C6 library <STUDIUM_HOME>/library, never into the folder BUNDLES_ROOT names (a repository's
// fixtures, where the full text of the learner's sources would be committed and a teacher's lesson
// could be replaced). list_lessons and start_lesson_session search the library after BUNDLES_ROOT, so
// the lesson is listed and started at once; persistence.library_root names where it went. This test
// pinned the previous rule (integration item 1: write into BUNDLES_ROOT so review_lesson finds it).
describe("lesson-mcp — where an authored lesson goes", () => {
  async function authoringClient(host: SessionHost) {
    const server = buildMcpServer(host);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "authoring-root", version: "1.0.0" });
    await client.connect(clientT);
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      client.callTool({ name, arguments: args }) as Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
    return { client, call };
  }

  it("with BUNDLES_ROOT set, create_lesson writes into the library: BUNDLES_ROOT gets nothing, list and start see it", async () => {
    const bundlesRoot = bundlesDir();
    const libraryRoot = mkdtempSync(join(tmpdir(), "mcp-library-"));
    dirs.push(libraryRoot);
    const host = new SessionHost({ bundlesRoot, libraryRoot, live: false, dataDir: null });
    const { client, call } = await authoringClient(host);
    const guide = parse(await call("get_authoring_guide", { language: "fr" }));
    const { source, draft } = guide["example"] as { source: Record<string, unknown>; draft: Record<string, unknown> };
    const prepared = parse(await call("prepare_sources", { sources: [source], goal: draft["goal"], language: "fr" }));
    const created = parse(await call("create_lesson", { source_set_id: prepared["source_set_id"], draft }));
    expect(created).toMatchObject({ ok: true });
    const courseRef = String(created["course_ref"]);
    expect(existsSync(join(libraryRoot, courseRef))).toBe(true);
    expect(existsSync(join(libraryRoot, "_sources", `${String(prepared["source_set_id"])}.json`))).toBe(true);
    expect(existsSync(join(bundlesRoot, courseRef))).toBe(false);
    expect(existsSync(join(bundlesRoot, "_sources"))).toBe(false);

    const listed = parse(await call("list_lessons", {})) as { lessons: Array<{ bundle_ref: string; source: string }> };
    expect(listed.lessons.find((lesson) => lesson.bundle_ref === courseRef)).toMatchObject({ source: "library" });
    const started = parse(await call("start_lesson_session", { bundle_ref: courseRef }));
    expect(started).toHaveProperty("session_id");
    expect(started["persistence"]).toMatchObject({ library_root: libraryRoot });
    await client.close();
  });

  it("a server with no learner library refuses to write a lesson rather than write into BUNDLES_ROOT", async () => {
    const bundlesRoot = bundlesDir();
    const { client, call } = await authoringClient(new SessionHost({ bundlesRoot, live: false, dataDir: null }));
    const refused = await call("prepare_sources", { sources: [{ title: "Note", text: "Un texte assez long pour former un passage citable par la leçon." }] });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(parse(refused))).toMatch(/no learner library/);
    expect(existsSync(join(bundlesRoot, "_sources"))).toBe(false);
    await client.close();
  });
});
