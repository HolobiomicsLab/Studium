// apps/lesson-server/src/bundle-resolver.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBundle } from "./bundle-resolver.js";

const MINI = {
  schema_version: "1.4", bundle_id: "mini-001", source_plan_id: "p",
  metadata: { title: "M", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [{ id: "s0", type: "intro", title: "I", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "hi" }],
  rules: [], validated_by: "teacher", validated_at: "2026-06-10T08:00:00Z",
};

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "br-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("resolveBundle", () => {
  it("loads a .json bundle within the root", async () => {
    const root = tmp();
    writeFileSync(join(root, "mini.json"), JSON.stringify(MINI));
    const b = await resolveBundle(root, "mini.json");
    expect(b.bundle_id).toBe("mini-001");
  });
  it("rejects path traversal escaping the root", async () => {
    const root = tmp();
    await expect(resolveBundle(root, "../../etc/passwd")).rejects.toThrow(/escapes/);
  });
});
