// apps/lesson-mcp/src/learn-and-review.e2e.test.ts
//
// R1 and R2 of the 2026-10-30 production sprint, end to end through the REAL server: the host of the
// stdio entry point (hostFromEnvironment, with the C6 defaults under a temporary STUDIUM_HOME, never
// the developer's home) and the real buildMcpServer, over an in-memory MCP transport.
//
// The test plays the harness. It follows the server's instructions (start with get_study_plan), each
// next_step and the tool descriptions; the authoring guide's own example source stands for the text a
// harness fetched, and its example draft for the draft an agent writes; every answer goes in as the
// learner's words through {kind: "reply", text}.
//
//   R1  « learn X » leads to a first question in at most 6 Studium tool calls once the harness has the
//       sources.
//   R2  one get_study_plan, then start_review_session plays the reviews due a week later, across a
//       server restart: the state is durable by default.
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { hostFromEnvironment } from "./index.js";
import { buildMcpServer } from "./server.js";

const DAY = 86_400_000;
const LEARNER = "ada";
const READING_SCENES = new Set(["intro", "concept"]);

const home = mkdtempSync(join(tmpdir(), "studium-e2e-home-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));
/** What a harness's MCP configuration would set: only STUDIUM_HOME, so every other C6 default applies. */
const ENV = { STUDIUM_HOME: home };

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
type Json = Record<string, any>;

/** A server started the way `studium-mcp` starts it, and a client that records every Studium call. */
async function startServer() {
  const { host, config } = hostFromEnvironment(ENV, "/nonexistent-home");
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "e2e-harness", version: "1.0.0" });
  await client.connect(clientT);
  const calls: string[] = [];
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Json> => {
    calls.push(name);
    const result = await client.callTool({ name, arguments: args }) as Result;
    const body = JSON.parse(result.content[0]?.text ?? "null") as Json;
    if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(body)}`);
    return body;
  };
  return { client, call, calls, config, close: () => client.close() };
}

/** A displayed choice id: choices are reshuffled and relettered per session. */
const idOf = (scene: Json, text: string): string => scene.choices.find((c: Json) => c.text === text).id;

/** The learner's words for the scene on screen, as a chat would carry them. */
function learnerReply(scene: Json, correctChoice: string): string {
  if (scene.type === "quiz") return idOf(scene, correctChoice);
  if (READING_SCENES.has(scene.type)) return "continuer";
  return "La chaleur du soleil fait s'évaporer l'eau ; la vapeur se refroidit, se condense en nuages, puis l'eau retombe en pluie et rejoint la mer.";
}

describe("learn X, then review a week later, through the real MCP server (R1, R2)", () => {
  let firstQuestionAt = 0;
  let courseRef = "";
  let correctChoice = "";
  let conceptId = "";
  const answeredAt = Date.now();

  it("R1: from « learn X » to the first question in at most 6 Studium calls, then plays the lesson", async () => {
    const { call, calls, config, close } = await startServer();
    expect(config).toMatchObject({ home, libraryRoot: join(home, "library"), bundlesRoot: join(home, "library"), dataDir: join(home, "data") });

    // 1. The instructions say: start with get_study_plan. Nothing exists yet, so the next step is to author.
    const plan = await call("get_study_plan", { learner_id: LEARNER });
    expect(plan.next_step).toMatchObject({ action: "author", tool: "get_authoring_guide" });

    // 2. The brief, the draft's JSON Schema and a worked example.
    const guide = await call(plan.next_step.tool, { language: "fr" });
    expect(guide.draft_schema).toBeTypeOf("object");
    const { source, draft } = guide.example;
    conceptId = draft.concepts[0].id;
    correctChoice = draft.scenes.find((s: Json) => s.type === "quiz").choices.find((c: Json) => c.correct).text;

    // 3. The harness fetched its sources (here the guide's example source); Studium cuts them into passages.
    const prepared = await call("prepare_sources", { sources: [source], goal: draft.goal, language: "fr" });
    const passageIds = new Set(prepared.passages.map((p: Json) => p.id));
    for (const scene of draft.scenes) for (const quote of scene.quotes ?? []) expect(passageIds).toContain(quote.passage_id);

    // 4. A complete draft becomes a lesson in the learner's library; the reply holds no key.
    const created = await call("create_lesson", { source_set_id: prepared.source_set_id, draft });
    expect(created).toMatchObject({ ok: true });
    courseRef = created.course_ref;
    expect(existsSync(join(home, "library", courseRef))).toBe(true);
    const createdJson = JSON.stringify(created);
    expect(createdJson).not.toContain(correctChoice);
    for (const scene of draft.scenes) {
      for (const point of scene.key_points ?? []) expect(createdJson).not.toContain(point.text);
      if (scene.model_explanation) expect(createdJson).not.toContain(scene.model_explanation);
    }

    // On the side (not a call the harness needs: create_lesson returned course_ref and names the next
    // call): the lesson written a moment ago is listed at once, by the same server, without a restart.
    const listed = await call("list_lessons", { learner_id: LEARNER });
    calls.pop();
    expect(listed.lessons.map((l: Json) => l.bundle_ref)).toContain(courseRef);
    expect(listed.lessons.find((l: Json) => l.bundle_ref === courseRef)).toMatchObject({ status: { state: "new" } });

    // 5. start_lesson_session {bundle_ref: course_ref}, as create_lesson's description says.
    const started = await call("start_lesson_session", { bundle_ref: courseRef, learner_id: LEARNER });
    expect(started.persistence).toMatchObject({ durable: true, data_dir: join(home, "data"), library_root: join(home, "library") });
    expect(started.authoring).toMatchObject({ mode: "self_study", validated: false });
    // L-5: learner-facing French consistently uses tu.
    expect(started.authoring.notice).toMatch(/^Leçon rédigée par l'IA à partir de tes sources/);
    const sessionId = started.session_id as string;
    let presentation = started.presentation as Json;
    expect(presentation.display_markdown).toBeTypeOf("string");

    // 6. A reading screen is acknowledged in the learner's words until the first question is on screen.
    while (READING_SCENES.has(presentation.scene.type)) {
      const { transition } = await call("submit_response", { session_id: sessionId, input: { kind: "reply", text: "continuer" } });
      presentation = transition.presentation;
    }
    firstQuestionAt = calls.length;
    expect(calls).toEqual(["get_study_plan", "get_authoring_guide", "prepare_sources", "create_lesson", "start_lesson_session",
      ...Array(firstQuestionAt - 5).fill("submit_response")]);
    expect(firstQuestionAt).toBeLessThanOrEqual(6);
    // Nothing earned is on screen before the answer.
    const onScreen = JSON.stringify(presentation);
    for (const scene of draft.scenes) for (const point of scene.key_points ?? []) expect(onScreen).not.toContain(point.text);
    expect(onScreen).not.toContain('"correct"');

    // The rest of the lesson, in the learner's words; each production answer no judge assessed asks
    // the learner to rate their recall (C4), which rate_recall records without moving mastery.
    let rated = 0;
    for (let guard = 0; guard < 20; guard += 1) {
      const scene = presentation.scene as Json;
      const { transition } = await call("submit_response", {
        session_id: sessionId, input: { kind: "reply", text: learnerReply(scene, correctChoice) },
      });
      if (!READING_SCENES.has(scene.type)) {
        expect(transition.verdict).toMatchObject({ scene_id: scene.id, graded: true });
        expect(transition.verdict.display_markdown).toBeTypeOf("string");
      }
      if (transition.self_rating?.requested) {
        const before = (await call("get_session_state", { session_id: sessionId })).state.concept_states;
        const recall = await call("rate_recall", { session_id: sessionId, scene_id: transition.self_rating.scene_id, grade: "good" });
        expect(recall).toMatchObject({ scene_id: scene.id, grade: "good", source: "self_rated" });
        expect(recall.next_review_at).toBeGreaterThan(answeredAt);
        expect((await call("get_session_state", { session_id: sessionId })).state.concept_states).toEqual(before);
        rated += 1;
      }
      if (transition.kind === "complete") break;
      presentation = transition.presentation;
    }
    expect(rated).toBeGreaterThan(0);

    // Right after the lesson nothing is due yet: the plan says when the next review falls.
    const after = await call("get_study_plan", { learner_id: LEARNER });
    expect(after.due_reviews).toEqual([]);
    expect(after.next_review_at).toBeGreaterThan(answeredAt);
    await close();
  });

  it("R2: after a restart, one get_study_plan a week later, then start_review_session plays the review", async () => {
    expect(courseRef).not.toBe("");
    // A new server process: the same environment, so the same library and data folder.
    const { call, close } = await startServer();
    const weekLater = answeredAt + 7 * DAY;

    const plan = await call("get_study_plan", { learner_id: LEARNER, now_ms: weekLater });
    const listedReviews = [...plan.due_reviews, ...(plan.relearn ?? []), ...(plan.unmeasured_reviews ?? [])];
    expect(listedReviews.map((item: Json) => item.concept_id)).toContain(conceptId);
    expect(listedReviews.find((item: Json) => item.concept_id === conceptId)).toMatchObject({
      playable: true, lesson: { bundle_ref: courseRef },
    });
    expect(plan.next_step).toMatchObject({ action: "review", tool: "start_review_session" });

    const review = await call(plan.next_step.tool, { ...plan.next_step.arguments, learner_id: LEARNER, now_ms: weekLater });
    expect(review.status).toBe("started");
    expect(review.review.items.map((item: Json) => item.concept_id)).toContain(conceptId);
    const scene = review.presentation.scene as Json;
    expect(["quiz", "explain_back"]).toContain(scene.type);
    expect(JSON.stringify(review.presentation)).not.toContain('"correct"');

    const { transition } = await call("submit_response", {
      session_id: review.session_id, input: { kind: "reply", text: learnerReply(scene, correctChoice) },
    });
    expect(transition.verdict).toMatchObject({ scene_id: scene.id, graded: true });
    if (transition.self_rating?.requested) {
      await call("rate_recall", { session_id: review.session_id, scene_id: transition.self_rating.scene_id, grade: "good" });
    }
    await close();
  });

  it("wrote nothing outside the temporary STUDIUM_HOME, and kept the learner's data under a pseudonym", () => {
    expect(readdirSync(home).sort()).toEqual(["data", "library"]);
    // L-11 keeps lock/generation metadata outside erasable learner folders; both use pseudonyms.
    const learnerDirs = readdirSync(join(home, "data")).filter((name) =>
      name !== ".learner-locks" && statSync(join(home, "data", name)).isDirectory());
    expect(learnerDirs.length).toBeGreaterThan(0);
    for (const dir of learnerDirs) expect(dir).toMatch(/^[0-9a-f]{16}$/);
    for (const dir of readdirSync(join(home, "data", ".learner-locks"))) expect(dir).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(readdirSync(join(home, "data"), { recursive: true }))).not.toContain(LEARNER);
  });
});
