import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionHost } from "./host.js";
import { SessionWorkspace } from "./session-workspace.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(here, "..", "..", "..", "fixtures"); // prototype-build/fixtures
const BUNDLE = "capsule-judgment-demo/lesson.json";           // intro + 3 capsule-grounded spot_the_flaw

describe("SessionWorkspace — file-based agentic session channel (.studium-session/)", () => {
  it("runs a full back-and-forth (intro ack -> grounded spot_the_flaw audit), REDACTED end to end", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const { sessionId } = await host.create(BUNDLE, "agent-operator");
    const dir = mkdtempSync(join(tmpdir(), "studium-session-"));
    const ws = new SessionWorkspace(host, dir);

    // --- step 0: Studium writes the intro task; index logs it as awaiting ---
    await ws.writeStep(sessionId);
    expect(readFileSync(join(dir, "task.md"), "utf8")).toContain("intro");
    let index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    expect(index.entries.at(-1).status).toBe("awaiting_response");
    expect(index.entries.at(-1).scene_type).toBe("intro");

    // --- operator acks the intro by writing {text} (Studium maps intro -> ack) ---
    writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "ok" }));
    let r = await ws.ingest(sessionId);
    expect(r.done).toBe(false);
    expect(existsSync(join(dir, "feedback.md"))).toBe(true);
    expect(existsSync(join(dir, "response.json"))).toBe(false); // consumed (no stale re-ingest)

    // --- now at the capsule-grounded spot_the_flaw step ---
    const flawTask = readFileSync(join(dir, "task.md"), "utf8");
    expect(flawTask).toContain("spot_the_flaw");
    expect(flawTask).toContain("k_fit=0.4212");          // the REAL executed landmark IS surfaced (evidence)
    expect(flawTask.toLowerCase()).toContain("demi-vie"); // the flawed AI reading IS shown
    expect(flawTask).toContain("decay.png");              // the real figure is referenced for native render
    // THE ANSWER KEY MUST NEVER REACH THE OPERATOR:
    expect(flawTask).not.toContain("flaws_expected");
    expect(flawTask).not.toContain("model_correction");
    expect(flawTask).not.toMatch(/k est un taux/);        // a model_correction VALUE phrase — must not leak

    // --- operator submits a judgment that catches the planted flaws (units + half-life) ---
    writeFileSync(join(dir, "response.json"), JSON.stringify({
      text: "La demi-vie n'est pas une heure : k est un taux par unite de temps, la demi-vie vaut ln2/k. Probleme d'unites.",
    }));
    r = await ws.ingest(sessionId);
    expect(["next", "replay", "remediate_alt", "calibration", "complete"]).toContain(r.transition);

    // feedback must not leak the reveal either
    expect(readFileSync(join(dir, "feedback.md"), "utf8")).not.toContain("model_correction");

    // --- the judgment was REALLY graded: index marks the spot_the_flaw step graded ---
    index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    expect(index.entries.some((e: any) => e.scene_type === "spot_the_flaw" && e.status === "graded")).toBe(true);
    expect(index.entries.some((e: any) => e.scene_type === "intro" && e.status === "graded")).toBe(true);

    // grading touched the concept's mastery state (host actually scored the judgment, not just logged it)
    expect(JSON.stringify(host.getState(sessionId))).toContain("c-kinetics");
  });

  it("self-heals on a malformed/mismatched response.json instead of wedging the session", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const { sessionId } = await host.create(BUNDLE, "operator-bad");
    const dir = mkdtempSync(join(tmpdir(), "studium-session-"));
    const ws = new SessionWorkspace(host, dir);

    // advance to the spot_the_flaw scene (ack the intro)
    await ws.writeStep(sessionId);
    writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "ok" }));
    await ws.ingest(sessionId);
    expect(readFileSync(join(dir, "task.md"), "utf8")).toContain("spot_the_flaw");

    // a structurally-bad explicit kind (no text to coerce) must NOT throw out of ingest...
    writeFileSync(join(dir, "response.json"), JSON.stringify({ kind: "flobble" }));
    const bad = await ws.ingest(sessionId);
    expect(bad.transition).toBe("invalid_response");
    expect(existsSync(join(dir, "response.json"))).toBe(false);           // the bad file was CONSUMED (no re-wedge)
    expect(readFileSync(join(dir, "feedback.md"), "utf8").toLowerCase()).toContain("invalide");
    // ...and the scene did NOT advance — still awaiting a valid response
    expect(readFileSync(join(dir, "task.md"), "utf8")).toContain("spot_the_flaw");

    // the operator can now retry with a valid response and the channel proceeds
    writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "demi-vie unites: k est un taux" }));
    const good = await ws.ingest(sessionId);
    expect(good.transition).not.toBe("invalid_response");
    expect(good.transition).not.toBe("awaiting");
  });

  it("never writes an answer-bearing field to task.md for ANY scene in the bundle", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const { sessionId } = await host.create(BUNDLE, "operator-2");
    const dir = mkdtempSync(join(tmpdir(), "studium-session-"));
    const ws = new SessionWorkspace(host, dir);

    await ws.writeStep(sessionId); // step 0; each ingest writes the NEXT task itself
    for (let i = 0; i < 6; i++) {
      const task = readFileSync(join(dir, "task.md"), "utf8");
      for (const leak of ["flaws_expected", "model_correction", "model_explanation", "\"claims\""]) {
        expect(task).not.toContain(leak);
      }
      writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "x" }));
      const { done } = await ws.ingest(sessionId);
      if (done) break;
    }
  });
});
