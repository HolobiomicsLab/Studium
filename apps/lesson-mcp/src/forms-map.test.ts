// The concept map and contest in play_in_forms (INT-STUDIUM-058 lot 4): a real MCP client drives
// fixtures/atomistique-l1 as a labelled synthetic learner. The client answers every elicitation as
// the learner; no test chooses or contests on behalf of a real learner.
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema, type ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

const FIXTURES = resolve("../../fixtures");
const ATOMS = "atomistique-l1/lesson.json";
const T0 = Date.parse("2026-11-01T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
type Json = Record<string, unknown>;
type FormProperty = { type?: string; title?: string; enum?: unknown[]; [key: string]: unknown };
type Form = { message: string; requestedSchema: { properties: Record<string, FormProperty>; required?: string[] } };
type Responder = (form: Form, index: number) => ElicitResult | Promise<ElicitResult>;
const authored = JSON.parse(readFileSync(resolve(FIXTURES, ATOMS), "utf8")) as {
  scenes: Array<{ id: string; question?: string; choices?: Array<{ text: string; correct: boolean }> }>;
};
const contestableLesson = {
  schema_version: "1.4", bundle_id: "forms-contestable", source_plan_id: "p",
  metadata: { title: "Carte en formulaires", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
  concepts: [
    { id: "c1", title: "Notion c1", description: "d", bloom_level_target: "understand" },
    { id: "c2", title: "Notion c2", description: "d", bloom_level_target: "understand" },
  ],
  scenes: [
    {
      id: "q1", type: "quiz", title: "Question", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 30,
      adaptation_hooks: [], question: "Question de rappel ?",
      choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
      feedback_correct: "Oui", feedback_incorrect: "Non", hints: [],
    },
  ],
  rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
};

const dirs: string[] = [];
const temporary = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const accept = (content: Record<string, string | number | boolean> = {}): ElicitResult => ({ action: "accept", content });
const decline = (): ElicitResult => ({ action: "decline" });
const cancel = (): ElicitResult => ({ action: "cancel" });

function regexEscape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Choose by the authored text, never by a memorised displayed id (the host may shuffle choices). */
function correctAnswer(form: Form): ElicitResult {
  const scene = authored.scenes.find((candidate) => candidate.question && form.message.includes(candidate.question));
  const answer = scene?.choices?.find((choice) => choice.correct)?.text;
  if (!answer) throw new Error(`no authored answer found for form: ${form.message.slice(0, 80)}`);
  const displayed = form.message.match(new RegExp(`\\*\\*([a-z])\\)\\*\\* ${regexEscape(answer)}`))?.[1];
  if (!displayed) throw new Error(`correct displayed choice not found for ${scene?.id}`);
  return accept({ choice: displayed, confidence: 3 });
}

/** Play the fixture through the host until `sceneId` is on screen, answering each scene generically.
 * Used only to reach a served concept before the forms are opened. */
async function reach(host: SessionHost, sessionId: string, sceneId: string): Promise<void> {
  for (let step = 0; step < 40; step += 1) {
    const scene = host.currentPresentation(sessionId).scene as { id: string; type: string; choices?: Array<{ id: string; text: string }> };
    if (scene.id === sceneId) return;
    if (scene.type === "quiz") await host.respond(sessionId, { kind: "quiz_choice", choiceId: scene.choices![0]!.id });
    else if (scene.type === "summary_audit") await host.respond(sessionId, { kind: "reply", text: "Le résumé omet les isotopes." });
    else if (scene.type === "intro" || scene.type === "concept") await host.respond(sessionId, { kind: "ack" });
    else throw new Error(`reach: ${scene.type} scene ${scene.id} needs a specific answer`);
  }
  throw new Error(`reach: ${sceneId} was not served`);
}

async function connect(host: SessionHost, responder: Responder) {
  const server = buildMcpServer(host);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "forms-map-test", version: "1" }, { capabilities: { elicitation: {} } });
  const forms: Form[] = [];
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    const form = request.params as unknown as Form;
    forms.push(form);
    return responder(form, forms.length - 1);
  });
  await client.connect(clientTransport);
  const raw = (name: string, args: Json) => client.callTool({ name, arguments: args }) as Promise<{
    isError?: boolean; structuredContent?: Json; content: Array<{ text?: string }>;
  }>;
  const call = async (name: string, args: Json): Promise<Json> => {
    const result = await raw(name, args);
    if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
    return result.structuredContent ?? JSON.parse(result.content[0]!.text!);
  };
  return { call, forms, close: async () => { await client.close(); await server.close(); } };
}

function interactionEvents(dataDir: string): Json[] {
  const files = (readdirSync(dataDir, { recursive: true }) as string[]).map(String).filter((file) => file.endsWith("telemetry.jsonl"));
  return files.flatMap((file) => readFileSync(join(dataDir, file), "utf8").trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as Json)).filter((event) => event["type"] === "interaction");
}

function contestableHost(dataDir: string | null = null) {
  const root = temporary("mcp-forms-contestable-");
  const ref = "contestable/lesson.json";
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(contestableLesson));
  return { host: new SessionHost({ bundlesRoot: root, live: false, dataDir }), ref };
}

describe("the concept map in play_in_forms", () => {
  it("opens the map from a scene form and returns to the untouched scene after an empty map form; no upcoming concept is contestable", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null });
    const answers = [accept({ map: true }), accept(), decline()];
    const test = await connect(host, async () => answers.shift() ?? cancel());
    try {
      const started = await test.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-forms-map-open" });
      const result = await test.call("play_in_forms", { session_id: started.session_id });

      expect(test.forms).toHaveLength(3);
      expect(test.forms[0]!.requestedSchema.properties.map).toEqual({
        type: "boolean", title: "Voir la carte des notions",
      });
      expect(test.forms[1]!.message).toContain("Carte des notions — là où tu en es.");
      expect(test.forms[1]!.message).toContain("Nombres quantiques (`c-nombres-quantiques`)");
      // Nothing is contestable on the first screen: the map form only returns to the scene.
      expect(test.forms[1]!.requestedSchema.properties).not.toHaveProperty("contest_concept");
      expect(test.forms[1]!.requestedSchema.properties).not.toHaveProperty("claim");
      expect(host.conceptMap(started.session_id as string)!.nodes.every((node) => node.state === "upcoming")).toBe(true);
      expect(test.forms[1]!.requestedSchema.required).toBeUndefined();
      expect(test.forms[2]!.message).toContain("Chapitre 1 — Atomes et orbitales");
      expect(result).toMatchObject({
        status: "paused", steps: [{ scene_id: "s0-intro", scene_type: "map" }],
        presentation: { scene: { id: "s0-intro" } },
      });
    } finally { await test.close(); }
  }, 30_000);

  it("opens a contest, asks its two check questions, then resumes on the scene left for the map", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null });
    const test = await connect(host, (form, index) => {
      if (index === 0) return accept({ map: true });
      if (index === 1) return accept({ contest_concept: "c-nombres-quantiques", claim: "known" });
      if (index === 2 || index === 3) return correctAnswer(form);
      return decline();
    });
    try {
      const started = await test.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-forms-map-contest" });
      // Reach c-nombres-quantiques through the conversation; the forms open on its concept scene.
      const id = started.session_id as string;
      await reach(host, id, "s2-concept-nombres-quantiques");
      const result = await test.call("play_in_forms", { session_id: started.session_id });

      expect(test.forms).toHaveLength(5);
      expect(test.forms[2]!.message).toMatch(/^Contrôle sur «\u00a0Nombres quantiques\u00a0»\u00a0: 2 questions\./);
      expect(test.forms[2]!.message).toContain("contrôle 1/2");
      expect(test.forms[4]!.message).toContain("Les nombres quantiques");
      expect(result.status).toBe("paused");
      const steps = result.steps as Json[];
      expect(steps.slice(0, 2)).toEqual([
        { scene_id: "s2-concept-nombres-quantiques", scene_type: "map" },
        { scene_id: "s2-concept-nombres-quantiques", scene_type: "contest", concept_id: "c-nombres-quantiques", claim: "known" },
      ]);
      expect(steps.slice(2).map((step) => step.scene_id)).toEqual(["s2-quiz-4f", "s9-rappel-3d"]);
      const resumed = result.presentation as { scene: { id: string } };
      expect(resumed.scene.id).toBe("s2-concept-nombres-quantiques");
    } finally { await test.close(); }
  }, 30_000);

  it("offers only the concepts the session has shown in the map form's enum", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null });
    const answers = [accept({ map: true }), decline()];
    const test = await connect(host, async () => answers.shift() ?? cancel());
    try {
      const started = await test.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-forms-map-enum" });
      const id = started.session_id as string;
      await host.respond(id, { kind: "ack" });                       // c-particules is current
      const result = await test.call("play_in_forms", { session_id: id, max_steps: 1 });
      expect(result.status).toBe("paused");
      const mapForm = test.forms.find((form) => form.requestedSchema.properties.contest_concept)!;
      const map = host.conceptMap(id)!;
      const upcoming = map.nodes.filter((node) => node.state === "upcoming").map((node) => node.id);
      const contestable = map.nodes.filter((node) => node.state !== "upcoming").map((node) => node.id);
      expect(upcoming.length).toBeGreaterThan(0);
      expect(mapForm.requestedSchema.properties.contest_concept!.enum).toEqual(contestable);
      for (const id of upcoming) expect(mapForm.requestedSchema.properties.contest_concept!.enum).not.toContain(id);
    } finally { await test.close(); }
  }, 30_000);

  it("keeps the map open when either half of a contest declaration is missing", async () => {
    for (const partial of [{ claim: "known" }, { contest_concept: "c-nombres-quantiques" }]) {
      const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null });
      const answers = [accept({ map: true }), accept(partial), decline(), decline()];
      const test = await connect(host, async () => answers.shift() ?? cancel());
      try {
        const started = await test.call("start_lesson_session", {
          bundle_ref: ATOMS, learner_id: `synthetic-forms-map-incomplete-${Object.keys(partial)[0]}`,
        });
        const result = await test.call("play_in_forms", { session_id: started.session_id });
        expect(test.forms).toHaveLength(3);
        expect(test.forms[2]!.message).toMatch(/^Choisis une notion et une déclaration pour contester\./);
        expect(test.forms[2]!.message).toContain("Nombres quantiques (`c-nombres-quantiques`)");
        // The first screen has shown no concept: there is nothing to choose, so the map form has no fields.
        expect(test.forms[2]!.requestedSchema.properties).toEqual({});
        expect(result).toMatchObject({ status: "paused", steps: [{ scene_id: "s0-intro", scene_type: "map" }] });
      } finally { await test.close(); }
    }
  }, 30_000);

  it("shows a host refusal on the map form instead of throwing it", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null });
    const answers = [
      accept({ map: true }),
      accept({ contest_concept: "c-nombres-quantiques", claim: "unsure" }),
      decline(),
    ];
    const test = await connect(host, async () => answers.shift() ?? cancel());
    try {
      const started = await test.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-forms-map-refusal" });
      const result = await test.call("play_in_forms", { session_id: started.session_id });
      expect(test.forms[2]!.message).toMatch(/^"c-nombres-quantiques" has not been shown yet: contest it once the session reaches it/);
      expect(test.forms[2]!.message).toContain("Carte des notions — là où tu en es.");
      expect(result.steps).toEqual([{ scene_id: "s0-intro", scene_type: "map" }]);
    } finally { await test.close(); }
  }, 30_000);

  it("logs one fast rank-2 openMap act and one fast rank-2 contest act", async () => {
    const dataDir = temporary("mcp-forms-map-events-");
    const previous = process.env["STUDIUM_TELEMETRY_CONSENT"];
    process.env["STUDIUM_TELEMETRY_CONSENT"] = "granted";
    try {
      const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir });
      const answers = [accept({ map: true }), accept({ contest_concept: "c-particules", claim: "known" })];
      const test = await connect(host, async () => answers.shift() ?? cancel());
      try {
        const started = await test.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-forms-map-events" });
        await reach(host, started.session_id as string, "s1-concept-particules");
        const result = await test.call("play_in_forms", { session_id: started.session_id });
        expect(result.status).toBe("paused");
        await test.call("end_session", { session_id: started.session_id });
      } finally { await test.close(); }
    } finally {
      if (previous === undefined) delete process.env["STUDIUM_TELEMETRY_CONSENT"];
      else process.env["STUDIUM_TELEMETRY_CONSENT"] = previous;
    }

    const relevant = interactionEvents(dataDir).filter((event) => event["act"] === "openMap" || event["act"] === "contest");
    expect(relevant).toHaveLength(2);
    expect(relevant.map(({ act, lane, surface_rank, scene_id }) => ({ act, lane, surface_rank, scene_id }))).toEqual([
      { act: "openMap", lane: "fast", surface_rank: 2, scene_id: "s1-concept-particules" },
      { act: "contest", lane: "fast", surface_rank: 2, scene_id: "s1-concept-particules" },
    ]);
  }, 30_000);

  it("does not offer the map field in a review session", async () => {
    const root = temporary("mcp-forms-map-review-");
    const ref = "review/lesson.json";
    mkdirSync(dirname(join(root, ref)), { recursive: true });
    writeFileSync(join(root, ref), JSON.stringify({
      schema_version: "1.4", bundle_id: "forms-review", source_plan_id: "p",
      metadata: { title: "Révision formulaires", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
      concepts: [
        { id: "c1", title: "Notion c1", description: "d", bloom_level_target: "understand" },
        { id: "c2", title: "Notion c2", description: "d", bloom_level_target: "understand" },
      ],
      scenes: [
        {
          id: "q1", type: "quiz", title: "Question", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 30,
          adaptation_hooks: [], question: "Question de rappel ?",
          choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
          feedback_correct: "Oui", feedback_incorrect: "Non", hints: [],
        },
        {
          id: "c2", type: "concept", title: "Deuxième notion", objective_refs: [], concept_refs: ["c2"], estimated_seconds: 30,
          adaptation_hooks: [], markdown: "Deuxième notion.",
        },
      ],
      rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
    }));
    const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
    const learned = await host.create(ref, "synthetic-forms-map-review", { nowMs: T0 });
    // The ordinary lesson has two concepts, so its form offers the map. The same host's review below
    // must not: the absence is a review-session rule, not an accident of a one-concept fixture.
    const lessonTest = await connect(host, async () => decline());
    try {
      const result = await lessonTest.call("play_in_forms", { session_id: learned.sessionId, max_steps: 1 });
      expect(result.status).toBe("paused");
      expect(lessonTest.forms[0]!.requestedSchema.properties).toHaveProperty("map");
    } finally { await lessonTest.close(); }
    const first = learned.presentation.scene as Json;
    const correct = (first.choices as Array<{ id: string; text: string }>).find((choice) => choice.text === "Juste")!.id;
    const next = await host.respond(learned.sessionId, { kind: "quiz_choice", choiceId: correct });
    const nextPresentation = Reflect.get(next, "presentation") as { scene: { id: string } } | undefined;
    expect(nextPresentation?.scene.id).toBe("c2");
    await host.respond(learned.sessionId, { kind: "ack" });
    const review = await host.startReview("synthetic-forms-map-review", { nowMs: T0 + 60 * DAY });
    if (review.status !== "started") throw new Error(`expected a review, got ${review.status}`);
    expect(host.conceptMap(review.sessionId)).toBeNull();

    const test = await connect(host, async () => decline());
    try {
      const result = await test.call("play_in_forms", { session_id: review.sessionId, max_steps: 1 });
      expect(result.status).toBe("paused");
      expect(test.forms).toHaveLength(1);
      expect(test.forms[0]!.requestedSchema.properties).toHaveProperty("choice");
      expect(test.forms[0]!.requestedSchema.properties).not.toHaveProperty("map");
    } finally { await test.close(); }
  }, 30_000);

  it("serves a contest check question after a quiz answer opens the map", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null });
    const test = await connect(host, (form, index) => {
      if (index < 2) return accept();
      if (index === 2) {
        const answer = correctAnswer(form);
        return accept({ ...answer.content, map: true });
      }
      if (index === 3) return accept({ contest_concept: "c-particules", claim: "known" });
      return decline();
    });
    try {
      const started = await test.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-forms-map-answer-contest" });
      const result = await test.call("play_in_forms", { session_id: started.session_id });
      expect(test.forms).toHaveLength(5);
      expect(test.forms[4]!.message).toContain("contrôle 1/");
      expect(test.forms[4]!.requestedSchema.properties).toHaveProperty("choice");
      expect(result.status).toBe("paused");
    } finally { await test.close(); }
  }, 30_000);

  it("re-shows a quiz with a localized hint when accepted without a choice or map", async () => {
    const dataDir = temporary("mcp-forms-map-missing-choice-events-");
    const previous = process.env["STUDIUM_TELEMETRY_CONSENT"];
    process.env["STUDIUM_TELEMETRY_CONSENT"] = "granted";
    try {
      const { host, ref } = contestableHost(dataDir);
      const answers = [accept(), accept({ choice: "a" }), decline()];
      const test = await connect(host, async () => answers.shift() ?? cancel());
      try {
        const started = await test.call("start_lesson_session", { bundle_ref: ref, learner_id: "synthetic-forms-map-missing-choice" });
        const result = await test.call("play_in_forms", { session_id: started.session_id });
        expect(test.forms).toHaveLength(2);
        expect(test.forms[1]!.message).toMatch(/^Choisis une réponse, ou ouvre la carte\./);
        expect(test.forms[1]!.message).toContain("Question de rappel ?");
        expect(result.steps).toEqual([{ scene_id: "q1", scene_type: "quiz", correct: true }]);
        expect(result.status).toBe("complete");
        await test.call("end_session", { session_id: started.session_id });
      } finally { await test.close(); }
    } finally {
      if (previous === undefined) delete process.env["STUDIUM_TELEMETRY_CONSENT"];
      else process.env["STUDIUM_TELEMETRY_CONSENT"] = previous;
    }
    expect(interactionEvents(dataDir).filter((event) => event["act"] === "respond")).toHaveLength(1);
  }, 30_000);

  it("settles a quiz choice before opening its map and logs one respond act", async () => {
    const dataDir = temporary("mcp-forms-map-answer-events-");
    const previous = process.env["STUDIUM_TELEMETRY_CONSENT"];
    process.env["STUDIUM_TELEMETRY_CONSENT"] = "granted";
    try {
      const { host, ref } = contestableHost(dataDir);
      const answers = [accept({ choice: "a", map: true }), accept(), decline()];
      const test = await connect(host, async () => answers.shift() ?? cancel());
      try {
        const started = await test.call("start_lesson_session", { bundle_ref: ref, learner_id: "synthetic-forms-map-answer-events" });
        const result = await test.call("play_in_forms", { session_id: started.session_id });
        expect(test.forms[1]!.message).toMatch(/^✓ \*\*Juste\.\*\*/);
        expect(test.forms[1]!.message).toContain("Carte des notions — là où tu en es.");
        expect(result.steps).toEqual([
          { scene_id: "q1", scene_type: "quiz", correct: true },
          { scene_id: "q1", scene_type: "map" },
        ]);
        await test.call("end_session", { session_id: started.session_id });
      } finally { await test.close(); }
    } finally {
      if (previous === undefined) delete process.env["STUDIUM_TELEMETRY_CONSENT"];
      else process.env["STUDIUM_TELEMETRY_CONSENT"] = previous;
    }
    expect(interactionEvents(dataDir).filter((event) => event["act"] === "respond")).toHaveLength(1);
  }, 30_000);
});
