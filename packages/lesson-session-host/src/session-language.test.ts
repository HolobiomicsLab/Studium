import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionHost } from "./host.js";
import { operatorContext } from "./operator-context.js";
import { SessionWorkspace } from "./session-workspace.js";

const directories: string[] = [];

async function start(language?: string) {
  const directory = await mkdtemp(join(tmpdir(), "session-language-"));
  directories.push(directory);
  await writeFile(join(directory, "lesson.json"), JSON.stringify({
    schema_version: "1.4", bundle_id: "language-test", source_plan_id: "plan",
    metadata: { title: "Source title", target: "L1", duration_minutes: 5, language: "en", discipline: "Chemistry" },
    concepts: [{ id: "c", title: "Source concept", description: "Source description", bloom_level_target: "understand" }],
    scenes: [
      { id: "intro", type: "intro", title: "Source scene", markdown: "Original H2O at 10 mg/L.", concept_refs: ["c"], objective_refs: [], estimated_seconds: 10, adaptation_hooks: [] },
      { id: "done", type: "concept", title: "Second source scene", markdown: "Original remains.", concept_refs: ["c"], objective_refs: [], estimated_seconds: 10, adaptation_hooks: [] },
    ], rules: [], validated_by: "test", validated_at: "2026-09-12T00:00:00Z",
  }));
  const host = new SessionHost({ bundlesRoot: directory, live: false });
  const result = await host.create("lesson.json", "learner", language);
  return { directory, host, sessionId: result.sessionId };
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("session presentation language", () => {
  it("selects at start, changes on demand, survives scene advance, and resets to source", async () => {
    const { host, sessionId } = await start("fr-ca");
    expect(operatorContext(host, sessionId).language).toMatchObject({
      source_language: "en", selected_language: "fr-CA", effective_language: "fr-CA", translation_required: true,
    });
    const presentation = JSON.stringify(host.currentPresentation(sessionId));
    const state = JSON.stringify(host.getState(sessionId));
    expect(host.setPresentationLanguage(sessionId, "es-419").selected_language).toBe("es-419");
    expect(JSON.stringify(host.currentPresentation(sessionId))).toBe(presentation);
    expect(JSON.stringify(host.getState(sessionId))).toBe(state);
    await host.respond(sessionId, { kind: "ack" });
    expect(operatorContext(host, sessionId).language.selected_language).toBe("es-419");
    expect(host.setPresentationLanguage(sessionId, null)).toMatchObject({
      source_language: "en", selected_language: null, effective_language: "en", translation_required: false,
    });
  });

  it("rejects invalid input without changing source content, state, or the last valid preference", async () => {
    const { host, sessionId } = await start("fr");
    const presentation = JSON.stringify(host.currentPresentation(sessionId));
    const state = JSON.stringify(host.getState(sessionId));
    expect(() => host.setPresentationLanguage(sessionId, "not_a_language")).toThrow(/BCP 47/);
    expect(operatorContext(host, sessionId).language.selected_language).toBe("fr");
    expect(JSON.stringify(host.currentPresentation(sessionId))).toBe(presentation);
    expect(JSON.stringify(host.getState(sessionId))).toBe(state);
  });

  it("handles the same operation through the file channel without exposing private fields", async () => {
    const { directory, host, sessionId } = await start();
    const workspace = new SessionWorkspace(host, directory);
    await workspace.writeStep(sessionId);
    await writeFile(join(directory, "session-language.json"), JSON.stringify({
      session_id: sessionId, presentation_language: "de-DE", answer_key: "PRIVATE-KEY",
    }));
    expect((await workspace.ingest(sessionId)).transition).toBe("invalid_session_language");
    expect(operatorContext(host, sessionId).language.selected_language).toBeNull();
    expect(await readFile(join(directory, "feedback.md"), "utf8")).not.toContain("PRIVATE-KEY");

    await writeFile(join(directory, "session-language.json"), JSON.stringify({
      session_id: sessionId, presentation_language: "de-DE",
    }));
    const presentation = JSON.stringify(host.currentPresentation(sessionId));
    const index = await readFile(join(directory, "index.json"), "utf8");
    expect((await workspace.ingest(sessionId)).transition).toBe("session_language_changed");
    expect(JSON.stringify(host.currentPresentation(sessionId))).toBe(presentation);
    expect(await readFile(join(directory, "index.json"), "utf8")).toBe(index);
    const task = await readFile(join(directory, "task.md"), "utf8");
    const block = task.match(/<!-- studium-operator-context -->\n```json\n([\s\S]*?)\n```/);
    expect(JSON.parse(block![1]!).language).toEqual(operatorContext(host, sessionId).language);
    expect(task).toContain("Original H2O at 10 mg/L.");
  });

  it("refreshes an active run scene without consuming queued operator files", async () => {
    const bundlesRoot = resolve(fileURLToPath(new URL("../../../fixtures/", import.meta.url)));
    const host = new SessionHost({ bundlesRoot, live: false });
    const { sessionId } = await host.create("capsule-run-demo/lesson.json", "language-run");
    const directory = await mkdtemp(join(tmpdir(), "session-language-run-"));
    directories.push(directory);
    const workspace = new SessionWorkspace(host, directory);
    await workspace.writeStep(sessionId);
    await writeFile(join(directory, "response.json"), '{"kind":"ack"}\n');
    await workspace.ingest(sessionId);
    expect(host.currentPresentation(sessionId).scene.type).toBe("reproduction");

    const queued = {
      "run.json": "existing outbound run instructions\n",
      "run_result.json": '{"ran":true,"passed":true,"artifacts":[],"checks":[]}\n',
      "response.json": '{"text":"queued learner answer"}\n',
      "experiment-action.json": '{"queued":"learner experiment"}\n',
    };
    for (const [name, content] of Object.entries(queued)) await writeFile(join(directory, name), content);
    await writeFile(join(directory, "session-language.json"), JSON.stringify({
      session_id: sessionId, presentation_language: "it",
    }));
    const index = await readFile(join(directory, "index.json"), "utf8");

    expect((await workspace.ingest(sessionId)).transition).toBe("session_language_changed");
    for (const [name, content] of Object.entries(queued)) {
      expect(await readFile(join(directory, name), "utf8")).toBe(content);
    }
    expect(await readFile(join(directory, "index.json"), "utf8")).toBe(index);
    expect(host.currentPresentation(sessionId).scene.type).toBe("reproduction");
  });

  it("does not report a task refresh filesystem failure as an invalid language", async () => {
    const { directory, host, sessionId } = await start();
    const workspace = new SessionWorkspace(host, directory);
    await workspace.writeStep(sessionId);
    await writeFile(join(directory, "session-language.json"), JSON.stringify({
      session_id: sessionId, presentation_language: "nl",
    }));
    await rm(join(directory, "task.md"));
    await mkdir(join(directory, "task.md"));

    await expect(workspace.ingest(sessionId)).rejects.toThrow();
    expect(host.sessionLanguage(sessionId).selected_language).toBe("nl");
    expect(await readFile(join(directory, "feedback.md"), "utf8").catch(() => "")).not.toContain("Invalid session");
  });
});
