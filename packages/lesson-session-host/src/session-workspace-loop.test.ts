// End-to-end operation->judgment loop over the file channel: the operator RUNS the capsule (run_result),
// Studium records the learner's run, and the LATER spot_the_flaw is grounded on THAT run — the learner
// audits a flawed AI reading of the result they produced, which feeds trust_calibration.
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionHost } from "./host.js";
import { SessionWorkspace } from "./session-workspace.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(here, "..", "..", "..", "fixtures");
const BUNDLE = "capsule-loop-demo/lesson.json"; // intro + reproduction(run_manifest) + spot_the_flaw(reference_from_run)

describe("operation->judgment loop — ground a spot_the_flaw on the learner's OWN run", () => {
  it("the learner's run grounds the later judgment (its landmark is surfaced) and feeds trust_calibration", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const { sessionId } = await host.create(BUNDLE, "op");
    const dir = mkdtempSync(join(tmpdir(), "studium-loop-"));
    const ws = new SessionWorkspace(host, dir);

    // intro -> ack
    await ws.writeStep(sessionId);
    writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "ok" }));
    await ws.ingest(sessionId);

    // run scene: operator provisions+runs, writes run_result with THEIR landmark
    expect(readFileSync(join(dir, "task.md"), "utf8")).toContain("scripts/run.py");
    writeFileSync(join(dir, "run_result.json"), JSON.stringify({
      ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457",
      artifacts: ["outputs/stats.csv", "figures/decay.png"],
      checks: [{ check: "file exists: outputs/stats.csv", passed: true }],
    }));
    await ws.ingest(sessionId); // records the learner run + advances to s-flaw

    // the judgment task is grounded on the LEARNER's run — its landmark is the surfaced evidence
    const flawTask = readFileSync(join(dir, "task.md"), "utf8");
    expect(flawTask).toContain("spot_the_flaw");
    expect(flawTask).toContain("k_fit=0.4212"); // the learner's OWN landmark, surfaced as the evidence
    expect(flawTask).not.toContain("flaws_expected"); // answer key still redacted
    expect(flawTask).not.toContain("model_correction");

    // operator audits the flawed reading of their own run -> graded -> trust_calibration fed
    writeFileSync(join(dir, "response.json"), JSON.stringify({
      text: "k a des unites (1/temps), ce n'est pas sans dimension ; la demi-vie vaut ln2/k, pas une heure.",
    }));
    const r = await ws.ingest(sessionId);
    expect(["next", "complete"]).toContain(r.transition);

    const cs = (host.getState(sessionId) as { concept_states: Record<string, { trust_calibration_samples?: number }> })
      .concept_states["c-kinetics"];
    expect(cs?.trust_calibration_samples).toBeGreaterThanOrEqual(1); // judging YOUR OWN run fed trust
  });
});
