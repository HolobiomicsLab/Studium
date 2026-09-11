import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";
import { SessionWorkspace } from "./session-workspace.js";
import { operatorContext } from "./operator-context.js";
import { runStudiumSession } from "./session-runner.js";

const dirs: string[] = [];
function dir() { const d = mkdtempSync(join(tmpdir(), "host-experiment-")); dirs.push(d); return d; }
afterEach(() => { vi.unstubAllEnvs(); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
const bundle = {
  schema_version: "1.4", bundle_id: "experiment", source_plan_id: "p",
  metadata: { title: "Experiment", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "Comparison", description: "Compare representations", bloom_level_target: "understand" }],
  scenes: [{ id: "s1", type: "intro", title: "Predict", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "Try" }],
  rules: [], validated_by: "teacher", validated_at: "2026-09-11T00:00:00Z",
};
const prediction = { kind: "predict", experiment_id: "e1", prediction: "  private prediction\n", justification: "because", confidence: 2, authorship: "learner", consent: true };

it("resumes learner contributions across hosts, isolates learners/revisions and forgets", async () => {
  const root = dir(); const data = dir();
  writeFileSync(join(root, "lesson.json"), JSON.stringify(bundle));
  vi.stubEnv("STUDIUM_DATA_DIR", data); vi.stubEnv("STUDIUM_PSEUDO_SECRET", "journal-test-secret");
  const first = new SessionHost({ bundlesRoot: root, live: false });
  const { sessionId } = await first.create("lesson.json", "alice");
  const state = structuredClone(first.getState(sessionId));
  first.recordExperiment(sessionId, prediction);
  expect(first.getState(sessionId)).toEqual(state);
  expect(JSON.stringify(operatorContext(first, sessionId))).not.toContain("private prediction");
  const second = new SessionHost({ bundlesRoot: root, live: false });
  const resumed = await second.create("lesson.json", "alice");
  expect(second.experimentJournal(resumed.sessionId).experiments[0]?.events[0]?.input).toEqual(prediction);
  second.recordExperiment(resumed.sessionId, { kind: "begin", experiment_id: "e1" });
  const bob = await second.create("lesson.json", "bob");
  expect(second.experimentJournal(bob.sessionId).experiments).toEqual([]);
  writeFileSync(join(root, "lesson.json"), JSON.stringify({ ...bundle, metadata: { ...bundle.metadata, title: "Revised" } }));
  const newer = await second.create("lesson.json", "alice");
  expect(second.experimentJournal(newer.sessionId).experiments).toEqual([]);
  second.recordExperiment(newer.sessionId, prediction);
  await second.forget(newer.sessionId);
  expect(second.experimentJournal(resumed.sessionId).experiments).toEqual([]);
  expect(() => second.experimentJournal(newer.sessionId)).toThrow(/not found/);
});

it("uses the file channel without grading, preserves retries and clears stale private exports", async () => {
  vi.stubEnv("STUDIUM_DATA_DIR", "");
  const root = dir(); const workspace = dir();
  writeFileSync(join(root, "lesson.json"), JSON.stringify(bundle));
  const host = new SessionHost({ bundlesRoot: root, live: false });
  const { sessionId } = await host.create("lesson.json", "alice");
  const files = new SessionWorkspace(host, workspace);
  await files.writeStep(sessionId);
  writeFileSync(join(workspace, "experiment-action.json"), JSON.stringify({ session_id: sessionId, scene_id: "s1", input: prediction }));
  expect(await files.ingest(sessionId)).toEqual({ done: false, transition: "experiment_recorded" });
  expect(host.currentPresentation(sessionId).scene.id).toBe("s1");
  expect(existsSync(join(workspace, "experiment-action.json"))).toBe(false);
  const snapshot = JSON.parse(readFileSync(join(workspace, "experiment.json"), "utf8"));
  expect(snapshot.experiments[0].events[0].input.prediction).toBe(prediction.prediction);
  writeFileSync(join(workspace, "experiment-action.json"), JSON.stringify({ session_id: sessionId, scene_id: "s1", input: { ...prediction, prediction: "rewritten" } }));
  expect((await files.ingest(sessionId)).transition).toBe("invalid_experiment");
  const other = await host.create("lesson.json", "bob");
  await files.writeStep(other.sessionId);
  expect(existsSync(join(workspace, "experiment.json"))).toBe(false);
  writeFileSync(join(workspace, "experiment-action.json"), JSON.stringify({ session_id: sessionId, scene_id: "s1", input: prediction }));
  expect((await files.ingest(other.sessionId)).transition).toBe("invalid_experiment");
  expect(host.experimentJournal(other.sessionId).experiments).toEqual([]);
});

it("completes an opt-in file experiment then a lesson response without conflating the two", async () => {
  vi.stubEnv("STUDIUM_DATA_DIR", "");
  const root = dir(); const workspace = dir();
  writeFileSync(join(root, "lesson.json"), JSON.stringify(bundle));
  const host = new SessionHost({ bundlesRoot: root, live: false });
  const actions = [prediction, { kind: "begin", experiment_id: "e1" },
    { kind: "observe", experiment_id: "e1", text: "Synthetic test observation", authorship: "learner", consent: true },
    { kind: "conclude", experiment_id: "e1", text: "Synthetic test conclusion", confidence: 2, authorship: "learner", consent: true }];
  const result = await runStudiumSession(host, "lesson.json", workspace, async (_task, ctx) => {
    const action = actions[ctx.step];
    if (action) writeFileSync(join(ctx.dir, "experiment-action.json"), JSON.stringify({ session_id: ctx.sessionId, scene_id: "s1", input: action }));
    else writeFileSync(join(ctx.dir, "response.json"), JSON.stringify({ kind: "ack" }));
  }, { learnerId: "synthetic-test", maxSteps: 5 });
  expect(result.completed).toBe(true);
  expect(result.transitions).toEqual(["experiment_recorded", "experiment_recorded", "experiment_recorded", "experiment_recorded", "complete"]);
  expect(host.experimentJournal(result.sessionId).experiments[0]?.events).toHaveLength(4);
});

it("does not persist private text under the shared anonymous identity", async () => {
  vi.stubEnv("STUDIUM_DATA_DIR", dir());
  vi.stubEnv("STUDIUM_PSEUDO_SECRET", "journal-test-secret");
  const root = dir(); writeFileSync(join(root, "lesson.json"), JSON.stringify(bundle));
  const host = new SessionHost({ bundlesRoot: root, live: false });
  const first = await host.create("lesson.json");
  host.recordExperiment(first.sessionId, prediction);
  expect(host.experimentJournal(first.sessionId).storage).toBe("ephemeral");
  const other = await host.create("lesson.json");
  expect(host.experimentJournal(other.sessionId).experiments).toEqual([]);
});
