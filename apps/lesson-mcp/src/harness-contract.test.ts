// apps/lesson-mcp/src/harness-contract.test.ts
//
// What a harness reads and sends, after the 2026-10-30 verification replays:
//   RT-8a        the instructions and prompts write the call as the tool takes it:
//                submit_response {session_id, input: {kind: "reply", text}};
//   RFR-16       the learn prompt calls list_lessons only when the plan does not already say « author »;
//   L-4          get_study_plan, list_lessons and start_review_session take language (fr|en), the prompts
//                pass it, and the plan's next step carries it;
//   L-1          now_ms is an integer epoch in a Date-safe range on every tool that takes it;
//   L-8, H3      get_next_reinforcement counts the reviews to relearn and the unmeasured ones;
//   L-13         forget_session takes a session_id or a learner_id, and says what it erased and kept;
//   RFR-14       an unknown session says which call resumes it;
//   RFR-13       get_server_info names the time zone every date is computed in.
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost, type SessionHostOptions } from "@studium/lesson-session-host";
import { buildMcpServer, SERVER_INSTRUCTIONS } from "./server.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-02T09:00:00Z");
const REPLY_CALL = "submit_response {session_id, input: {kind: \"reply\", text}}";

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "mcp-contract-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function write(root: string, ref: string, data: object): void {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(data));
}
const quiz = (id: string, concept: string) => ({
  id, type: "quiz", title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 30, adaptation_hooks: [],
  question: `Question ${id} ?`, choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "oui", feedback_incorrect: "non", hints: [],
});
function lesson(id: string, scenes: Array<{ concept_refs: string[] }>) {
  const concepts = [...new Set(scenes.flatMap((s) => s.concept_refs))];
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "p",
    metadata: { title: `Leçon ${id}`, target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
    concepts: concepts.map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
    scenes, rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  };
}

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
/** The JSON a tool answers with; a refusal by the MCP schema check comes as plain text: {error: text}. */
function body(res: unknown): Record<string, any> {
  const text = (res as Result).content[0]?.text ?? "null";
  try { return JSON.parse(text) as Record<string, any>; } catch { return { error: text }; }
}

async function connect(options: Partial<SessionHostOptions> & { bundlesRoot: string }) {
  const host = new SessionHost({ live: false, dataDir: null, ...options });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "contract", version: "1.0.0" });
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args }) as Result;
    return { error: res.isError === true, body: body(res) };
  };
  return { client, call, host };
}
const promptText = async (client: Client, name: string, args: Record<string, string>) =>
  ((await client.getPrompt({ name, arguments: args })).messages[0]!.content as { text: string }).text;
const idOf = (presentation: { scene: { choices: Array<{ id: string; text: string }> } }, text: string) =>
  presentation.scene.choices.find((c) => c.text === text)!.id;
function movableClock(start: number) {
  let now = start;
  return { clock: { now: () => new Date(now).toISOString() }, set: (ms: number) => { now = ms; } };
}

describe("instructions and prompts (RT-8a, RFR-16, L-4)", () => {
  it("write the reply call as submit_response takes it", async () => {
    const { client } = await connect({ bundlesRoot: tmp() });
    expect(client.getInstructions()).toContain(REPLY_CALL);
    expect(SERVER_INSTRUCTIONS.split("\n").length).toBeLessThanOrEqual(12);
    for (const language of ["en", "fr"]) {
      expect(await promptText(client, "learn", { topic: "x", language })).toContain(REPLY_CALL);
      expect(await promptText(client, "review", { language })).toContain(REPLY_CALL);
    }
  });

  it("call list_lessons only when the plan's next step is not to author, and pass the language", async () => {
    const { client } = await connect({ bundlesRoot: tmp() });
    const en = await promptText(client, "learn", { topic: "binary search", learner_id: "ren", language: "en" });
    expect(en).toContain("get_study_plan with learner_id \"ren\" and language \"en\"");
    expect(en).toMatch(/If its next_step is author[^.]*\.[^]*Otherwise[^.]*list_lessons/);
    const fr = await promptText(client, "learn", { topic: "la photosynthèse", learner_id: "ana", language: "fr" });
    expect(fr).toContain("get_study_plan avec learner_id « ana » et language « fr »");
    expect(fr).toMatch(/Si son next_step est author[^]*Sinon[^.]*list_lessons/);
    expect(await promptText(client, "review", { learner_id: "ana", language: "fr" }))
      .toContain("start_review_session avec learner_id « ana » et language « fr »");
    // A prompt without a language names none: the server's default applies.
    expect(await promptText(client, "learn", {})).not.toContain("language");
  });
});

describe("language on the study tools (L-4)", () => {
  it("get_study_plan, list_lessons and start_review_session take fr or en, and refuse anything else", async () => {
    const { call } = await connect({ bundlesRoot: tmp() });
    const plan = await call("get_study_plan", { learner_id: "ana", language: "fr" });
    expect(plan.body.display_markdown).toContain("### Ton plan d'étude");
    expect(plan.body.next_step).toMatchObject({ tool: "get_authoring_guide", arguments: { language: "fr" } });
    expect((await call("list_lessons", { language: "en" })).body.display_markdown).toMatch(/^### Lessons/);
    expect((await call("start_review_session", { learner_id: "ana", language: "en" })).body).toMatchObject({ status: "nothing_due" });
    for (const tool of ["get_study_plan", "list_lessons", "start_review_session"]) {
      const refused = await call(tool, { language: "de" });
      expect(refused.error).toBe(true);
      expect(JSON.stringify(refused.body)).toMatch(/language/);
    }
  });
});

describe("now_ms (L-1)", () => {
  it.each([
    ["get_study_plan", { now_ms: 1.5 }],
    ["start_review_session", { now_ms: 1e16 }],
    ["start_lesson_session", { bundle_ref: "A.json", now_ms: -1 }],
    ["get_next_reinforcement", { learner_id: "ana", now_ms: 1e16 }],
  ])("%s refuses a now_ms that is not an integer epoch in a Date-safe range", async (tool, args) => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-q", "c-q")]));
    const { call } = await connect({ bundlesRoot: bundles });
    const refused = await call(tool, args);
    expect(refused.error).toBe(true);
    expect(JSON.stringify(refused.body)).toMatch(/now_ms must be an integer epoch/);
  });
});

describe("get_next_reinforcement counts every review due (H3)", () => {
  it("a concept to relearn makes the reason due, and the totals count it", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-q", "c-weak")]));
    const { clock, set } = movableClock(T0);
    const { call } = await connect({ bundlesRoot: bundles, clock });
    const started = await call("start_lesson_session", { bundle_ref: "A.json", learner_id: "ana" });
    await call("submit_response", { session_id: started.body.session_id, input: { kind: "quiz_choice", choiceId: idOf(started.body.presentation, "Faux") } });
    set(T0 + 7 * DAY);
    const status = (await call("get_next_reinforcement", { learner_id: "ana" })).body;
    expect(status).toMatchObject({
      due: [], reason: "due", next_due_at: null, counts: { due: 0, relearn: 1, unmeasured: 0, total: 1 },
      reinforcement: { concept_id: "c-weak" },
    });
    expect(status.relearn).toEqual([expect.objectContaining({ concept_id: "c-weak" })]);
  });
});

describe("forget_session (L-13)", () => {
  it("takes exactly one of session_id or learner_id", async () => {
    const { call } = await connect({ bundlesRoot: tmp() });
    expect((await call("forget_session", {})).body.error).toMatch(/one of session_id or learner_id/);
    expect((await call("forget_session", { session_id: "s", learner_id: "ana" })).body.error).toMatch(/one of session_id or learner_id/);
  });

  it("erases a learner with no live session, and says what it erased and what it kept", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-q", "c-q"), quiz("s-q2", "c-q")]));
    const { call } = await connect({ bundlesRoot: bundles, dataDir: tmp() });
    const started = await call("start_lesson_session", { bundle_ref: "A.json", learner_id: "ana" });
    await call("submit_response", { session_id: started.body.session_id, input: { kind: "quiz_choice", choiceId: idOf(started.body.presentation, "Juste") } });
    await call("end_session", { session_id: started.body.session_id });

    const forgotten = await call("forget_session", { learner_id: "ana" });
    expect(forgotten.error).toBe(false);
    expect(forgotten.body).toMatchObject({ forgotten: true, scope: "learner" });
    expect(forgotten.body.erased).toEqual(expect.arrayContaining([{ kind: "lesson_progress", lessons: ["Leçon lesson-A"] }]));
    expect(Array.isArray(forgotten.body.kept)).toBe(true);
    expect(forgotten.body.display_markdown).toContain("Leçon lesson-A");
    const again = await call("start_lesson_session", { bundle_ref: "A.json", learner_id: "ana" });
    expect(again.body.resume).toMatchObject({ kind: "new", scenes_completed: 0 });
  });
});

describe("an unknown session (RFR-14) and the time zone (RFR-13)", () => {
  it("says which call resumes, and get_server_info names the time zone", async () => {
    const { call } = await connect({ bundlesRoot: tmp(), timeZone: "Europe/Paris" });
    const lost = await call("submit_response", { session_id: "gone-42", input: { kind: "reply", text: "b" } });
    expect(lost.error).toBe(true);
    expect(lost.body.error).toMatch(/^session not found: gone-42/);
    expect(lost.body.error).toContain("start_lesson_session");
    expect((await call("get_server_info")).body.time_zone).toBe("Europe/Paris");
  });
});
