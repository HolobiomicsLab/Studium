// runStudiumSession over a LEARNER-TIME RUN bundle: the harness routes a run scene to the operator
// (which provisions + runs in the workspace and writes run_result.json) and self-heals on a failed run.
// Studium never executes — the stub/operator stands in for the real agentic operator.
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionHost } from "./host.js";
import { runStudiumSession, stubOperator, writeRunResult, writeResponse, type Operator } from "./session-runner.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(here, "..", "..", "..", "fixtures");
const BUNDLE = "capsule-run-demo/lesson.json"; // intro + reproduction-with-run_manifest

describe("runStudiumSession — learner-time run scenes", () => {
  it("stubOperator provisions+runs (placeholder) and completes the run bundle", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const dir = mkdtempSync(join(tmpdir(), "studium-run-h-"));
    const r = await runStudiumSession(host, BUNDLE, dir, stubOperator, { maxSteps: 20 });
    expect(r.completed).toBe(true);
    expect(r.transitions.at(-1)).toBe("complete");
    const idx = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    expect(idx.entries.some((e: any) => e.scene_type === "reproduction" && e.status === "ran")).toBe(true);
  });

  it("a run operator that FAILS then PASSES self-heals (no wedge)", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const dir = mkdtempSync(join(tmpdir(), "studium-run-h-"));
    let runAttempts = 0;
    const operator: Operator = async (_task, ctx) => {
      if (ctx.expects === "run") {
        runAttempts += 1;
        const ok = runAttempts >= 2; // first run fails its checks, then passes
        await writeRunResult(ctx.dir, ok
          ? { ran: true, passed: true, landmark: "LANDMARK k_fit=0.42", artifacts: ["outputs/stats.csv"], checks: [{ check: "file exists: outputs/stats.csv", passed: true }] }
          : { ran: true, passed: false, artifacts: [], checks: [{ check: "file exists: outputs/stats.csv", passed: false }] });
        return;
      }
      await writeResponse(ctx.dir, { text: "ok" }); // intro ack
    };
    const r = await runStudiumSession(host, BUNDLE, dir, operator, { maxSteps: 20 });
    expect(r.completed).toBe(true);
    expect(runAttempts).toBeGreaterThanOrEqual(2); // the run was retried
    expect(r.transitions).toContain("run_failed_checks"); // first run failed and self-healed
  });
});
