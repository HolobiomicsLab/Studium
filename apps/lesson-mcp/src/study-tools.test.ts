// apps/lesson-mcp/src/study-tools.test.ts
//
// The study loop over MCP (sprint 2026-10-30, W2; contracts C1, C4, C6): the four study tools, the
// server instructions and prompts, the persistence block, display_markdown on the wire with no key
// before the answer, a chat reply as an answer, and input errors in one readable line (HJ-7).
import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SELF_RATING_CHOICES } from "@studium/lesson-session";
import { SessionHost, type SessionHostOptions } from "@studium/lesson-session-host";
import { buildMcpServer, RECALL_GRADES, STUDY_TOOL_NAMES } from "./server.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-02T09:00:00Z");

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "mcp-study-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function write(root: string, ref: string, bundle: object): void {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(bundle));
}

const base = (id: string, type: string, concept: string) => ({
  id, type, title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 30, adaptation_hooks: [],
});
const EVIDENCE = {
  bibliographic_refs: [{
    perspicacite_doc_id: "d1", title: "Atkins, Chimie physique", authors: ["Atkins"], excerpt: "PASSAGE-QUI-RÉPOND",
    relevance_score: 0.9, prov_derived_from: "https://example.org/atkins",
  }],
  enrichment_metadata: { enricher_version: "1", perspicacite_mode_used: "passages", timestamp: "2026-10-01T00:00:00Z", degraded: false },
};
const quiz = (id: string, concept: string, extra: object = {}) => ({
  ...base(id, "quiz", concept), question: `Question ${id} ?`,
  choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "BRAVO-RÉVÉLÉ", feedback_incorrect: "RATÉ-RÉVÉLÉ", hints: [], ...extra,
});
const explainBack = (id: string, concept: string) => ({
  ...base(id, "explain_back", concept), prompt: "Explique pourquoi le signe change.",
  key_points: [{ id: "kp", text: "POINT-CLÉ-SECRET", cues: ["signe"] }], model_explanation: "MODÈLE-SECRET",
  rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
});
function lesson(id: string, scenes: Array<{ concept_refs: string[] }>, title = `Leçon ${id}`) {
  const concepts = [...new Set(scenes.flatMap((s) => s.concept_refs))];
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "p",
    metadata: { title, target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
    concepts: concepts.map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
    scenes, rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  };
}

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
function parse(res: unknown): Record<string, any> {
  const first = (res as Result).content[0];
  if (!first || first.type !== "text" || !first.text) throw new Error("no text content");
  return JSON.parse(first.text);
}
const errorText = (res: unknown): string => (res as Result).content[0]?.text ?? "";

async function connect(options: Partial<SessionHostOptions> & { bundlesRoot: string }) {
  const host = new SessionHost({ live: false, dataDir: null, ...options });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  return { client, call };
}

/** The displayed id of a choice: choices are reshuffled and re-lettered per session. */
function idOf(presentation: { scene: { choices: Array<{ id: string; text: string }> } }, text = "Juste"): string {
  return presentation.scene.choices.find((c) => c.text === text)!.id;
}

function movableClock(start: number) {
  let now = start;
  return { clock: { now: () => new Date(now).toISOString() }, set: (ms: number) => { now = ms; } };
}

describe("what a harness reads first", () => {
  it("declares instructions and the learn and review prompts", async () => {
    const { client } = await connect({ bundlesRoot: tmp() });
    const instructions = client.getInstructions() ?? "";
    expect(instructions.split("\n").length).toBeLessThanOrEqual(12);
    for (const expected of ["get_study_plan", "learner_id", "display_markdown", "add nothing of your own", "{kind: \"reply\", text}", "rate_recall", "export_concept_map", "forget_session"]) {
      expect(instructions).toContain(expected);
    }
    expect((await client.listPrompts()).prompts.map((p) => p.name).sort()).toEqual(["learn", "review"]);
    const learn = await client.getPrompt({ name: "learn", arguments: { topic: "les orbitales", learner_id: "ana", language: "fr" } });
    const learnText = (learn.messages[0]!.content as { text: string }).text;
    expect(learnText).toContain("« les orbitales »");
    expect(learnText).toContain("get_study_plan avec learner_id « ana »");
    const review = await client.getPrompt({ name: "review", arguments: {} });
    expect((review.messages[0]!.content as { text: string }).text).toMatch(/^Run my Studium reviews: call start_review_session\. /);
  });

  it("get_server_info lists every registered tool and where progress lives (C6)", async () => {
    const bundlesRoot = tmp();
    const { client, call } = await connect({ bundlesRoot, defaultLearnerId: "moi" });
    const info = parse(await call("get_server_info"));
    const listed = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(info.tools).toEqual(listed);
    for (const name of STUDY_TOOL_NAMES) expect(listed).toContain(name);
    expect(info.bundles_root).toBe(bundlesRoot);
    expect(info.data_dir).toBeNull();
    expect(info.persistence).toMatchObject({ durable: false, data_dir: null, library_root: null, learner_id_default: "moi" });
    expect(info.persistence.warning).toMatch(/lost when this server restarts/);
  });

  it("rate_recall offers exactly the session's self-rating grades", () => {
    expect([...RECALL_GRADES]).toEqual([...SELF_RATING_CHOICES]);
  });
});

describe("a lesson over the wire", () => {
  it("start_lesson_session carries persistence and a display_markdown with no key; the verdict carries the earned text", async () => {
    const bundlesRoot = tmp();
    const dataDir = tmp();
    write(bundlesRoot, "C.json", lesson("lesson-C", [quiz("s-q", "c-signe", { evidence: EVIDENCE }), quiz("s-q2", "c-signe")]));
    const { call } = await connect({ bundlesRoot, dataDir });
    const startedRes = await call("start_lesson_session", { bundle_ref: "C.json", learner_id: "ana" });
    const started = parse(startedRes);
    expect(started.persistence).toEqual({ durable: true, data_dir: dataDir, library_root: null, learner_id_default: "anonymous" });
    expect(started.presentation.display_markdown).toContain("Question s-q ?");
    const wire = errorText(startedRes);
    for (const secret of ["BRAVO-RÉVÉLÉ", "RATÉ-RÉVÉLÉ", "PASSAGE-QUI-RÉPOND", "\"correct\""]) expect(wire).not.toContain(secret);

    const answered = parse(await call("submit_response", {
      session_id: started.session_id, input: { kind: "reply", text: `je choisis ${idOf(started.presentation)}` },
    }));
    const { verdict, ...rest } = answered.transition;
    expect(verdict).toMatchObject({ correct: true, sources: [{ title: "Atkins, Chimie physique", quote: "PASSAGE-QUI-RÉPOND", url: "https://example.org/atkins" }] });
    expect(verdict.display_markdown).toContain("BRAVO-RÉVÉLÉ");
    // Outside the verdict, a transition is the public projection of the next scene only.
    for (const secret of ["BRAVO-RÉVÉLÉ", "PASSAGE-QUI-RÉPOND", "\"correct\""]) expect(JSON.stringify(rest)).not.toContain(secret);
    expect(rest.display_markdown).toContain("Question s-q2 ?");
  });

  it("refuses a malformed or impossible answer in one line, before grading", async () => {
    const bundlesRoot = tmp();
    write(bundlesRoot, "Q.json", lesson("lesson-Q", [quiz("s-1", "c-signe")]));
    const { call } = await connect({ bundlesRoot });
    const started = parse(await call("start_lesson_session", { bundle_ref: "Q.json" }));
    const sid = started.session_id;

    const missing = await call("submit_response", { session_id: sid, input: { kind: "quiz_choice" } });
    expect((missing as Result).isError).toBe(true);
    // Lead decision I-4: the refusal lists the ids on screen (the plan's « ids affichés : a|b »), which
    // only the host knows; the schema used to answer without them.
    const shown = (started.presentation.scene.choices as Array<{ id: string }>).map((c) => c.id).join(", ");
    expect(parse(missing).error).toBe(`quiz_choice needs choiceId, one of the displayed choice ids: ${shown}`);
    expect(errorText(missing)).not.toContain("\n");
    expect(errorText(missing).length).toBeLessThan(300);
    const unknownKind = await call("submit_response", { session_id: sid, input: { kind: "answer", text: "b" } });
    expect(errorText(unknownKind)).toMatch(/kind must be one of ack, quiz_choice, .*reply/);
    expect(errorText(unknownKind)).not.toContain("\n");

    const notDisplayed = await call("submit_response", { session_id: sid, input: { kind: "quiz_choice", choiceId: "s1-b" } });
    expect(parse(notDisplayed).error).toMatch(/^quiz_choice "s1-b" is not a displayed choice id: /);
    const unreadable = await call("submit_response", { session_id: sid, input: { kind: "reply", text: "aucune idée" } });
    expect(parse(unreadable).error).toMatch(/^this quiz takes one of the displayed choice ids: /);
    // Neither cost an attempt: the quiz is still current, and the right answer completes the lesson.
    const done = parse(await call("submit_response", { session_id: sid, input: { kind: "quiz_choice", choiceId: idOf(started.presentation) } }));
    expect(done.transition).toMatchObject({ kind: "complete", verdict: { scene_id: "s-1", correct: true } });
  });
});

describe("the study tools (C1)", () => {
  it("rate_recall schedules after an uncertified answer, never mastery, and refuses what nobody asked for", async () => {
    const bundlesRoot = tmp();
    write(bundlesRoot, "E.json", lesson("lesson-E", [explainBack("s-e", "c-signe"), quiz("s-q", "c-signe")]));
    const { call } = await connect({ bundlesRoot });
    const started = parse(await call("start_lesson_session", { bundle_ref: "E.json", learner_id: "ana" }));
    const sid = started.session_id;
    const answered = parse(await call("submit_response", { session_id: sid, input: { kind: "reply", text: "Le signe change entre les lobes." } }));
    expect(answered.transition.self_rating).toEqual({ requested: true, grades: ["again", "hard", "good", "easy"], scene_id: "s-e" });
    const before = parse(await call("get_session_state", { session_id: sid }));

    const badGrade = await call("rate_recall", { session_id: sid, scene_id: "s-e", grade: "great" });
    expect(errorText(badGrade)).toMatch(/grade must be one of again, hard, good, easy/);
    const rated = parse(await call("rate_recall", { session_id: sid, scene_id: "s-e", grade: "hard" }));
    expect(rated).toMatchObject({ scene_id: "s-e", concept_id: "c-signe", grade: "hard", source: "self_rated" });
    expect(rated.next_review_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rated.display_markdown).toContain("jamais ta maîtrise");
    // L-9 (group A): the pending self-rating request now lives in the learner state, and the rating
    // consumes it. Everything else, mastery included, is exactly as before the rating.
    const after = parse(await call("get_session_state", { session_id: sid }));
    const { self_rating_requests: pendingBefore, ...stateBefore } = before.state;
    const { self_rating_requests: pendingAfter, ...stateAfter } = after.state;
    expect(stateAfter).toEqual(stateBefore);
    expect(Object.keys(pendingBefore ?? {})).toEqual(["s-e"]);
    expect(pendingAfter ?? {}).toEqual({});
    const again = await call("rate_recall", { session_id: sid, scene_id: "s-e", grade: "good" });
    expect(parse(again).error).toMatch(/no self-rating was requested for scene "s-e"/);
  });

  it("plays a review once a concept falls due, and says when the next one falls before that (SL-2)", async () => {
    const bundlesRoot = tmp();
    write(bundlesRoot, "A.json", lesson("lesson-A", [quiz("s-q", "c-signe")]));
    const { clock, set } = movableClock(T0);
    const { call } = await connect({ bundlesRoot, clock });
    const a = parse(await call("start_lesson_session", { bundle_ref: "A.json", learner_id: "ana" }));
    const done = parse(await call("submit_response", { session_id: a.session_id, input: { kind: "quiz_choice", choiceId: idOf(a.presentation) } }));
    expect(done.transition.review_plan.concepts).toEqual(["c-signe"]);

    const early = parse(await call("start_review_session", { learner_id: "ana" }));
    expect(early).toMatchObject({ status: "nothing_due", next_review_at: done.transition.review_plan.next_due_at });
    const planNow = parse(await call("get_study_plan", { learner_id: "ana" }));
    expect(planNow.next_step).toMatchObject({ action: "wait", tool: null });
    expect(planNow.next_review_date).toBe(early.next_review_date);

    set(T0 + 7 * DAY);
    const plan = parse(await call("get_study_plan", { learner_id: "ana" }));
    expect(plan.next_step).toMatchObject({ action: "review", tool: "start_review_session", arguments: { learner_id: "ana" } });
    expect(plan.due_reviews).toEqual([expect.objectContaining({ concept_id: "c-signe", lesson: { bundle_ref: "A.json", title: "Leçon lesson-A" } })]);

    const reviewRes = await call("start_review_session", { learner_id: "ana" });
    const review = parse(reviewRes);
    expect(review).toMatchObject({ status: "started", review: { items: [{ concept_id: "c-signe", scene_id: "r1:s-q" }] } });
    // Test decision (walkthrough 2026-11-07): the step is said once, in the status line.
    expect(review.presentation.display_markdown).toMatch(/`[^`]*étape 1\/1[^`]*`$/);
    expect(review.presentation.display_markdown).not.toContain("Révision 1 sur 1");
    for (const secret of ["BRAVO-RÉVÉLÉ", "\"correct\""]) expect(errorText(reviewRes)).not.toContain(secret);
    const graded = parse(await call("submit_response", {
      session_id: review.session_id, input: { kind: "reply", text: idOf(review.presentation) },
    }));
    expect(graded.transition).toMatchObject({ kind: "complete", verdict: { correct: true } });
    expect(parse(await call("start_review_session", { learner_id: "ana" })).status).toBe("nothing_due");
  });

  it("get_next_reinforcement tells a concept graded weak (relearn) from one only self-rated (unmeasured, I-3)", async () => {
    const bundlesRoot = tmp();
    write(bundlesRoot, "W.json", lesson("lesson-W", [explainBack("s-e", "c-self"), quiz("s-q", "c-weak")]));
    const { clock } = movableClock(T0);
    const { call } = await connect({ bundlesRoot, clock });
    const started = parse(await call("start_lesson_session", { bundle_ref: "W.json", learner_id: "ana" }));
    const sid = started.session_id;
    const explained = parse(await call("submit_response", { session_id: sid, input: { kind: "reply", text: "Le signe change." } }));
    await call("rate_recall", { session_id: sid, scene_id: explained.transition.self_rating.scene_id, grade: "good" });
    const quizScene = explained.transition.presentation;
    await call("submit_response", { session_id: sid, input: { kind: "quiz_choice", choiceId: idOf(quizScene, "Faux") } });

    const later = parse(await call("get_next_reinforcement", { learner_id: "ana", now_ms: T0 + 60 * DAY }));
    expect(later.relearn.map((t: { concept_id: string }) => t.concept_id)).toEqual(["c-weak"]);
    expect(later.unmeasured.map((t: { concept_id: string }) => t.concept_id)).toEqual(["c-self"]);
    const plan = parse(await call("get_study_plan", { learner_id: "ana", now_ms: T0 + 60 * DAY }));
    expect(plan.display_markdown).toContain("**À reprendre**\n\n- Notion c-weak");
    expect(plan.display_markdown).toContain("**À revoir**\n\n- Notion c-self");
  });

  it("list_lessons sees a lesson written into the library after the server started", async () => {
    const root = tmp();
    const library = join(root, "library");
    mkdirSync(library);
    const { call } = await connect({ bundlesRoot: library, libraryRoot: library });
    expect(parse(await call("list_lessons")).lessons).toEqual([]);
    const plan = parse(await call("get_study_plan"));
    expect(plan.next_step).toMatchObject({ action: "author", tool: "get_authoring_guide" });

    write(library, "orbitales/lesson.json", lesson("orbitales", [quiz("s-q", "c-signe")], "Les orbitales"));
    const listed = parse(await call("list_lessons", { query: "orbitales", learner_id: "ana" }));
    expect(listed.lessons).toEqual([expect.objectContaining({
      bundle_ref: "orbitales/lesson.json", title: "Les orbitales", source: "library",
      status: { state: "new", scenes_completed: 0, total_scenes: 1 },
    })]);
    const started = parse(await call("start_lesson_session", { bundle_ref: "orbitales/lesson.json", learner_id: "ana" }));
    expect(started.presentation.scene.id).toBe("s-q");
    const escape = await call("start_lesson_session", { bundle_ref: "../outside.json" });
    expect(parse(escape).error).toMatch(/escapes bundles root/);
  });

  it("export_concept_map writes the record of the session under the library, with no key ahead of the answer", async () => {
    const root = tmp();
    const library = join(root, "library");
    write(library, "signes/lesson.json", lesson("signes", [
      quiz("s-q", "c-signe", { evidence: EVIDENCE }), explainBack("s-e", "c-phase"),
    ], "Les signes"));
    const { call } = await connect({ bundlesRoot: library, libraryRoot: library });
    const started = parse(await call("start_lesson_session", { bundle_ref: "signes/lesson.json", learner_id: "ana" }));

    const before = parse(await call("export_concept_map", { session_id: started.session_id }));
    expect(before.record.schema).toBe("studium/concept-map-record/v1");
    expect(before.saved_to).toBe(join(library, "_exports", "concept-maps", readdirSync(join(library, "_exports", "concept-maps"))[0]!));
    expect(before.sha256).toBe(createHash("sha256").update(readFileSync(before.saved_to)).digest("hex"));
    expect(before.display_markdown).toContain(before.saved_to);
    expect(before.record.scenes[0]).toMatchObject({
      scene_id: "s-q", key_class: "author_keyed", served: false, passages_released: false,
      sources: [{ title: "Atkins, Chimie physique", origin: "web", url: "https://example.org/atkins" }],
    });
    const wire = JSON.stringify(before);
    for (const secret of ["PASSAGE-QUI-RÉPOND", "BRAVO-RÉVÉLÉ", "POINT-CLÉ-SECRET", "MODÈLE-SECRET", "ana"]) expect(wire).not.toContain(secret);

    await call("submit_response", { session_id: started.session_id, input: { kind: "quiz_choice", choiceId: idOf(started.presentation), confidence: 3 } });
    const after = parse(await call("export_concept_map", { session_id: started.session_id }));
    expect(after.record.scenes[0].sources[0].quote).toBe("PASSAGE-QUI-RÉPOND");
    expect(after.record.path).toEqual([expect.objectContaining({ step: 1, scene_id: "s-q", correct: true, assessed_by: "key" })]);
    expect(JSON.stringify(after)).not.toContain("MODÈLE-SECRET");

    const single = join(root, "single");
    write(single, "un/lesson.json", lesson("un", [quiz("s-q", "c-signe")]));
    const other = await connect({ bundlesRoot: single });
    const one = parse(await other.call("start_lesson_session", { bundle_ref: "un/lesson.json" }));
    expect(errorText(await other.call("export_concept_map", { session_id: one.session_id }))).toMatch(/no concept map/);
  });
});
