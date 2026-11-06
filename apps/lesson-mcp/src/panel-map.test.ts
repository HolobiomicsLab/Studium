// The concept map in the panel (INT-STUDIUM-058 § 2.7): `openMap` adds `map` to the view, drawn from
// the session's record. A real MCP client plays a lesson of fixtures/ as a labelled synthetic learner.
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost, calendarDate } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

const FIXTURES = resolve("../../fixtures");
const ATOMS = "atomistique-l1/lesson.json";
const LEARNER = "auto-panel-map-test";
type Json = Record<string, any>;

async function connect() {
  const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "panel-map-test", version: "1" }, { capabilities: {} });
  await client.connect(clientT);
  const call = async (name: string, args: Json): Promise<Json> => {
    const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; structuredContent?: Json; content: Array<{ text?: string }> };
    if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
    return result.structuredContent ?? JSON.parse(result.content[0]!.text!);
  };
  const open = async (args: Json = {}): Promise<Json> => (await call("open_lesson_panel", { bundle_ref: ATOMS, learner_id: LEARNER, ...args })).panel;
  const act = async (session_id: string, action: Json): Promise<Json> => (await call("panel_action", { session_id, action })).panel;
  return { host, call, open, act, close: async () => { await client.close(); await server.close(); } };
}

const ACK = { type: "respond", input: { kind: "ack" } };
const authored = JSON.parse(readFileSync(resolve(FIXTURES, ATOMS), "utf8"));

describe("the concept map in the panel", () => {
  it("openMap shows each concept with its state, the evidence of the answers given, and what the state establishes", async () => {
    const t = await connect();
    try {
      // The adapter asks for a pane: rank 3 without an MCP Apps client.
      const opened = await t.open({ surface: "pane" });
      const id = opened.session_id as string;
      expect(opened.actions).toContain("openMap");
      expect(opened.map).toBeUndefined();

      const start = await t.act(id, { type: "openMap" });
      expect(start.scene.id).toBe(opened.scene.id);                 // looking at the map answers nothing
      expect(start.map.concepts.map((c: Json) => c.id)).toEqual(authored.concepts.map((c: Json) => c.id));
      expect(start.map.concepts.every((c: Json) => c.evidence.length === 0)).toBe(true);
      expect(start.map.edges.length).toBeGreaterThan(0);
      expect(start.actions).toContain("closeMap");

      await t.act(id, ACK);
      const quiz = await t.act(id, ACK);
      expect(quiz.scene.type).toBe("quiz");
      expect((await t.act(id, { type: "hint" })).hint.hint).toEqual(expect.any(String));
      const answered = await t.act(id, { type: "respond", input: { kind: "quiz_choice", choiceId: quiz.scene.choices[0].id, confidence: 2 } });

      // The map was left open: the view after the answer carries it, with the answer as evidence.
      const concept = answered.map.concepts.find((c: Json) => c.id === quiz.scene.concept_refs[0]);
      expect(concept.evidence).toEqual([{
        scene_id: quiz.scene.id, day: calendarDate(Date.now(), t.host.timeZone), assessed_by: "key",
        result: answered.verdict.correct ? "right" : "wrong", hints: 1,
      }]);
      expect(["acquired", "to_review", "current"]).toContain(concept.state);
      expect(concept.establishes).toEqual(expect.any(String));
      expect(concept.does_not_establish).toEqual(expect.any(String));
      expect(concept.establishes).toBe(answered.strings[`map_establishes_${concept.state}`]);

      const closed = await t.act(id, { type: "closeMap" });
      expect(closed.map).toBeUndefined();
      expect(closed.actions).toContain("openMap");
    } finally { await t.close(); }
  });

  // This lesson cites no passage; that the view carries none over is checked on a record that has
  // one (packages/lesson-panel map.test.ts).
  it("holds no key, hint or wording of the question that waits", async () => {
    const t = await connect();
    try {
      const id = (await t.open({ surface: "pane" })).session_id as string;
      await t.act(id, ACK);
      const quiz = await t.act(id, ACK);
      const map = JSON.stringify((await t.act(id, { type: "openMap" })).map);
      expect(map).not.toMatch(/"(?:answer|correct|expected|key|solution|hints?|feedback\w*|choices|question|sources|quote)"\s*:/);
      const waiting = authored.scenes.find((scene: Json) => scene.id === quiz.scene.id);
      const secrets = [waiting.question, waiting.feedback_correct, waiting.feedback_incorrect, ...waiting.hints,
        ...waiting.choices.map((choice: Json) => choice.text).filter((text: string) => text.length > 3)];
      expect(secrets.length).toBeGreaterThanOrEqual(4);
      for (const secret of secrets) expect(map).not.toContain(secret);
      expect(map).not.toContain(LEARNER);
    } finally { await t.close(); }
  });

  it("is offered from forms upwards, never in the conversation alone", async () => {
    const t = await connect();
    try {
      // This client declared neither forms nor a panel: the conversation, rank 1.
      const text = await t.open();
      expect(text.surface.rank).toBe(1);
      expect(text.actions).not.toContain("openMap");
    } finally { await t.close(); }
  });
});
