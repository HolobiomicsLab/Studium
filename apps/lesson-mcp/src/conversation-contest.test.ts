// Contesting a concept from the conversation (INT-STUDIUM-058 lot 4, walkthrough 2026-11-07): the
// learner tells the assistant « je connais déjà cette notion » and the assistant relays it as
// submit_response {kind: "contest", concept_id, claim}, with the concept's id from the map. The lesson
// asks the check questions on that concept, graded as any answer, then resumes where the learner was.
// A real MCP client plays fixtures/atomistique-l1 as a labelled synthetic learner, with consent granted.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

const FIXTURES = resolve("../../fixtures");
const ATOMS = "atomistique-l1/lesson.json";
const LEARNER = "auto-test-mcp-conversation-contest";
type Json = Record<string, any>;
const authored = JSON.parse(readFileSync(resolve(FIXTURES, ATOMS), "utf8")) as { scenes: Array<{ id: string; choices?: Array<{ text: string; correct: boolean }> }> };

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

async function connect(dataDir: string) {
  const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "conversation-contest-test", version: "1" }, { capabilities: {} });
  await client.connect(clientT);
  const raw = async (name: string, args: Json) =>
    client.callTool({ name, arguments: args }) as Promise<{ isError?: boolean; structuredContent?: Json; content: Array<{ text?: string }> }>;
  const call = async (name: string, args: Json): Promise<Json> => {
    const result = await raw(name, args);
    if (result.isError) throw new Error(`${name}: ${result.content[0]?.text}`);
    return result.structuredContent ?? JSON.parse(result.content[0]!.text!);
  };
  return { call, raw, close: async () => { await client.close(); await server.close(); } };
}

const rightChoice = (scene: Json): string => {
  const right = authored.scenes.find((s) => s.id === scene.id)!.choices!.find((c) => c.correct)!.text;
  return (scene.choices as Array<{ id: string; text: string }>).find((c) => c.text === right)!.id;
};

describe("contesting a concept in the conversation", () => {
  it("asks the check questions, says so in one line, then resumes where the learner was; one contest act at rank 1", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mcp-conversation-contest-")); dirs.push(dataDir);
    const previous = process.env["STUDIUM_TELEMETRY_CONSENT"];
    process.env["STUDIUM_TELEMETRY_CONSENT"] = "granted";
    try {
      const t = await connect(dataDir);
      try {
        const started = await t.call("start_lesson_session", { bundle_ref: ATOMS, learner_id: LEARNER });
        const id = started.session_id as string;
        // The map the first screen shows names each concept's id, which the assistant relays.
        expect(started.presentation.display_markdown).toContain("Nombres quantiques (`c-nombres-quantiques`)");
        const reading = (await t.call("submit_response", { session_id: id, input: { kind: "ack" } })).transition.presentation.scene;
        expect(reading.id).toBe("s1-concept-particules");

        // A claim the state does not take is refused in one line.
        const wrong = await t.raw("submit_response", { session_id: id, input: { kind: "contest", concept_id: "c-nombres-quantiques", claim: "unsure" } });
        expect(wrong.isError).toBe(true);
        expect(JSON.parse(wrong.content[0]!.text!).error).toBe("\"c-nombres-quantiques\" is not acquired: the claim it takes is \"known\"");
        // A claim that is not one of the two is refused in one line, from the contest's own branch.
        const odd = await t.raw("submit_response", { session_id: id, input: { kind: "contest", concept_id: "c-nombres-quantiques", claim: "maybe" } });
        expect(odd.isError).toBe(true);
        expect(odd.content[0]!.text).toMatch(/Expected 'known' \| 'unsure', received 'maybe'/);

        const contest = await t.call("submit_response", { session_id: id, input: { kind: "contest", concept_id: "c-nombres-quantiques", claim: "known" } });
        expect(contest.contest).toEqual({ concept_id: "c-nombres-quantiques", claim: "known", questions: 2 });
        expect(contest.presentation.scene.id).toBe("s2-quiz-4f");
        expect(contest.presentation.scene).not.toHaveProperty("choices.0.correct");
        const lines = (contest.display_markdown as string).split("\n\n");
        expect(lines[0]).toBe("Contrôle sur « Nombres quantiques » : 2 questions. Ta déclaration ne change rien à ta maîtrise ; la leçon reprend ensuite où tu étais.");
        expect(contest.display_markdown).toContain(contest.presentation.display_markdown);
        expect(contest.presentation.display_markdown).toContain("contrôle 1/2");

        // Another contest while this one is under way is refused in one line.
        const twice = await t.raw("submit_response", { session_id: id, input: { kind: "contest", concept_id: "c-spectres", claim: "known" } });
        expect(JSON.parse(twice.content[0]!.text!).error).toBe("check questions are already being asked: answer them first");

        const second = (await t.call("submit_response", { session_id: id, input: { kind: "quiz_choice", choiceId: rightChoice(contest.presentation.scene), confidence: 3 } })).transition;
        expect(second.presentation.scene.id).toBe("s9-rappel-3d");
        expect(second.presentation.display_markdown).toContain("contrôle 2/2");
        const back = (await t.call("submit_response", { session_id: id, input: { kind: "quiz_choice", choiceId: rightChoice(second.presentation.scene), confidence: 3 } })).transition;
        expect(back.presentation.scene.id).toBe("s1-concept-particules");
        await t.call("end_session", { session_id: id });
      } finally { await t.close(); }
    } finally {
      if (previous === undefined) delete process.env["STUDIUM_TELEMETRY_CONSENT"]; else process.env["STUDIUM_TELEMETRY_CONSENT"] = previous;
    }

    const files = (readdirSync(dataDir, { recursive: true }) as string[]).map(String).filter((f) => f.endsWith("telemetry.jsonl"));
    const events = files.flatMap((f) => readFileSync(join(dataDir, f), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Json));
    const contests = events.filter((e) => e["type"] === "interaction" && e["act"] === "contest");
    expect(contests).toHaveLength(1);
    expect(contests[0]).toMatchObject({ lane: "companion", surface_rank: 1, scene_id: "s1-concept-particules" });
  });

  it("says how in the server's instructions and in submit_response's description, never for the learner", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null });
    const server = buildMcpServer(host);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "conversation-contest-test", version: "1" }, { capabilities: {} });
    await client.connect(clientT);
    try {
      expect(client.getInstructions()).toContain("{kind: \"contest\", concept_id, claim}");
      const description = (await client.listTools()).tools.find((tool) => tool.name === "submit_response")!.description!;
      expect(description).toContain("{kind:\"contest\", concept_id:\"<id>\", claim:\"known\"|\"unsure\"}");
      expect(description).toContain("Never contest for the learner.");
    } finally { await client.close(); await server.close(); }
  });
});
