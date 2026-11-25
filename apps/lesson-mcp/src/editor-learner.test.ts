// D1 (waiting review 2026-11-25): the server the Studium VS Code extension offers to Copilot is started with
// STUDIUM_LEARNER_ID (the pane's studium.learnerId) and STUDIUM_OPEN_LINK (it is served by the extension). The
// editor then names the learner: the instructions say to omit learner_id, and a learner_id a model passes anyway
// (Mistral's did in every run) is ignored, so that what is learned in the chat is the pane's learner's progress.
// Other harnesses see no change: without STUDIUM_OPEN_LINK, a learner_id passed still wins.
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { hostFromEnvironment } from "./index.js";
import { buildMcpServer, SERVER_INSTRUCTIONS } from "./server.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "editor-learner-")); dirs.push(d); return d; }

const quiz = (id: string) => ({
  id, type: "quiz", title: id, objective_refs: [], concept_refs: ["c1"], estimated_seconds: 60, adaptation_hooks: [],
  question: "?", choices: [{ id: "a", text: "W", correct: false }, { id: "b", text: "R", correct: true }],
  feedback_correct: "yes", feedback_incorrect: "no", hints: [],
});
const LESSON = {
  schema_version: "1.4", bundle_id: "editor-learner", source_plan_id: "p",
  metadata: { title: "Editor learner", target: "L1", duration_minutes: 6, language: "en", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [quiz("q1"), quiz("q2"), quiz("q3")],
  rules: [], validated_by: "teacher", validated_at: "2026-11-25T00:00:00Z",
};
const OPEN_LINK = "vscode://holobiomicslab.studium-vscode/open?bundle=";

async function connect(env: Record<string, string>) {
  const bundlesRoot = tmp();
  mkdirSync(join(bundlesRoot, "editor"), { recursive: true });
  writeFileSync(join(bundlesRoot, "editor", "lesson.json"), JSON.stringify(LESSON));
  const { host } = hostFromEnvironment({ BUNDLES_ROOT: bundlesRoot, STUDIUM_HOME: tmp(), STUDIUM_EPHEMERAL: "1", ...env }, tmp());
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "copilot", version: "1" });
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args }) as { content: Array<{ text?: string }>; isError?: boolean };
    return JSON.parse(res.content[0]?.text ?? "null") as Record<string, any>;
  };
  return { client, call, host };
}
/** Start the lesson with `learnerId` and answer its first question right. */
async function startAndAnswer(call: Awaited<ReturnType<typeof connect>>["call"], learnerId?: string) {
  const started = await call("start_lesson_session", { bundle_ref: "editor/lesson.json", ...(learnerId ? { learner_id: learnerId } : {}) });
  const right = started["presentation"].scene.choices.find((c: { text: string }) => c.text === "R").id;
  await call("submit_response", { session_id: started["session_id"], input: { kind: "quiz_choice", choiceId: right } });
  return started;
}

describe("the server the VS Code extension offers: the editor names the learner", () => {
  const EDITOR = { STUDIUM_OPEN_LINK: OPEN_LINK, STUDIUM_LEARNER_ID: "vscode-learner" };

  it("says so in the instructions, within 13 lines, instead of asking for a stable learner_id", async () => {
    const { client } = await connect(EDITOR);
    const instructions = client.getInstructions() ?? "";
    expect(instructions.split("\n").length).toBeLessThanOrEqual(13);
    expect(instructions).toMatch(/The editor names the learner: omit learner_id/);
    expect(instructions).not.toContain("Pass one stable learner_id");
    const plan = (await client.listTools()).tools.find((t) => t.name === "get_study_plan")!;
    const learnerArg = (plan.inputSchema.properties as Record<string, { description?: string }>)["learner_id"]!;
    expect(learnerArg.description).toMatch(/editor names the learner/);
  });

  it("reports it in persistence, and plays a learner_id a model passes anyway as the editor's learner", async () => {
    const { call } = await connect(EDITOR);
    const info = await call("get_server_info");
    expect(info["persistence"]).toMatchObject({ learner_id_default: "vscode-learner", learner_id_from_editor: true });
    const started = await startAndAnswer(call, "lfx");
    // The progress is the editor's learner's: the plan without learner_id has the lesson in progress.
    const plan = await call("get_study_plan", { language: "en" });
    expect(plan["in_progress"]).toEqual([expect.objectContaining({ bundle_ref: "editor/lesson.json", scenes_completed: 1 })]);
    // And the same learner: a second start without learner_id finds the session already open (D5).
    const again = await call("start_lesson_session", { bundle_ref: "editor/lesson.json" });
    expect(again["session_id"]).toBe(started["session_id"]);
    expect(again["resume"]).toMatchObject({ kind: "already_open" });
  });

  it("changes nothing for another harness: without STUDIUM_OPEN_LINK, a learner_id passed still wins", async () => {
    const { client, call } = await connect({ STUDIUM_LEARNER_ID: "vscode-learner" });
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    const info = await call("get_server_info");
    expect(info["persistence"]).not.toHaveProperty("learner_id_from_editor");
    await startAndAnswer(call, "lfx");
    const plan = await call("get_study_plan", { language: "en" });
    expect(plan["in_progress"]).toEqual([]);
  });

  // D2: the authoring line, rewritten within the same 13 lines, says to offer the pane first when a result or the
  // study plan's next step carries open_link, and to start in the chat only on the learner's « here ».
  it("tells the harness to show display_markdown with open_link first, within 13 lines", async () => {
    const { client } = await connect(EDITOR);
    const lines = (client.getInstructions() ?? "").split("\n");
    expect(lines.length).toBeLessThanOrEqual(13);
    const authoring = lines.find((line) => line.includes("prepare_sources, create_lesson"))!;
    expect(authoring).toMatch(/open_link/);
    expect(authoring).toMatch(/Studium pane first/);
    expect(authoring).toMatch(/start_lesson_session only if the learner says “here”/);
    // What the authoring line already asked stays (harness-contract.test.ts pins it on SERVER_INSTRUCTIONS).
    for (const kept of ["tell_learner", "with your prepare_sources call", "short sketch", "only the scenes it names, with draft_id"]) {
      expect(authoring).toContain(kept);
    }
  });

  it("needs both variables: STUDIUM_OPEN_LINK alone leaves the learner to the model", async () => {
    const { client } = await connect({ STUDIUM_OPEN_LINK: OPEN_LINK });
    expect(client.getInstructions()).toContain("Pass one stable learner_id");
  });
});
