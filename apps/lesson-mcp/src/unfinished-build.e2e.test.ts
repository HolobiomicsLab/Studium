// apps/lesson-mcp/src/unfinished-build.e2e.test.ts
//
// D4 (waiting review 2026-11-25, owner's decision 3) through the real server, the host of the stdio
// entry point under a temporary STUDIUM_HOME: Studium keeps a refused draft, the assistant resends only
// the faulty scene with draft_id, and after a restart get_study_plan offers to finish a build that
// stopped. The drafts replayed are the two create_lesson calls recorded in OpenCode (fixture of the
// authoring-draft package): the first was refused for an unknown field in scene 8.
//
// Review of D4 (M1, M2): only a kept draft is offered, to the learner it was refused for (create_lesson
// takes learner_id), never sources prepared with nothing kept; forget_session {learner_id} erases that
// learner's drafts, and on a fresh install nothing is offered afterwards.
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
const homes: string[] = [home, notesDir];
afterAll(() => { for (const dir of homes) rmSync(dir, { recursive: true, force: true }); });
/** A STUDIUM_HOME no server has used yet. */
function freshHome(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "studium-d4-fresh-")));
  homes.push(dir);
  return dir;
}
const notes = join(notesDir, "photosynthese.md");
writeFileSync(notes, readFileSync(join(FIXTURE, "notes.txt"), "utf8"), "utf8");

type Json = Record<string, any>;
async function startServer(studiumHome = home, env: Record<string, string> = {}) {
  const { host } = hostFromEnvironment({ STUDIUM_HOME: studiumHome, ...env }, "/nonexistent-home");
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
    // Changed (review of D4): the refused call names its learner, so the draft is offered to them only.
    const refused = await first.call("create_lesson", {
      source_set_id: prepared.body["source_set_id"], draft: REJECTED.draft, course_id: REJECTED.course_id, learner_id: LEARNER,
    });
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

  // Changed (review of D4, M1): sources prepared with nothing kept are no longer offered, so the build the
  // learner drops is a draft refused for them; then forget offers nothing either (dismiss, then forget).
  it("drops an unfinished build the learner does not want: create_lesson {source_set_id, learner_id, discard: true}; forget offers nothing after", async () => {
    const server = await startServer();
    const other = join(notesDir, "calvin.md");
    writeFileSync(other, readFileSync(notes, "utf8").split("## Facteurs limitants")[0]!, "utf8");
    const prepared = await server.call("prepare_sources", { sources: [{ path: other, title: "Le cycle de Calvin" }], language: "fr" });
    const before = (await server.call("get_study_plan", { learner_id: LEARNER, language: "fr", now_ms: afterGrace() })).body;
    expect(before["unfinished_build"]).toBeNull();
    const refused = await server.call("create_lesson", { source_set_id: prepared.body["source_set_id"], draft: REJECTED.draft, learner_id: LEARNER });
    expect(refused.isError).toBe(true);
    const plan = (await server.call("get_study_plan", { learner_id: LEARNER, language: "fr", now_ms: afterGrace() })).body;
    expect(plan["unfinished_build"]).toMatchObject({ source_set_id: prepared.body["source_set_id"], sources: ["Le cycle de Calvin"] });
    const discarded = await server.call("create_lesson", { source_set_id: prepared.body["source_set_id"], learner_id: LEARNER, discard: true });
    expect(discarded).toMatchObject({ isError: false, body: { ok: true, discarded: prepared.body["source_set_id"] } });
    const after = (await server.call("get_study_plan", { learner_id: LEARNER, language: "fr", now_ms: afterGrace() })).body;
    expect(after["unfinished_build"]).toBeNull();
    await server.call("forget_session", { learner_id: LEARNER, language: "fr" });
    const forgotten = (await server.call("get_study_plan", { learner_id: LEARNER, language: "fr", now_ms: afterGrace() })).body;
    expect(forgotten["unfinished_build"]).toBeNull();
    expect(forgotten["next_step"]["action"]).not.toBe("finish");
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
    for (const words of ["draft_id", "scenes: [{at", "only the scenes", "whole draft", "discard: true", "learner_id"]) expect(description).toContain(words);
    expect(description).toMatch(/no lesson is written/i);
    await server.close();
  });
});

describe("a kept draft belongs to the learner it was refused for (review of D4, M1 and M2)", () => {
  it("offers it to that learner only, on a library two learners share, and forget erases only theirs", async () => {
    const shared = freshHome();
    const server = await startServer(shared);
    const prepared = await server.call("prepare_sources", {
      sources: [{ path: notes, title: PREPARE.sources[0]!.title }], goal: PREPARE.goal, language: PREPARE.language,
    });
    const id = prepared.body["source_set_id"];
    const ana = await server.call("create_lesson", { source_set_id: id, draft: REJECTED.draft, learner_id: "ana" });
    const bob = await server.call("create_lesson", { source_set_id: id, draft: { ...REJECTED.draft, title: "La photosynthèse, version de Bob" }, learner_id: "bob" });
    expect(ana.body["draft_id"]).toMatch(/^dr-/);
    expect(bob.body["draft_id"]).not.toBe(ana.body["draft_id"]);
    const plan = async (learner?: string) =>
      (await server.call("get_study_plan", { ...(learner ? { learner_id: learner } : {}), language: "fr", now_ms: afterGrace() })).body;
    expect((await plan("ana"))["unfinished_build"]).toMatchObject({ draft_id: ana.body["draft_id"] });
    expect((await plan("bob"))["unfinished_build"]).toMatchObject({ draft_id: bob.body["draft_id"] });
    // A call that names no learner, on a server with no STUDIUM_LEARNER_ID, sees no one's goal or file.
    const nobody = await plan();
    expect(nobody["unfinished_build"]).toBeNull();
    expect(JSON.stringify(nobody)).not.toContain(notes);
    expect(JSON.stringify(nobody)).not.toContain(PREPARE.goal);
    await server.call("forget_session", { learner_id: "bob", language: "fr" });
    expect((await plan("bob"))["unfinished_build"]).toBeNull();
    expect((await plan("ana"))["unfinished_build"]).toMatchObject({ draft_id: ana.body["draft_id"] });
    await server.call("forget_session", { learner_id: "ana", language: "fr" });
    expect((await plan("ana"))["unfinished_build"]).toBeNull();
    expect(existsSync(join(shared, "library", "_drafts"))).toBe(false);
    await server.close();
  });

  it("offers nothing after a forget on a fresh install, whether the refused draft named a learner or not", async () => {
    for (const learner of [undefined, "ana"]) {
      const fresh = freshHome();
      const diagnosis = join(notesDir, "secret-diagnosis.md");
      writeFileSync(diagnosis, readFileSync(notes, "utf8"), "utf8");
      const server = await startServer(fresh);
      const prepared = await server.call("prepare_sources", {
        sources: [{ path: diagnosis, title: "Mon dossier médical" }], goal: "comprendre mon diagnostic", language: "fr",
      });
      const refused = await server.call("create_lesson", {
        source_set_id: prepared.body["source_set_id"], draft: REJECTED.draft, ...(learner ? { learner_id: learner } : {}),
      });
      expect(refused.body["resend"]).toBe("scenes");
      expect(readdirSync(join(fresh, "library", "_drafts"))).toHaveLength(1);
      const forgotten = await server.call("forget_session", { learner_id: "ana", language: "fr" });
      expect(String(forgotten.body["display_markdown"])).toContain("brouillons de leçons inachevées");
      expect(existsSync(join(fresh, "library", "_drafts"))).toBe(false);
      const plan = (await server.call("get_study_plan", { learner_id: "ana", language: "fr", now_ms: afterGrace() })).body;
      expect(plan["unfinished_build"]).toBeNull();
      expect(plan["next_step"]["action"]).not.toBe("finish");
      expect(JSON.stringify(plan)).not.toContain("secret-diagnosis");
      expect(JSON.stringify(plan)).not.toContain("diagnostic");
      await server.close();
    }
  });

  it("never offers sources prepared with nothing kept: a prepared source set is not an unfinished build", async () => {
    const fresh = freshHome();
    const server = await startServer(fresh);
    await server.call("prepare_sources", { sources: [{ path: notes, title: "Photo" }], goal: "comprendre mon diagnostic", language: "fr" });
    const plan = (await server.call("get_study_plan", { learner_id: "ana", language: "fr", now_ms: afterGrace() })).body;
    expect(plan["unfinished_build"]).toBeNull();
    expect(plan["next_step"]["action"]).not.toBe("finish");
    await server.close();
  });
});

// Integration of D1 and the review of D4: on the server the Studium VS Code extension offers to Copilot, the editor
// names the learner and a learner_id the model passes is ignored; a refused draft is then kept for the editor's
// learner, so their study plan offers it and their discard drops it.
describe("a kept draft when the editor names the learner (D1 with the review of D4)", () => {
  const EDITOR = { STUDIUM_OPEN_LINK: "vscode://holobiomicslab.studium-vscode/open?bundle=", STUDIUM_LEARNER_ID: "vscode-learner" };

  it("keeps it for the editor's learner, whatever learner_id the model passes, and drops it on their discard", async () => {
    const server = await startServer(freshHome(), EDITOR);
    const prepared = await server.call("prepare_sources", {
      sources: [{ path: notes, title: PREPARE.sources[0]!.title }], goal: PREPARE.goal, language: PREPARE.language,
    });
    const id = prepared.body["source_set_id"];
    const refused = await server.call("create_lesson", { source_set_id: id, draft: REJECTED.draft, learner_id: "lfx" });
    expect(refused.body["draft_id"]).toMatch(/^dr-/);
    const plan = async () => (await server.call("get_study_plan", { language: "fr", now_ms: afterGrace() })).body;
    const offered = await plan();
    expect(offered["next_step"]).toMatchObject({ action: "finish" });
    expect(offered["unfinished_build"]).toMatchObject({ draft_id: refused.body["draft_id"] });
    const discarded = await server.call("create_lesson", { source_set_id: id, learner_id: "someone-else", discard: true });
    expect(discarded).toMatchObject({ isError: false, body: { ok: true, discarded: id } });
    expect((await plan())["unfinished_build"]).toBeNull();
    await server.close();
  });
});
