// play_in_forms (prototype, 2026-11-06): keyed scenes answered in forms the client shows (MCP
// elicitation), with no model turn between an answer and its verdict. These tests drive the tool
// through a real MCP client whose elicitation handler plays the learner.
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema, type ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer, TOOL_NAMES } from "./server.js";
import { FORM_TOOL_NAMES } from "./form-tools.js";

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "mcp-forms-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const base = (id: string, type: string) => ({
  id, type, title: `Scène ${id}`, objective_refs: [], concept_refs: ["c1"], estimated_seconds: 30, adaptation_hooks: [],
});
const concept = (id: string) => ({ ...base(id, "concept"), markdown: `Texte de la notion ${id}.` });
const quiz = (id: string) => ({
  ...base(id, "quiz"), question: `Question ${id} ?`,
  choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "BRAVO-RÉVÉLÉ", feedback_incorrect: "RATÉ-RÉVÉLÉ", hints: ["INDICE-SECRET"],
});
const explainBack = (id: string) => ({
  ...base(id, "explain_back"), prompt: "Explique pourquoi le signe change.",
  key_points: [{ id: "kp", text: "POINT-CLÉ-SECRET", cues: ["signe"] }], model_explanation: "MODÈLE-SECRET",
  rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
});
function writeLesson(root: string, scenes: object[]): string {
  const ref = "forms-demo/lesson.json";
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify({
    schema_version: "1.4", bundle_id: "forms-demo", source_plan_id: "p",
    metadata: { title: "Leçon formulaires", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
    concepts: [{ id: "c1", title: "Notion c1", description: "d", bloom_level_target: "understand" }],
    scenes, rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  }));
  return ref;
}

type Form = { message: string; requestedSchema: { properties: Record<string, any>; required?: string[] } };
type Learner = (form: Form) => ElicitResult;
const accept = (content: Record<string, string | number | boolean> = {}): Learner => () => ({ action: "accept", content });
/** Pick a choice by its text, as a learner reading the form would: the form lists "**a)** Juste". */
const choose = (text: string, extra: Record<string, number> = {}): Learner => (form) => {
  const id = form.message.match(new RegExp(`\\*\\*([a-z])\\)\\*\\* ${text}`))?.[1];
  if (!id) throw new Error(`choice "${text}" not found in the form`);
  return { action: "accept", content: { choice: id, ...extra } };
};

function parse(res: unknown): Record<string, any> {
  return JSON.parse((res as { content: Array<{ text: string }> }).content[0]!.text);
}

/** A client that shows forms (learner given) or one that cannot (learner null). */
async function play(scenes: object[], learner: Learner[] | null) {
  const root = tmp();
  const ref = writeLesson(root, scenes);
  const server = buildMcpServer(new SessionHost({ live: false, dataDir: null, bundlesRoot: root }));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: learner ? { elicitation: {} } : {} });
  const forms: Form[] = [];
  if (learner) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      const form = request.params as unknown as Form;
      forms.push(form);
      const next = learner.shift();
      return next ? next(form) : { action: "cancel" };
    });
  }
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown>) => parse(await client.callTool({ name, arguments: args }));
  const session_id = (await call("start_lesson_session", { bundle_ref: ref, learner_id: "auto-forms-test" })).session_id as string;
  const currentScene = async () => (await call("get_current_scene", { session_id })).presentation.scene.id as string;
  return { call, forms, session_id, currentScene, client };
}

describe("play_in_forms", () => {
  it("is registered and listed", async () => {
    const { call } = await play([concept("k1")], null);
    expect([...FORM_TOOL_NAMES]).toEqual(["play_in_forms"]);
    expect(TOOL_NAMES).toContain("play_in_forms");
    expect((await call("get_server_info", {})).tools).toContain("play_in_forms");
  });

  it("plays acknowledged and keyed scenes in forms, then hands a written scene back to the conversation", async () => {
    const { call, forms, session_id, currentScene } = await play(
      [concept("k1"), quiz("q1"), quiz("q2"), explainBack("e1")],
      [accept(), choose("Faux", { confidence: 4 }), choose("Juste")],
    );
    const result = await call("play_in_forms", { session_id });

    expect(forms).toHaveLength(3);
    // 1. a screen to read: the text, and nothing to fill in
    expect(forms[0]!.message).toContain("Texte de la notion k1.");
    expect(forms[0]!.requestedSchema.properties).toEqual({});
    // 2. a quiz: the displayed choices, an optional confidence, and no key
    expect(forms[1]!.message).toContain("Question q1 ?");
    expect(forms[1]!.requestedSchema.properties.choice.enum).toEqual(["a", "b"]);
    expect(forms[1]!.requestedSchema.properties.confidence).toMatchObject({ type: "integer", minimum: 0, maximum: 4 });
    expect(forms[1]!.requestedSchema.required).toEqual(["choice"]);
    expect(forms[1]!.message).not.toMatch(/RÉVÉLÉ|INDICE-SECRET/);
    // 3. the next form opens with the verdict of the answer just given, then the next question
    expect(forms[2]!.message.indexOf("RATÉ-RÉVÉLÉ")).toBeGreaterThanOrEqual(0);
    expect(forms[2]!.message.indexOf("RATÉ-RÉVÉLÉ")).toBeLessThan(forms[2]!.message.indexOf("Question q2 ?"));
    expect(forms[2]!.message).not.toContain("BRAVO-RÉVÉLÉ");

    expect(result.status).toBe("needs_conversation");
    expect(result.reason).toContain("explain_back");
    expect(result.steps).toEqual([
      { scene_id: "k1", scene_type: "concept" },
      { scene_id: "q1", scene_type: "quiz", correct: false, confidence: 4 },
      { scene_id: "q2", scene_type: "quiz", correct: true },
    ]);
    expect(result.presentation.scene.id).toBe("e1");
    // what the learner has not seen yet: the verdict of q2, then the written scene; never its key
    expect(result.display_markdown.indexOf("BRAVO-RÉVÉLÉ")).toBeLessThan(result.display_markdown.indexOf("Explique pourquoi"));
    expect(result.display_markdown.indexOf("BRAVO-RÉVÉLÉ")).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toMatch(/POINT-CLÉ-SECRET|MODÈLE-SECRET|INDICE-SECRET/);
    expect(await currentScene()).toBe("e1");
  });

  it("returns to the conversation when the learner declines or closes a form, and answers nothing for them", async () => {
    for (const [action, reason] of [["decline", "declined"], ["cancel", "cancelled"]] as const) {
      const { call, forms, session_id, currentScene } = await play([concept("k1"), quiz("q1"), concept("k2")], [accept(), () => ({ action })]);
      const result = await call("play_in_forms", { session_id });
      expect(forms).toHaveLength(2);
      expect(result).toMatchObject({ status: "paused", reason, steps: [{ scene_id: "k1", scene_type: "concept" }] });
      expect(result.display_markdown).toContain("Question q1 ?");
      expect(await currentScene()).toBe("q1");
    }
  });

  it("says so when the client cannot show forms, and changes nothing", async () => {
    const { call, session_id, currentScene } = await play([concept("k1"), quiz("q1")], null);
    const result = await call("play_in_forms", { session_id });
    expect(result).toMatchObject({ status: "unsupported", steps: [] });
    expect(result.display_markdown).toContain("Texte de la notion k1.");
    expect(await currentScene()).toBe("k1");
  });

  it("stops at max_steps", async () => {
    const { call, forms, session_id, currentScene } = await play([concept("k1"), concept("k2"), concept("k3")], [accept(), accept(), accept()]);
    const result = await call("play_in_forms", { session_id, max_steps: 2 });
    expect(forms).toHaveLength(2);
    expect(result).toMatchObject({ status: "limit", steps: [{ scene_id: "k1" }, { scene_id: "k2" }] });
    expect(await currentScene()).toBe("k3");
  });

  it("reaches the end of the lesson inside the forms", async () => {
    const { call, forms, session_id } = await play([concept("k1"), quiz("q1")], [accept(), choose("Juste", { confidence: 3 })]);
    const result = await call("play_in_forms", { session_id });
    expect(forms).toHaveLength(2);
    expect(result.status).toBe("complete");
    expect(result.steps.at(-1)).toEqual({ scene_id: "q1", scene_type: "quiz", correct: true, confidence: 3 });
    expect(result.display_markdown).toContain("BRAVO-RÉVÉLÉ");
    expect(result.presentation).toBeUndefined();
  });

  it("does not open a form on a scene that needs written words", async () => {
    const { call, forms, session_id } = await play([explainBack("e1"), quiz("q1")], []);
    const result = await call("play_in_forms", { session_id });
    expect(forms).toHaveLength(0);
    expect(result).toMatchObject({ status: "needs_conversation", steps: [] });
    expect(result.display_markdown).toContain("Explique pourquoi");
  });

  it("refuses an unknown session in one line", async () => {
    const { client } = await play([concept("k1")], []);
    const res = await client.callTool({ name: "play_in_forms", arguments: { session_id: "absent" } }) as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("session");
  });
});
