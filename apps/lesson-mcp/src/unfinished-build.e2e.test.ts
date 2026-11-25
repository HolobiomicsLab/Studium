// apps/lesson-mcp/src/unfinished-build.e2e.test.ts
//
// D4 (waiting review 2026-11-25, owner's decision 3) through the real server, the host of the stdio
// entry point under a temporary STUDIUM_HOME: Studium keeps a refused draft, the assistant resends only
// the faulty scene with draft_id, and after a restart get_study_plan offers to finish a build that
// stopped. The drafts replayed are the two create_lesson calls recorded in OpenCode (fixture of the
// authoring-draft package): the first was refused for an unknown field in scene 8.
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { hostFromEnvironment } from "./index.js";
import { buildMcpServer } from "./server.js";

const MINUTE = 60_000;
const FIXTURE = fileURLToPath(new URL("../../../packages/lesson-session-host/src/authoring-draft/fixtures/photosynthese/", import.meta.url));
const fixture = (name: string): any => JSON.parse(readFileSync(join(FIXTURE, name), "utf8"));
const PREPARE = fixture("prepare.json") as { goal: string; language: string; sources: Array<{ title: string }> };
const REJECTED = fixture("create-1-rejected.json") as { course_id: string; draft: Record<string, any> };
const ACCEPTED = fixture("create-2-accepted.json") as { course_id: string; draft: Record<string, any> };
const LEARNER = "ana";

const home = realpathSync(mkdtempSync(join(tmpdir(), "studium-d4-home-")));
const notesDir = realpathSync(mkdtempSync(join(tmpdir(), "studium-d4-notes-")));
afterAll(() => { for (const dir of [home, notesDir]) rmSync(dir, { recursive: true, force: true }); });
const notes = join(notesDir, "photosynthese.md");
writeFileSync(notes, readFileSync(join(FIXTURE, "notes.txt"), "utf8"), "utf8");

type Json = Record<string, any>;
async function startServer() {
  const { host } = hostFromEnvironment({ STUDIUM_HOME: home }, "/nonexistent-home");
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "d4-harness", version: "1.0.0" });
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }) as { content: Array<{ text?: string }>; isError?: boolean };
    const text = result.content[0]?.text ?? "null";
    let body: Json;
    try { body = JSON.parse(text) as Json; } catch { body = { error: text }; }
    return { isError: result.isError === true, body };
  };
  return { client, call, close: () => client.close() };
}
const afterGrace = () => Date.now() + 31 * MINUTE;

describe("a refused draft is kept, fixed scene by scene, and offered again after a restart (D4)", () => {
  it("resends only scene 8 with draft_id after the server restarted, from the study plan's offer", async () => {
    const first = await startServer();
    const prepared = await first.call("prepare_sources", {
      sources: [{ path: notes, title: PREPARE.sources[0]!.title }], goal: PREPARE.goal, language: PREPARE.language,
    });
    expect(prepared.isError).toBe(false);
    const refused = await first.call("create_lesson", { source_set_id: prepared.body["source_set_id"], draft: REJECTED.draft, course_id: REJECTED.course_id });
    expect(refused).toMatchObject({ isError: true, body: { ok: false, resend: "scenes", fix_scenes: [8], draft_id: expect.stringMatching(/^dr-/) } });
    expect(refused.body["errors"]).toEqual([{ path: "scenes.8", message: "unknown field: markdown", hint: "remove it or fix its spelling" }]);
    await first.close();

    // The learner comes back later, to a new server process.
    const second = await startServer();
    const plan = (await second.call("get_study_plan", { learner_id: LEARNER, language: "fr", now_ms: afterGrace() })).body;
    expect(plan["next_step"]).toMatchObject({ action: "finish", tool: "get_authoring_guide", arguments: { language: "fr" } });
    expect(plan["unfinished_build"]).toMatchObject({ draft_id: refused.body["draft_id"], fix_scenes: [8], sources: [PREPARE.sources[0]!.title] });
    expect(String(plan["display_markdown"]).replace(/[\u00a0\u202f]/g, " ")).toContain("La photosynthèse : notes de cours (L1)");
    expect(JSON.stringify(plan)).not.toContain("model_explanation");

    // The plan gives the arguments that prepare the same sources again, and so the same source set.
    const again = await second.call("prepare_sources", plan["unfinished_build"]["prepare_sources"]);
    expect(again.body["source_set_id"]).toBe(prepared.body["source_set_id"]);
    const created = await second.call("create_lesson", {
      source_set_id: again.body["source_set_id"], draft_id: plan["unfinished_build"]["draft_id"],
      scenes: [{ at: 8, ...ACCEPTED.draft["scenes"][8] }],
    });
    expect(created).toMatchObject({ isError: false, body: { ok: true, course_ref: "photosynthese/lesson.json" } });
    const after = (await second.call("get_study_plan", { learner_id: LEARNER, language: "fr", now_ms: afterGrace() })).body;
    expect(after["unfinished_build"]).toBeNull();
    expect(after["next_step"]["action"]).not.toBe("finish");
    await second.close();
  });

  it("drops an unfinished build the learner does not want: create_lesson {source_set_id, discard: true}", async () => {
    const server = await startServer();
    const other = join(notesDir, "calvin.md");
    writeFileSync(other, readFileSync(notes, "utf8").split("## Facteurs limitants")[0]!, "utf8");
    const prepared = await server.call("prepare_sources", { sources: [{ path: other, title: "Le cycle de Calvin" }], language: "fr" });
    const plan = (await server.call("get_study_plan", { learner_id: LEARNER, language: "fr", now_ms: afterGrace() })).body;
    expect(plan["unfinished_build"]).toMatchObject({ source_set_id: prepared.body["source_set_id"], draft_id: null });
    const discarded = await server.call("create_lesson", { source_set_id: prepared.body["source_set_id"], discard: true });
    expect(discarded).toMatchObject({ isError: false, body: { ok: true, discarded: prepared.body["source_set_id"] } });
    const after = (await server.call("get_study_plan", { learner_id: LEARNER, language: "fr", now_ms: afterGrace() })).body;
    expect(after["unfinished_build"]).toBeNull();
    await server.close();
  });

  it("takes either a draft or draft_id with scenes, and refuses both or neither in the {path, message, hint} shape", async () => {
    const server = await startServer();
    const prepared = await server.call("prepare_sources", { sources: [{ path: notes, title: PREPARE.sources[0]!.title }], language: "fr" });
    const id = prepared.body["source_set_id"];
    const scenes = [{ at: 8, ...ACCEPTED.draft["scenes"][8] }];
    const both = await server.call("create_lesson", { source_set_id: id, draft: REJECTED.draft, draft_id: "dr-0000000000000000", scenes });
    expect(both).toMatchObject({ isError: true, body: { ok: false, errors: [{ path: "draft_id", message: expect.stringContaining("not both") }] } });
    const neither = await server.call("create_lesson", { source_set_id: id });
    expect(neither).toMatchObject({ isError: true, body: { ok: false, errors: [{ path: "draft" }] } });
    const description = (await server.client.listTools()).tools.find((tool) => tool.name === "create_lesson")!.description!;
    for (const words of ["draft_id", "scenes: [{at", "only the scenes", "whole draft", "discard: true"]) expect(description).toContain(words);
    expect(description).toMatch(/no lesson is written/i);
    await server.close();
  });
});
