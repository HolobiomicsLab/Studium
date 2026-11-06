// get_companion_brief (INT-STUDIUM-058 § 2.5): what the learner did since the agent last looked.
//
// A real MCP client plays lessons of fixtures/ on both lanes (panel_action and play_in_forms are the
// fast lane, the conversation tools are the companion lane) and reads the brief.
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";
import { COMPANION_TOOL_NAMES } from "./companion-tools.js";

const FIXTURES = resolve("../../fixtures");
const ATOMS = "atomistique-l1/lesson.json";
const JUDGMENT = "capsule-judgment-demo/lesson.json";
type Json = Record<string, any>;

/** A client of the real server; with `forms` it shows forms and accepts each one as it comes. */
async function connect(options: { forms?: boolean } = {}) {
  const server = buildMcpServer(new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null }));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "companion-test", version: "1" }, { capabilities: options.forms ? { elicitation: {} } : {} });
  if (options.forms) client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: {} }));
  await client.connect(clientT);
  const raw = async (name: string, args: Json) => await client.callTool({ name, arguments: args }) as {
    isError?: boolean; structuredContent?: Json; content: Array<{ type: string; text?: string }>;
  };
  const call = async (name: string, args: Json): Promise<Json> => {
    const result = await raw(name, args);
    if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
    return result.structuredContent ?? JSON.parse(result.content[0]!.text!);
  };
  const panel = async (name: string, args: Json): Promise<Json> => (await call(name, args)).panel;
  const act = (session_id: string, action: Json) => panel("panel_action", { session_id, action });
  const brief = async (session_id: string): Promise<Json> => (await call("get_companion_brief", { session_id })).brief;
  return { client, server, raw, call, panel, act, brief, close: async () => { await client.close(); await server.close(); } };
}

const ACK = { type: "respond", input: { kind: "ack" } };

describe("get_companion_brief", () => {
  it("is the fortieth tool, and the only one this lane adds", async () => {
    const t = await connect();
    try {
      const names = (await t.client.listTools()).tools.map((tool) => tool.name);
      expect(names).toHaveLength(40);
      expect(names).toContain("get_companion_brief");
      expect([...COMPANION_TOOL_NAMES]).toEqual(["get_companion_brief"]);
      const unknown = await t.raw("get_companion_brief", { session_id: "absent" });
      expect(unknown.isError).toBe(true);
    } finally { await t.close(); }
  });

  it("lists the acts of the fast lane since the last look, then nothing new", async () => {
    const t = await connect();
    try {
      const opened = await t.panel("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "auto-companion-test" });
      const id = opened.session_id as string;
      const concept = await t.act(id, ACK);
      const quiz = await t.act(id, ACK);
      const choice = quiz.scene.choices[0].id as string;
      const after = await t.act(id, { type: "respond", input: { kind: "quiz_choice", choiceId: choice, confidence: 2 } });

      const brief = await t.brief(id);
      expect(brief.since_last).toEqual([
        { scene_id: opened.scene.id, act: "read", lane: "fast" },
        { scene_id: concept.scene.id, act: "read", lane: "fast" },
        { scene_id: quiz.scene.id, act: "answer", lane: "fast", correct: after.verdict.correct, confidence: 2 },
      ]);
      expect(brief).toMatchObject({ session_id: id, cursor: 3, since_last_count: 3, status_line: after.status_line, help: after.help });
      expect(brief.where).toEqual({
        lesson_title: after.lesson_title, step: after.orientation.step,
        scene: { id: after.scene.id, type: after.scene.type, title: after.scene.title }, waiting: after.orientation.waiting,
      });
      expect(brief.rules).toHaveLength(3);
      expect(brief.rules.join(" ")).toMatch(/réponse/);  // the lesson is in French, and so are the rules

      const again = await t.brief(id);
      expect(again).toMatchObject({ cursor: 3, since_last: [], since_last_count: 0, where: brief.where });
    } finally { await t.close(); }
  });

  it("says which lane each act came through: answers, hints and self-ratings", async () => {
    const t = await connect();
    try {
      // The first quiz of the lesson has one hint: asked on the panel, then asked again in the
      // conversation, where none is left (no hint given, no act). The answer goes through the conversation.
      const atoms = (await t.panel("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "auto-companion-test" })).session_id as string;
      await t.act(atoms, ACK);
      const quiz = await t.act(atoms, ACK);
      await t.brief(atoms);  // the agent looks: the two screens read are behind the cursor
      expect((await t.act(atoms, { type: "hint" })).hint.hint).toEqual(expect.any(String));
      expect((await t.call("request_hint", { session_id: atoms })).hint).toBeNull();
      const choice = { kind: "quiz_choice", choiceId: quiz.scene.choices[0].id, confidence: 3 };
      const answered = await t.call("submit_response", { session_id: atoms, input: choice });
      const brief = await t.brief(atoms);
      expect(brief.since_last).toEqual([
        { scene_id: quiz.scene.id, act: "hint", lane: "fast" },
        { scene_id: quiz.scene.id, act: "answer", lane: "companion", correct: answered.transition.verdict.correct, confidence: 3 },
      ]);
      expect(brief.cursor).toBe(4);

      // A hint asked in the conversation, by another learner on the same quiz.
      const other = (await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "auto-companion-test-2" })).session_id as string;
      for (const _ of [1, 2]) await t.call("submit_response", { session_id: other, input: { kind: "ack" } });
      expect((await t.call("request_hint", { session_id: other })).hint.hint).toEqual(expect.any(String));
      expect((await t.brief(other)).since_last.at(-1)).toEqual({ scene_id: quiz.scene.id, act: "hint", lane: "companion" });

      // Self-ratings: a written answer nobody assessed, in the conversation then on the panel.
      const judged = (await t.panel("open_lesson_panel", { bundle_ref: JUDGMENT, learner_id: "auto-companion-test" }));
      const id = judged.session_id as string;
      const first = await t.act(id, ACK);
      const written = await t.call("submit_response", { session_id: id, input: { kind: "reply", text: "Le texte confond deux notions." } });
      const rating = written.transition.self_rating.scene_id as string;
      await t.call("rate_recall", { session_id: id, scene_id: rating, grade: "good" });
      const second = (await t.panel("get_panel_view", { session_id: id }));
      const next = await t.act(id, { type: "respond", input: { kind: "reply", text: "Une condition manque." } });
      await t.act(id, { type: "rateRecall", sceneId: next.self_rating.scene_id, grade: "hard" });
      expect((await t.brief(id)).since_last).toEqual([
        { scene_id: judged.scene.id, act: "read", lane: "fast" },
        { scene_id: first.scene.id, act: "answer", lane: "companion" },
        { scene_id: rating, act: "self_rating", lane: "companion" },
        { scene_id: second.scene.id, act: "answer", lane: "fast" },
        { scene_id: next.self_rating.scene_id, act: "self_rating", lane: "fast" },
      ]);
    } finally { await t.close(); }
  });

  it("counts a screen accepted in a form as an act of the fast lane", async () => {
    const t = await connect({ forms: true });
    try {
      const started = await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "auto-companion-test" });
      const played = await t.call("play_in_forms", { session_id: started.session_id, max_steps: 2 });
      expect(played.steps).toHaveLength(2);
      expect((await t.brief(started.session_id)).since_last).toEqual(
        played.steps.map((step: Json) => ({ scene_id: step.scene_id, act: "read", lane: "fast" })));
    } finally { await t.close(); }
  });

  it("keeps the twelve latest acts and counts them all", async () => {
    const t = await connect();
    try {
      let view = await t.panel("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "auto-companion-test" });
      const id = view.session_id as string;
      const acts: Json[] = [];
      while (acts.length < 14) {
        const scene = view.scene;
        const reads = scene.type === "intro" || scene.type === "concept";
        const input = reads ? { kind: "ack" }
          : scene.type === "quiz" ? { kind: "quiz_choice", choiceId: scene.choices[0].id }
          : { kind: "reply", text: "Je pense que le texte confond deux notions." };
        view = await t.act(id, { type: "respond", input });
        acts.push({ scene_id: scene.id, act: reads ? "read" : "answer", lane: "fast" });
        if (view.self_rating) {
          const rated = view.self_rating.scene_id as string;
          view = await t.act(id, { type: "rateRecall", sceneId: rated, grade: "good" });
          acts.push({ scene_id: rated, act: "self_rating", lane: "fast" });
        }
      }
      const brief = await t.brief(id);
      expect(brief.since_last).toHaveLength(12);
      expect(brief.since_last).toMatchObject(acts.slice(-12));
      expect(brief).toMatchObject({ since_last_count: acts.length, cursor: acts.length });
    } finally { await t.close(); }
  });

  it("holds no key, hint or reference of a question that waits", async () => {
    const t = await connect();
    try {
      const id = (await t.panel("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "auto-companion-test" })).session_id as string;
      await t.act(id, ACK);
      const quiz = await t.act(id, ACK);
      expect(quiz.scene.type).toBe("quiz");
      const text = JSON.stringify(await t.brief(id));
      expect(text).not.toMatch(/"(?:answer|correct|expected|key|solution|hint|hints|feedback\w*|choices|question|sources)"\s*:/);
      const authored = JSON.parse(readFileSync(resolve(FIXTURES, ATOMS), "utf8")).scenes.find((scene: Json) => scene.id === quiz.scene.id);
      const secrets = [authored.question, authored.feedback_correct, authored.feedback_incorrect, ...authored.hints,
        ...authored.choices.map((choice: Json) => choice.text).filter((choiceText: string) => choiceText.length > 3)];
      expect(secrets.length).toBeGreaterThanOrEqual(4);
      for (const secret of secrets) expect(text).not.toContain(secret);
    } finally { await t.close(); }
  });
});
