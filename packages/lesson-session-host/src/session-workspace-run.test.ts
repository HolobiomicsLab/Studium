// Learner-time RUN protocol over the file channel: Studium emits a non-answer-bearing run.json + a
// provision-&-run task; the (agentic) operator provisions + runs the capsule in the workspace and writes
// run_result.json; Studium ingests it as the learner's OWN executed result, gating advance on a passing
// run. Studium never executes — pure delegation. Here the test plays the operator (writes run_result.json).
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionHost } from "./host.js";
import { SessionWorkspace } from "./session-workspace.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(here, "..", "..", "..", "fixtures");
const BUNDLE = "capsule-run-demo/lesson.json"; // intro + reproduction-with-run_manifest

async function advanceToRepro(host: SessionHost, ws: SessionWorkspace, sessionId: string, dir: string) {
  await ws.writeStep(sessionId); // intro
  writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "ok" }));
  await ws.ingest(sessionId); // ack intro -> advance to s-repro (writes run.json)
}

describe("SessionWorkspace — learner-time run protocol (run.json / run_result.json)", () => {
  it("emits a non-answer-bearing run.json + provision-&-run task; withholds the author landmark", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const { sessionId } = await host.create(BUNDLE, "op");
    const dir = mkdtempSync(join(tmpdir(), "studium-run-"));
    const ws = new SessionWorkspace(host, dir);
    await advanceToRepro(host, ws, sessionId, dir);

    expect(existsSync(join(dir, "run.json"))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
    expect(manifest.cmd).toEqual(["python", "scripts/run.py"]);
    expect(manifest.expected_outputs).toContain("outputs/stats.csv");
    expect(JSON.stringify(manifest)).not.toContain("k_fit"); // NON-answer-bearing manifest

    const task = readFileSync(join(dir, "task.md"), "utf8");
    expect(task.toLowerCase()).toContain("run_result.json"); // operator told where to write
    expect(task).toContain("scripts/run.py"); // the command to run in the workspace
    expect(task).not.toContain("k_fit"); // author landmark withheld — the learner runs fresh
    const idx = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    expect(idx.entries.at(-1).status).toBe("awaiting_run");
  });

  it("ingests a PASSING run_result.json -> records the run and advances (you actually ran it)", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const { sessionId } = await host.create(BUNDLE, "op");
    const dir = mkdtempSync(join(tmpdir(), "studium-run-"));
    const ws = new SessionWorkspace(host, dir);
    await advanceToRepro(host, ws, sessionId, dir);

    writeFileSync(join(dir, "run_result.json"), JSON.stringify({
      ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457",
      artifacts: ["outputs/stats.csv", "figures/decay.png"],
      checks: [{ check: "file exists: outputs/stats.csv", passed: true }],
    }));
    const r = await ws.ingest(sessionId);
    expect(r.transition).toBe("complete"); // last scene -> done
    expect(r.done).toBe(true);
    expect(existsSync(join(dir, "run_result.json"))).toBe(false); // consumed
    const idx = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    expect(idx.entries.some((e: any) => e.scene_type === "reproduction" && e.status === "ran")).toBe(true);
  });

  it("self-heals: a missing run_result waits; a non-completed run is consumed + does NOT advance", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const { sessionId } = await host.create(BUNDLE, "op");
    const dir = mkdtempSync(join(tmpdir(), "studium-run-"));
    const ws = new SessionWorkspace(host, dir);
    await advanceToRepro(host, ws, sessionId, dir);

    const a = await ws.ingest(sessionId); // no run_result yet
    expect(a.done).toBe(false);
    expect(a.transition).toBe("awaiting_run");

    writeFileSync(join(dir, "run_result.json"), JSON.stringify({ ran: false, passed: false }));
    const b = await ws.ingest(sessionId);
    expect(b.done).toBe(false);
    expect(["run_incomplete", "run_failed_checks"]).toContain(b.transition);
    expect(existsSync(join(dir, "run_result.json"))).toBe(false); // consumed (retry fresh)
    expect(readFileSync(join(dir, "task.md"), "utf8")).toContain("scripts/run.py"); // still on the run scene

    writeFileSync(join(dir, "run_result.json"), JSON.stringify({
      ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212", artifacts: [], checks: [],
    }));
    const c = await ws.ingest(sessionId);
    expect(c.done).toBe(true);
  });

  it("wrong channel (operator writes response.json on a run scene) does NOT wedge — waits for run_result", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const { sessionId } = await host.create(BUNDLE, "op");
    const dir = mkdtempSync(join(tmpdir(), "studium-run-"));
    const ws = new SessionWorkspace(host, dir);
    await advanceToRepro(host, ws, sessionId, dir);

    // operator mistakenly writes a response.json (the judgment channel) on a RUN scene
    writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "j'ai lance le script" }));
    const a = await ws.ingest(sessionId);
    expect(a.transition).toBe("awaiting_run"); // ingestRun ignores response.json -> still waiting, no wedge
    expect(a.done).toBe(false);
    expect(readFileSync(join(dir, "feedback.md"), "utf8")).toContain(
      "run required: call get_run_manifest, run it, then submit_run_result",
    );

    // the correct run_result.json then advances
    writeFileSync(join(dir, "run_result.json"), JSON.stringify({ ran: true, passed: true, artifacts: [], checks: [] }));
    const b = await ws.ingest(sessionId);
    expect(b.done).toBe(true);
  });

  it("a failed-checks run (ran but not passed) surfaces the failing checks + does NOT advance", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const { sessionId } = await host.create(BUNDLE, "op");
    const dir = mkdtempSync(join(tmpdir(), "studium-run-"));
    const ws = new SessionWorkspace(host, dir);
    await advanceToRepro(host, ws, sessionId, dir);

    writeFileSync(join(dir, "run_result.json"), JSON.stringify({
      ran: true, passed: false, landmark: null, artifacts: [],
      checks: [{ check: "file exists: outputs/stats.csv", passed: false }],
    }));
    const r = await ws.ingest(sessionId);
    expect(r.transition).toBe("run_failed_checks");
    expect(r.done).toBe(false);
    expect(readFileSync(join(dir, "feedback.md"), "utf8")).toContain("outputs/stats.csv");
  });
});
