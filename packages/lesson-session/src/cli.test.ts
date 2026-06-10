// packages/lesson-session/src/cli.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runPlaythrough } from "./cli.js";

const bundleJson = fileURLToPath(new URL("./fixtures/all-scene-types.json", import.meta.url));
const script = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/scripts/all-types-happy.json", import.meta.url)), "utf8"));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("CLI runPlaythrough", () => {
  it("plays the all-scene-types bundle end-to-end (stub LLM) and writes telemetry", async () => {
    const out = mkdtempSync(join(tmpdir(), "play-")); dirs.push(out);
    const res = await runPlaythrough({ bundlePath: bundleJson, script, outDir: out, live: false });
    expect(res.completed).toBe(true);
    expect(res.summary?.scenesCompleted).toBeGreaterThanOrEqual(8);
    expect(existsSync(join(out, "telemetry.jsonl"))).toBe(true);
    expect(existsSync(join(out, "events.jsonl"))).toBe(true);
  });
});
