// The server's prompts through the real MCP server (INT-STUDIUM-058 § 2.6): a lesson played in the
// conversation by a client that can show forms is offered forms once, at a pause; the learner's answer
// is kept. A real MCP client plays a lesson of fixtures/ as a labelled synthetic learner.
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

const FIXTURES = resolve("../../fixtures");
const ATOMS = "atomistique-l1/lesson.json";
type Json = Record<string, any>;

async function connect(capabilities: Json) {
  const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "panel-prompts-test", version: "1" }, { capabilities });
  await client.connect(clientT);
  const raw = async (name: string, args: Json) => await client.callTool({ name, arguments: args }) as { isError?: boolean; structuredContent?: Json; content: Array<{ text?: string }> };
  const call = async (name: string, args: Json): Promise<Json> => {
    const result = await raw(name, args);
    if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
    return result.structuredContent ?? JSON.parse(result.content[0]!.text!);
  };
  const act = async (session_id: string, action: Json): Promise<Json> => (await call("panel_action", { session_id, action })).panel;
  return { host, raw, call, act, close: async () => { await client.close(); await server.close(); } };
}
const ACK = { type: "respond", input: { kind: "ack" } };

describe("the server's prompts through the MCP server", () => {
  it("offers forms once to a lesson played in the conversation, keeps the refusal, and never proposes over a question", async () => {
    const t = await connect({ elicitation: {} });
    try {
      const opened = (await t.call("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "auto-panel-prompts-test", surface: "text" })).panel;
      const id = opened.session_id as string;
      expect(opened.surface).toMatchObject({ rank: 1, kind: "text" });
      expect(opened.surface.available).toContain("form");
      expect(opened.prompts).toEqual([{
        id: "forms_offer", kind: "forms_offer", expires: "session",
        reason: "Cette leçon peut se jouer en formulaires : la réponse suivante arrive sans attendre l'assistant.",
        actions: [
          { label: "Jouer en formulaires", action: { type: "prompt", id: "forms_offer", outcome: "accept" } },
          { label: "Rester en conversation", action: { type: "prompt", id: "forms_offer", outcome: "dismiss" } },
        ],
      }]);
      expect(opened.actions).toContain("prompt");

      const kept = await t.act(id, { type: "prompt", id: "forms_offer", outcome: "dismiss" });
      expect(kept.scene.id).toBe(opened.scene.id);                       // the scene stays, nothing was submitted
      expect(kept.prompts).toEqual([]);
      expect(kept.actions).not.toContain("prompt");
      expect(t.host.promptRecords(id)).toEqual([{ id: "forms_offer", kind: "forms_offer", scene_id: opened.scene.id, outcome: "dismissed" }]);

      // Made once: neither the next screens nor the question bring it back; an answer to it is refused in one line.
      await t.act(id, ACK);
      const quiz = await t.act(id, ACK);
      expect(quiz.scene.type).toBe("quiz");
      expect(quiz.prompts).toEqual([]);
      const refused = await t.raw("panel_action", { session_id: id, action: { type: "prompt", id: "forms_offer", outcome: "accept" } });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]!.text).toContain('no open prompt \\"forms_offer\\"');
      expect(refused.content[0]!.text).not.toContain("\n");
    } finally { await t.close(); }
  });

  it("proposes nothing on a panel, in quiet mode, or to a client that cannot show forms", async () => {
    const forms = await connect({ elicitation: {} });
    try {
      const pane = (await forms.call("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "auto-panel-prompts-test", surface: "pane" })).panel;
      expect(pane.prompts).toEqual([]);
      const text = (await forms.call("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "auto-panel-prompts-test-2", surface: "text" })).panel;
      const quiet = await forms.act(text.session_id, { type: "setAttention", level: "quiet" });
      // The offer made before the learner asked for quiet stays open; nothing new is proposed.
      expect(quiet.prompts.map((p: Json) => p.id)).toEqual(["forms_offer"]);
      expect(forms.host.promptRecords(text.session_id)).toEqual([]);
    } finally { await forms.close(); }
    const plain = await connect({});
    try {
      const opened = (await plain.call("open_lesson_panel", { bundle_ref: ATOMS, learner_id: "auto-panel-prompts-test", surface: "text" })).panel;
      expect(opened.surface.available).not.toContain("form");
      expect(opened.prompts).toEqual([]);
    } finally { await plain.close(); }
  });
});
