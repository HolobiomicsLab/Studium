// Audit 2026-11-10 (passe Fable, usages apprenant), over a real MCP client that declares nothing:
//   D2  submit_response and panel_action respond take expected_scene_id; a stale one is refused in one
//       line and changes nothing; a typed answer on a reading scene is refused;
//   D5  start_lesson_session returns the session already open for the learner and the lesson;
//   D8  the answer that settles a contest says its outcome first, in the conversation;
//   D10 forget_session takes a language;
//   difficulty 3: the summary of a pane granted to a client that declared nothing says how to go on;
//   difficulty 5: both spellings of a prompt's outcome are accepted on both routes.
// Synthetic learners only; nothing is written to disk (dataDir null).
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost, STALE_SCENE_MESSAGE } from "@studium/lesson-session-host";
import { phrase } from "../../../packages/lesson-panel/src/phrases.js";
import { buildMcpServer } from "./server.js";

const FIXTURES = resolve("../../fixtures");
const ATOMS = "atomistique-l1/lesson.json";
type Json = Record<string, any>;
const authored = JSON.parse(readFileSync(resolve(FIXTURES, ATOMS), "utf8")) as { scenes: Array<{ id: string; choices?: Array<{ text: string; correct: boolean }> }> };
const choiceOf = (scene: Json, right: boolean): string => {
  const text = authored.scenes.find((s) => s.id === scene.id)!.choices!.find((c) => c.correct === right)!.text;
  return (scene.choices as Array<{ id: string; text: string }>).find((c) => c.text === text)!.id;
};

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

async function connect() {
  const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "session-integrity-test", version: "1" }, { capabilities: {} });
  await client.connect(clientT);
  closers.push(async () => { await client.close(); await server.close(); });
  const raw = async (name: string, args: Json) =>
    client.callTool({ name, arguments: args }) as Promise<{ isError?: boolean; structuredContent?: Json; content: Array<{ text?: string }> }>;
  const call = async (name: string, args: Json): Promise<Json> => {
    const result = await raw(name, args);
    if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
    return result.structuredContent ?? JSON.parse(result.content[0]!.text!);
  };
  const error = async (name: string, args: Json): Promise<string> => {
    const result = await raw(name, args);
    expect(result.isError).toBe(true);
    return JSON.parse(result.content[0]!.text!).error as string;
  };
  return { client, call, raw, error };
}

describe("D2: an answer names the scene it answers", () => {
  it("submit_response refuses a stale expected_scene_id in one line and changes nothing; a duplicate answer is refused", async () => {
    const t = await connect();
    const id = (await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-audit-stale" })).session_id;
    expect((await t.call("submit_response", { session_id: id, expected_scene_id: "s0-intro", input: { kind: "ack" } })).transition.presentation.scene.id)
      .toBe("s1-concept-particules");
    await t.call("submit_response", { session_id: id, input: { kind: "ack" } });
    const quiz = (await t.call("get_current_scene", { session_id: id })).presentation.scene;
    const answer = { session_id: id, expected_scene_id: quiz.id, input: { kind: "reply", text: choiceOf(quiz, true) } };
    expect((await t.call("submit_response", answer)).transition.verdict.scene_id).toBe(quiz.id);
    const state = JSON.stringify((await t.call("get_session_state", { session_id: id })).state);
    expect(await t.error("submit_response", answer)).toBe(STALE_SCENE_MESSAGE);
    expect(JSON.stringify((await t.call("get_session_state", { session_id: id })).state)).toBe(state);
  });

  it("a typed answer on a reading scene is refused; ack and reply move it on", async () => {
    const t = await connect();
    const id = (await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-audit-reading" })).session_id;
    const refused = await t.error("submit_response", { session_id: id, input: { kind: "explanation", text: "une réponse en retard" } });
    expect(refused).toMatch(/^the scene on screen is a reading scene: it takes \{kind: "ack"\}/);
    expect(refused).not.toContain("\n");
    expect((await t.call("submit_response", { session_id: id, input: { kind: "reply", text: "continuer" } })).transition.kind).toBe("next");
  });

  it("says to pass expected_scene_id, in submit_response's description and in get_operator_context's example", async () => {
    const t = await connect();
    const description = (await t.client.listTools()).tools.find((tool) => tool.name === "submit_response")!.description!;
    expect(description).toContain("expected_scene_id");
    const id = (await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-audit-context" })).session_id;
    const context = await t.call("get_operator_context", { session_id: id });
    expect(context.response.call).toEqual({
      tool: "submit_response", arguments: { session_id: id, expected_scene_id: context.scene.id, input: context.response.example },
    });
  });

  it("panel_action respond checks expected_scene_id against the scene the view shows", async () => {
    const t = await connect();
    const opened = await t.call("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "synthetic-audit-panel", surface: "text" });
    const id = opened.panel.session_id as string;
    const shown = opened.panel.scene.id as string;
    const moved = await t.call("panel_action", { session_id: id, action: { type: "respond", input: { kind: "ack" }, expected_scene_id: shown } });
    expect(moved.panel.scene.id).not.toBe(shown);
    expect(await t.error("panel_action", { session_id: id, action: { type: "respond", input: { kind: "ack" }, expected_scene_id: shown } }))
      .toBe(STALE_SCENE_MESSAGE);
    expect((await t.call("get_panel_view", { session_id: id })).panel.scene.id).toBe(moved.panel.scene.id);
  });
});

describe("D5: one open session per learner and lesson", () => {
  it("start_lesson_session returns the session already open, where it was, and says so", async () => {
    const t = await connect();
    const first = await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-audit-twice" });
    await t.call("submit_response", { session_id: first.session_id, input: { kind: "ack" } });
    const again = await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-audit-twice" });
    expect(again.session_id).toBe(first.session_id);
    expect(again.resume).toMatchObject({ kind: "already_open", scene_id: "s1-concept-particules", scenes_completed: 1 });
    expect(again.presentation.display_markdown).toMatch(/^Cette leçon était déjà ouverte/);
    await t.call("end_session", { session_id: first.session_id });
    const fresh = await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-audit-twice" });
    expect(fresh.session_id).not.toBe(first.session_id);
  });
});

describe("D8: a contest's outcome is said in the conversation", () => {
  it("the answer that settles it opens with the outcome and the count", async () => {
    const t = await connect();
    const id = (await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-audit-contest" })).session_id;
    await t.call("submit_response", { session_id: id, input: { kind: "ack" } });
    const contest = await t.call("submit_response", { session_id: id, input: { kind: "contest", concept_id: "c-particules", claim: "known" } });
    expect(contest.contest.questions).toBe(2);
    const first = await t.call("submit_response", { session_id: id, input: { kind: "quiz_choice", choiceId: choiceOf(contest.presentation.scene, false) } });
    expect(first.transition.display_markdown).not.toContain(phrase("pane_map_outcome_refuted", {}, "fr"));
    const last = await t.call("submit_response", { session_id: id, input: { kind: "quiz_choice", choiceId: choiceOf(first.transition.presentation.scene, false) } });
    expect(last.transition.contest.outcome).toBe("refuted");
    expect(last.transition.display_markdown.split("\n")[0]).toBe(`${phrase("pane_map_outcome_refuted", {}, "fr")} (0/2).`);
  });
});

describe("D10: forget_session takes a language", () => {
  it("answers « nothing to erase » in French when asked, in the server default otherwise", async () => {
    const t = await connect();
    expect((await t.call("forget_session", { learner_id: "synthetic-audit-nobody", language: "fr" })).display_markdown).toMatch(/^Rien à effacer/);
    expect((await t.call("forget_session", { learner_id: "synthetic-audit-nobody" })).display_markdown).toMatch(/^Nothing to erase/);
    const refused = await t.raw("forget_session", { learner_id: "synthetic-audit-nobody", language: "de" });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/language must be fr or en/);
  });
});

describe("difficulty 3: a pane granted to a client that declared nothing", () => {
  it("its summary says how the conversation goes on if no pane is shown", async () => {
    const t = await connect();
    const opened = await t.raw("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "synthetic-audit-pane", surface: "pane" });
    const summary = opened.content[1]!.text!;
    expect(summary).toContain("Surface: pane.");
    expect(summary).toContain("surface: \"text\"");
  });
});

describe("difficulty 5: a prompt's outcome in either spelling", () => {
  it("submit_response and panel_action accept accept/accepted and dismiss/dismissed", async () => {
    const t = await connect();
    const id = (await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "synthetic-audit-prompt" })).session_id;
    // No proposal is open: each spelling reaches the session's book and is refused there, not by the schema.
    for (const outcome of ["accept", "accepted", "dismiss", "dismissed"]) {
      expect(await t.error("submit_response", { session_id: id, input: { kind: "prompt", id: "nothing:open", outcome } })).toBe("no open prompt \"nothing:open\"");
      expect(await t.error("panel_action", { session_id: id, action: { type: "prompt", id: "nothing:open", outcome } })).toBe("no open prompt \"nothing:open\"");
    }
  });
});
