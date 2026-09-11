import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionHost } from "./host.js";
import { operatorContext } from "./operator-context.js";
import { SessionWorkspace } from "./session-workspace.js";

describe("harness exploration context", () => {
  it("gives both transports the same discovery contract without advancing a real fixture", async () => {
    const host = new SessionHost({ bundlesRoot: resolve("../../fixtures"), live: false });
    const { sessionId } = await host.create("capsule-loop-demo/lesson.json", "synthetic-audit");
    const before = JSON.stringify(host.currentPresentation(sessionId));
    const context = operatorContext(host, sessionId);
    expect(context.exploration.capabilities).toBe("discover-in-current-harness");
    expect(context.exploration.workflow).toEqual(["predict", "baseline", "vary", "compare", "judge", "transfer"]);
    expect(context.exploration.recordTool).toBe("tools/experience_exploration.py");
    expect(context.exploration.instructions).toContain("official documentation");
    expect(context.exploration.instructions).toContain("not submitted");
    const directory = await mkdtemp(join(tmpdir(), "studium-exploration-"));
    try {
      await new SessionWorkspace(host, directory).writeStep(sessionId);
      const task = await readFile(join(directory, "task.md"), "utf8");
      const block = task.match(/<!-- studium-operator-context -->\n```json\n([\s\S]*?)\n```/);
      expect(JSON.parse(block![1]!)).toEqual(context);
      expect(JSON.stringify(host.currentPresentation(sessionId))).toBe(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
