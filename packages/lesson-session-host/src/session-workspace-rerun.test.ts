// A learner-time run scene revisited after its run was recorded (a graph detour brings the learner back)
// must not demand a fresh provision-and-run: the scene says the run is recorded, the file channel
// writes a response task, and an `ack` advances — while a fresh run_result.json still counts.
// Observed on the 2026-10-29 web-cases trial: the file channel re-emitted the full run task at step 5
// and the operator that remembered its run wedged.
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionHost } from "./host.js";
import { SessionWorkspace } from "./session-workspace.js";
import { publicScene } from "./public-scene.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(here, "..", "..", "..", "fixtures");
const BUNDLE = "capsule-run-demo/lesson.json"; // intro + reproduction-with-run_manifest

const PASSING_RUN = {
  ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457",
  artifacts: ["outputs/stats.csv", "figures/decay.png"],
  checks: [{ check: "file exists: outputs/stats.csv", passed: true }],
};

describe("run scene revisited after a recorded run", () => {
  it("runStatus and the public scene report the recorded run; an ack advances; a new run_result still ingests", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const { sessionId } = await host.create(BUNDLE, "op");
    await host.respond(sessionId, { kind: "ack" }); // intro -> s-repro
    expect(host.runStatus(sessionId)).toMatchObject({ learner_run_recorded: false, landmark: null });
    const scene = host.currentPresentation(sessionId).scene as { task_card_id?: string };
    expect(scene.task_card_id).toBeTruthy();

    // record the learner's run WITHOUT advancing (as a detour-return would leave it)
    host.recordLearnerRun(sessionId, scene.task_card_id!, {
      ran: true, passed: true, landmark: "k_fit=0.42", figure_path: null, checks: [],
      provenance: { capsule_doi: null, cmd: ["python", "scripts/run.py"], env: "test" },
    });
    const status = host.runStatus(sessionId);
    expect(status.learner_run_recorded).toBe(true);
    expect(status.landmark).toBe("k_fit=0.42");
    expect(status.run_manifest).not.toBeNull();
    const pub = publicScene(host.currentPresentation(sessionId).scene) as Record<string, unknown>;
    expect(pub.learner_run_recorded).toBe(true);
    expect(pub.learner_run_landmark).toBe("k_fit=0.42");

    // file channel: a response task (not a run task), index says awaiting_response, ack advances
    const dir = mkdtempSync(join(tmpdir(), "studium-rerun-"));
    const ws = new SessionWorkspace(host, dir);
    await ws.writeStep(sessionId);
    const task = readFileSync(join(dir, "task.md"), "utf8");
    // L-5 (group A, packages/lesson-session/src/phrases.ts): the engine's French phrase gained its accents.
    expect(task).toContain("Run déjà enregistré");
    expect(task).toContain("k_fit=0.42");
    expect(existsSync(join(dir, "run.json"))).toBe(false);
    const idx = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    expect(idx.entries.at(-1).status).toBe("awaiting_response");
    writeFileSync(join(dir, "response.json"), JSON.stringify({ kind: "ack" }));
    const r = await ws.ingest(sessionId);
    expect(r.transition).not.toBe("awaiting_run");
  });

  it("a fresh run_result.json on a revisited run scene is still ingested as a re-run", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const { sessionId } = await host.create(BUNDLE, "op");
    await host.respond(sessionId, { kind: "ack" });
    const scene = host.currentPresentation(sessionId).scene as { task_card_id?: string };
    host.recordLearnerRun(sessionId, scene.task_card_id!, {
      ran: true, passed: true, landmark: "old", figure_path: null, checks: [],
      provenance: { capsule_doi: null, cmd: [], env: "test" },
    });
    const dir = mkdtempSync(join(tmpdir(), "studium-rerun-"));
    const ws = new SessionWorkspace(host, dir);
    await ws.writeStep(sessionId);
    writeFileSync(join(dir, "run_result.json"), JSON.stringify(PASSING_RUN));
    const r = await ws.ingest(sessionId);
    expect(["ran", "next", "complete"]).toContain(r.transition);
  });
});
