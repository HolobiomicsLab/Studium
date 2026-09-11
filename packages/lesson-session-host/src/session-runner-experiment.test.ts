import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchOperator } from "./session-runner.js";

it("wakes a file-runner waiting for results when a learner experiment action arrives", async () => {
  const dir = await mkdtemp(join(tmpdir(), "experiment-watch-"));
  try {
    await writeFile(join(dir, "experiment-action.json"), JSON.stringify({ session_id: "s", scene_id: "scene", input: { kind: "begin", experiment_id: "e" } }));
    await expect(watchOperator({ timeoutMs: 30, pollMs: 5 })("task", { dir, sessionId: "s", sceneType: "reproduction", step: 0, expects: "run" })).resolves.toBeUndefined();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
