// The interaction log through the real MCP server (INT-STUDIUM-058 § 2.10, F14): the tool handlers
// name each act the learner makes, on whichever surface, and the host writes it to the consented
// stream with its lane, the session's surface rank and the time the server took. A real MCP client
// plays fixtures/atomistique-l1 as a labelled synthetic learner, with consent granted.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SessionHost } from "@studium/lesson-session-host";
import { TelemetryEventSchema } from "../../../packages/telemetry-events/src/events.js";
import { buildMcpServer } from "./server.js";

const FIXTURES = resolve("../../fixtures");
const ATOMS = "atomistique-l1/lesson.json";
const LEARNER = "auto-test-mcp-interaction-events";
type Json = Record<string, any>;
const authored = JSON.parse(readFileSync(resolve(FIXTURES, ATOMS), "utf8")) as { scenes: Array<{ id: string; choices?: Array<{ text: string; correct: boolean }> }> };

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function connect(dataDir: string) {
  const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "interaction-events-test", version: "1" }, { capabilities: { elicitation: {} } });
  // The learner accepts each form: a screen to read is acknowledged.
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: {} }));
  await client.connect(clientT);
  const call = async (name: string, args: Json): Promise<Json> => {
    const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; structuredContent?: Json; content: Array<{ text?: string }> };
    if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
    return result.structuredContent ?? JSON.parse(result.content[0]!.text!);
  };
  return { call, close: async () => { await client.close(); await server.close(); } };
}

/** A client that declares no capability: the conversation is the only surface it renders. */
async function connectPlain(dataDir: string) {
  const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "interaction-events-plain-test", version: "1" }, { capabilities: {} });
  await client.connect(clientT);
  const call = async (name: string, args: Json): Promise<Json> => {
    const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; structuredContent?: Json; content: Array<{ text?: string }> };
    if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
    return result.structuredContent ?? JSON.parse(result.content[0]!.text!);
  };
  return { call, close: async () => { await client.close(); await server.close(); } };
}

function interactions(dataDir: string): Json[] {
  const files = (readdirSync(dataDir, { recursive: true }) as string[]).map(String).filter((f) => f.endsWith("telemetry.jsonl"));
  return files.flatMap((f) => readFileSync(join(dataDir, f), "utf8").trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as Json).filter((e) => e["type"] === "interaction"));
}

describe("interaction events through the MCP server", () => {
  it("logs each act of the panel, the forms and the conversation tools, with lane, rank and the server's time", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mcp-interaction-events-")); dirs.push(dataDir);
    const previous = process.env["STUDIUM_TELEMETRY_CONSENT"];
    process.env["STUDIUM_TELEMETRY_CONSENT"] = "granted";
    try {
      const t = await connect(dataDir);
      try {
        const opened = (await t.call("open_lesson_panel", { bundle_ref: ATOMS, learner_id: LEARNER, surface: "pane" })).panel;
        const id = opened.session_id as string;
        await t.call("panel_action", { session_id: id, action: { type: "respond", input: { kind: "ack" } }, client_ms: 7 });
        // A conversation act while the session is played on the pane logs the pane's rank, not 1.
        await t.call("request_hint", { session_id: id });
        await t.call("get_panel_view", { session_id: id, surface: "pane" });   // the same rank: no resume
        await t.call("get_panel_view", { session_id: id, surface: "text" });   // another rank: a resume
        expect((await t.call("play_in_forms", { session_id: id, max_steps: 1 })).status).toBe("limit");
        expect((await t.call("request_hint", { session_id: id })).hint).not.toBeNull();
        await t.call("panel_action", { session_id: id, action: { type: "ask", text: "Explique-moi cet écran." } });
        await t.call("panel_action", { session_id: id, action: { type: "ask", text: "Pourquoi le fer ?" } });   // a question, not the explanation
        const shown = (await t.call("get_current_scene", { session_id: id })).presentation.scene as { id: string; choices: Array<{ id: string; text: string }> };
        const right = authored.scenes.find((s) => s.id === shown.id)!.choices!.find((c) => c.correct)!.text;
        await t.call("submit_response", { session_id: id, input: { kind: "quiz_choice", choiceId: shown.choices.find((c) => c.text === right)!.id, confidence: 2 } });
        await t.call("set_session_language", { session_id: id, presentation_language: "en" });
        await t.call("end_session", { session_id: id });
        const again = await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: LEARNER });
        expect(again.resume.kind).toBe("resumed");
        await t.call("end_session", { session_id: again.session_id });
      } finally { await t.close(); }
    } finally {
      if (previous === undefined) delete process.env["STUDIUM_TELEMETRY_CONSENT"]; else process.env["STUDIUM_TELEMETRY_CONSENT"] = previous;
    }

    const files = (readdirSync(dataDir, { recursive: true }) as string[]).map(String).filter((f) => f.endsWith("telemetry.jsonl"));
    expect(files).toHaveLength(1);
    const raw = readFileSync(join(dataDir, files[0]!), "utf8");
    const events = raw.trim().split("\n").map((line) => JSON.parse(line) as Json)
      .filter((e) => ["interaction", "help_used", "resume"].includes(e["type"]));
    for (const event of events) expect(TelemetryEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
    for (const event of events.filter((e) => e["type"] === "interaction")) expect(event["server_ms"]).toBeGreaterThanOrEqual(0);
    const brief = events.map(({ type, act, lane, surface_rank, client_ms, scene_id, rung, cause }) =>
      Object.fromEntries(Object.entries({ type, act, lane, surface_rank, client_ms, scene_id, rung, cause }).filter(([, v]) => v !== undefined)));
    expect(brief).toEqual([
      { type: "interaction", act: "respond", lane: "fast", surface_rank: 3, client_ms: 7, scene_id: "s0-intro" },
      { type: "interaction", act: "hint", lane: "companion", surface_rank: 3, scene_id: "s1-concept-particules" },
      { type: "resume", cause: "surface_change" },
      { type: "interaction", act: "respond", lane: "fast", surface_rank: 2, scene_id: "s1-concept-particules" },
      { type: "help_used", rung: "hint", scene_id: "s1-quiz-fer" },
      { type: "interaction", act: "hint", lane: "companion", surface_rank: 1, scene_id: "s1-quiz-fer" },
      { type: "help_used", rung: "explain", scene_id: "s1-quiz-fer" },
      { type: "interaction", act: "ask", lane: "fast", surface_rank: 1, scene_id: "s1-quiz-fer" },
      { type: "interaction", act: "ask", lane: "fast", surface_rank: 1, scene_id: "s1-quiz-fer" },
      { type: "interaction", act: "respond", lane: "companion", surface_rank: 1, scene_id: "s1-quiz-fer" },
      { type: "interaction", act: "setLanguage", lane: "companion", surface_rank: 1, scene_id: "s1b-audit-particules" },
      { type: "interaction", act: "end", lane: "companion", surface_rank: 1 },
      { type: "resume", cause: "restart" },
      // This second session was started by start_lesson_session in a client that can show forms:
      // the panel tools negotiated rank 2 for it, which its conversation end logs.
      { type: "interaction", act: "end", lane: "companion", surface_rank: 2 },
    ]);
    // Neither the learner's question nor their id reaches the stream.
    expect(raw).not.toContain("Pourquoi");
    expect(raw).not.toContain("Explique");
    expect(raw).not.toContain(LEARNER);
  });

  it("logs a conversation act at the rank the session is played on, and 1 when no rank was negotiated", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mcp-interaction-rank-")); dirs.push(dataDir);
    const previous = process.env["STUDIUM_TELEMETRY_CONSENT"];
    process.env["STUDIUM_TELEMETRY_CONSENT"] = "granted";
    try {
      // No capability declared: start_lesson_session negotiates the conversation, rank 1.
      const plain = await connectPlain(join(dataDir, "plain"));
      try {
        const started = await plain.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: LEARNER });
        await plain.call("submit_response", { session_id: started.session_id as string, input: { kind: "ack" } });
        await plain.call("end_session", { session_id: started.session_id as string });
      } finally { await plain.close(); }
      expect(interactions(join(dataDir, "plain")).map((e) => ({ act: e["act"], lane: e["lane"], rank: e["surface_rank"] })))
        .toContainEqual({ act: "respond", lane: "companion", rank: 1 });

      // The pane, then renegotiated to text: the conversation act logs the text rank.
      const t = await connect(join(dataDir, "renegotiated"));
      try {
        const opened = (await t.call("open_lesson_panel", { bundle_ref: ATOMS, learner_id: LEARNER, surface: "pane" })).panel;
        const id = opened.session_id as string;
        await t.call("request_hint", { session_id: id });
        await t.call("open_lesson_panel", { session_id: id, surface: "text" });
        await t.call("request_hint", { session_id: id });
        await t.call("end_session", { session_id: id });
      } finally { await t.close(); }
      expect(interactions(join(dataDir, "renegotiated")).filter((e) => e["act"] === "hint")
        .map((e) => ({ act: e["act"], rank: e["surface_rank"] })))
        .toEqual([{ act: "hint", rank: 3 }, { act: "hint", rank: 1 }]);
    } finally {
      if (previous === undefined) delete process.env["STUDIUM_TELEMETRY_CONSENT"]; else process.env["STUDIUM_TELEMETRY_CONSENT"] = previous;
    }
  });
});
