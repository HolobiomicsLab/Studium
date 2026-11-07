// The server's prompts in the conversation and in forms (INT-STUDIUM-058 § 2.6, task 5.2's recorded
// deviation): a lesson played with the session tools alone (rank 1) or in forms (rank 2) is proposed
// what is due, in the text of the screen it is made on, once, and the consented stream logs it as shown
// on that surface. A real MCP client plays fixtures/atomistique-l1 as a labelled synthetic learner who
// answered a graded question long ago, so that a review is due when the lesson is taken up again.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

const FIXTURES = resolve("../../fixtures");
const ATOMS = "atomistique-l1/lesson.json";
const T0 = Date.parse("2026-11-06T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
type Json = Record<string, any>;
const authored = JSON.parse(readFileSync(resolve(FIXTURES, ATOMS), "utf8")) as { scenes: Array<{ id: string; choices?: Array<{ text: string; correct: boolean }> }> };
/** The proposal of a review due, as the conversation text says it (chat-display.ts prompt_proposal). */
const REVIEW = "**Proposition\u00a0:** 1 notion à revoir aujourd'hui (proposition `review_due:start`)";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function connect(dataDir: string, forms: string[] = []) {
  const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "conversation-prompts-test", version: "1" }, { capabilities: { elicitation: {} } });
  // The learner reads each form, then declines it: the lesson goes back to the conversation.
  client.setRequestHandler(ElicitRequestSchema, async (request) => { forms.push(String(request.params.message)); return { action: "decline" }; });
  await client.connect(clientT);
  const call = async (name: string, args: Json): Promise<Json> => {
    const result = await client.callTool({ name, arguments: args }) as { isError?: boolean; structuredContent?: Json; content: Array<{ text?: string }> };
    if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
    return result.structuredContent ?? JSON.parse(result.content[0]!.text!);
  };
  return { call, close: async () => { await client.close(); await server.close(); } };
}

/** A first session at T0: the learner reads up to the first question, answers it right, writes the audit
 * that follows, and stops on the next screen to read, so that the lesson is taken up again there. */
async function answeredLongAgo(dataDir: string, learner: string): Promise<void> {
  const t = await connect(dataDir);
  try {
    const started = await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: learner, now_ms: T0 });
    const id = started.session_id as string;
    let scene = started.presentation.scene as Json;
    while (scene.type !== "quiz") scene = (await t.call("submit_response", { session_id: id, input: { kind: "ack" } })).transition.presentation.scene;
    const right = authored.scenes.find((s) => s.id === scene.id)!.choices!.find((c) => c.correct)!.text;
    const choiceId = (scene.choices as Array<{ id: string; text: string }>).find((c) => c.text === right)!.id;
    scene = (await t.call("submit_response", { session_id: id, input: { kind: "quiz_choice", choiceId, confidence: 3 } })).transition.presentation.scene;
    // The audit that follows takes the learner's own words, which no judge assesses here: the learner
    // rates their recall. Then a screen to read, where the session stops.
    while (scene.type !== "concept") {
      const { transition } = await t.call("submit_response", { session_id: id, input: { kind: "reply", text: "Le noyau porte les protons et les neutrons ; les électrons l'entourent." } });
      if (transition.self_rating) await t.call("rate_recall", { session_id: id, scene_id: transition.self_rating.scene_id, grade: "good" });
      scene = transition.presentation.scene;
    }
    await t.call("end_session", { session_id: id });
  } finally { await t.close(); }
}

function promptsShown(dataDir: string): Json[] {
  const files = (readdirSync(dataDir, { recursive: true }) as string[]).map(String).filter((f) => f.endsWith("telemetry.jsonl"));
  return files.flatMap((f) => readFileSync(join(dataDir, f), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Json))
    .filter((e) => e["type"] === "prompt_shown");
}

describe("the server's prompts in the conversation and in forms", () => {
  it("proposes the review due in the first screen of a lesson played with the session tools, once, logged at rank 1", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mcp-conversation-prompts-")); dirs.push(dataDir);
    const previous = process.env["STUDIUM_TELEMETRY_CONSENT"];
    process.env["STUDIUM_TELEMETRY_CONSENT"] = "granted";
    try {
      await answeredLongAgo(dataDir, "auto-test-conversation-prompts");
      const t = await connect(dataDir);
      try {
        const again = await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "auto-test-conversation-prompts", now_ms: T0 + 400 * DAY });
        expect(again.resume.kind).toBe("resumed");
        const first = again.presentation.display_markdown as string;
        expect(first).toContain(REVIEW);
        expect(first).toContain("Reprise à l'étape 5 sur 32.");                       // beside the resume notice, which stays
        expect(first.split(REVIEW)).toHaveLength(2);                                  // said once on that screen
        const same = (await t.call("get_current_scene", { session_id: again.session_id })).presentation.display_markdown as string;
        expect(same).not.toContain(REVIEW);                                           // and not said again
        const next = await t.call("submit_response", { session_id: again.session_id, input: { kind: "ack" } });
        expect(JSON.stringify(next.transition)).not.toContain("revoir aujourd'hui");
        await t.call("end_session", { session_id: again.session_id });
      } finally { await t.close(); }
    } finally {
      if (previous === undefined) delete process.env["STUDIUM_TELEMETRY_CONSENT"]; else process.env["STUDIUM_TELEMETRY_CONSENT"] = previous;
    }
    const shown = promptsShown(dataDir).filter((e) => e["kind"] === "review_due");
    expect(shown.map((e) => e["surface_rank"])).toEqual([1]);
  }, 30_000);

  it("says the review due once when the lesson goes on in forms, and logs it once", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mcp-forms-prompts-")); dirs.push(dataDir);
    const previous = process.env["STUDIUM_TELEMETRY_CONSENT"];
    process.env["STUDIUM_TELEMETRY_CONSENT"] = "granted";
    const forms: string[] = [];
    try {
      await answeredLongAgo(dataDir, "auto-test-forms-prompts");
      const t = await connect(dataDir, forms);
      try {
        // The session is started in the conversation and played in forms at once: the proposal is said
        // in one place, the conversation's first screen, never twice.
        const again = await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "auto-test-forms-prompts", now_ms: T0 + 400 * DAY });
        const played = await t.call("play_in_forms", { session_id: again.session_id, max_steps: 1 });
        expect(played.status).toBe("paused");
        const said = [again.presentation.display_markdown as string, ...forms].filter((text) => text.includes(REVIEW));
        expect(said).toHaveLength(1);
        await t.call("end_session", { session_id: again.session_id });
      } finally { await t.close(); }
    } finally {
      if (previous === undefined) delete process.env["STUDIUM_TELEMETRY_CONSENT"]; else process.env["STUDIUM_TELEMETRY_CONSENT"] = previous;
    }
    expect(promptsShown(dataDir).filter((e) => e["kind"] === "review_due")).toHaveLength(1);
  }, 30_000);

  it("takes the learner's answer to a proposal through submit_response, and names the call that follows", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mcp-prompt-answer-")); dirs.push(dataDir);
    await answeredLongAgo(dataDir, "auto-test-prompt-answer");
    const t = await connect(dataDir);
    try {
      const again = await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: "auto-test-prompt-answer", now_ms: T0 + 400 * DAY });
      const id = again.session_id as string;
      expect(again.presentation.display_markdown).toContain(REVIEW);
      const scene = again.presentation.scene.id as string;
      const accepted = await t.call("submit_response", { session_id: id, input: { kind: "prompt", id: "review_due:start", outcome: "accepted" } });
      expect(accepted.prompt).toEqual({ id: "review_due:start", kind: "review_due", outcome: "accepted" });
      expect(accepted.next_call).toEqual({ tool: "start_review_session" });
      expect(accepted.display_markdown).toBe("Révision acceptée\u00a0: l'assistant ouvre la session de révision (`start_review_session`).");
      expect((await t.call("get_current_scene", { session_id: id })).presentation.scene.id).toBe(scene);   // nothing was answered
      // Answered once: a second answer, or an answer to a proposal nobody made, is refused in one line.
      await expect(t.call("submit_response", { session_id: id, input: { kind: "prompt", id: "review_due:start", outcome: "dismissed" } }))
        .rejects.toThrow('no open prompt \\"review_due:start\\"');
      await expect(t.call("submit_response", { session_id: id, input: { kind: "prompt", id: "review_due:start", outcome: "maybe" } }))
        .rejects.toThrow(/Expected 'accepted' \| 'dismissed', received 'maybe'/);
      const forms = await t.call("submit_response", { session_id: id, input: { kind: "prompt", id: "forms_offer", outcome: "dismissed" } });
      expect(forms).toMatchObject({ prompt: { id: "forms_offer", kind: "forms_offer", outcome: "dismissed" }, display_markdown: "C'est noté, plus tard\u00a0: la leçon continue." });
      expect(forms.next_call).toBeUndefined();
    } finally { await t.close(); }
  }, 30_000);
});
