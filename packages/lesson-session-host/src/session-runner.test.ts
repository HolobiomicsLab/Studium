import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionHost } from "./host.js";
import { runStudiumSession, stubOperator, watchOperator, type Operator } from "./session-runner.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = resolve(here, "..", "..", "..", "fixtures");
const BUNDLE = "capsule-judgment-demo/lesson.json"; // intro + 3 grounded spot_the_flaw

describe("session-runner — the operator harness", () => {
  it("drives a full session to completion with the stub operator, redaction held every step", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const dir = mkdtempSync(join(tmpdir(), "studium-run-"));

    // wrap the stub so we ALSO assert no answer key ever reaches the operator's task.md
    const noLeakThenStub: Operator = async (task, ctx) => {
      for (const leak of ["flaws_expected", "model_correction", "model_explanation", "\"claims\""]) {
        expect(task).not.toContain(leak);
      }
      await stubOperator(task, ctx);
    };

    const res = await runStudiumSession(host, BUNDLE, dir, noLeakThenStub);
    expect(res.completed).toBe(true);
    // H6 adds an explicit recall turn after each of the three spot_the_flaw scenes.
    expect(res.steps).toBe(7);                                  // intro + 3 answers + 3 recall ratings
    expect(res.transitions.filter((t) => t === "awaiting_recall")).toHaveLength(3);
    expect(res.transitions.at(-1)).toBe("complete");
    expect(res.transitions.filter((t) => t === "invalid_response").length).toBe(0);
    // the judgments were really graded into mastery
    expect(JSON.stringify(host.getState(res.sessionId))).toContain("c-kinetics");
  });

  it("watchOperator returns once an EXTERNAL response.json appears", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studium-watch-"));
    writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "audit ecrit par un agent externe" }));
    await expect(
      watchOperator({ pollMs: 10, timeoutMs: 1000 })("task", { dir, sessionId: "s", sceneType: "spot_the_flaw", step: 0 }),
    ).resolves.toBeUndefined();
  });

  it("watchOperator times out when no external response appears", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studium-watch-"));
    await expect(
      watchOperator({ pollMs: 10, timeoutMs: 60 })("task", { dir, sessionId: "s", sceneType: "spot_the_flaw", step: 0 }),
    ).rejects.toThrow(/timed out/);
  });
});
