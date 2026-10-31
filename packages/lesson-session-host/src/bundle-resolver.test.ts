// packages/lesson-session-host/src/bundle-resolver.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { resolveBundle, loadResolvedBundle } from "./bundle-resolver.js";

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

// HJ-3 / C6: the learner's library is a second root, searched after BUNDLES_ROOT, read at call time
// (a lesson written after the server started plays at once) and confined like the first.
describe("loadResolvedBundle — bundles root, then the library", () => {
  function lessonIn(root: string, ref: string, bundleId = "mini-001"): string {
    const path = join(root, ref);
    mkdirSync(join(path, ".."), { recursive: true });
    const text = JSON.stringify({ ...MINI, bundle_id: bundleId });
    writeFileSync(path, text);
    return text;
  }

  it("finds a lesson in the library when the bundles root lacks it, and reports where", async () => {
    const bundles = tmp();
    const library = tmp();
    const text = lessonIn(library, "photosynthese/lesson.json", "photo-001");
    const resolved = await loadResolvedBundle([bundles, library], "photosynthese/lesson.json");
    expect(resolved.bundle.bundle_id).toBe("photo-001");
    expect(resolved.root).toBe(library);
    expect(resolved.baseDir).toBe(join(library, "photosynthese"));
    expect(resolved.sha256).toBe(createHash("sha256").update(text).digest("hex"));
  });

  it("prefers the bundles root when both hold the ref", async () => {
    const bundles = tmp();
    const library = tmp();
    lessonIn(bundles, "x/lesson.json", "from-bundles");
    lessonIn(library, "x/lesson.json", "from-library");
    expect((await loadResolvedBundle([bundles, library], "x/lesson.json")).bundle.bundle_id).toBe("from-bundles");
  });

  it("accepts a course folder for its lesson.json", async () => {
    const library = tmp();
    lessonIn(library, "photosynthese/lesson.json", "photo-001");
    expect((await loadResolvedBundle([library], "photosynthese")).bundle.bundle_id).toBe("photo-001");
  });

  it("sees a lesson written after the first lookup (no cache, no restart)", async () => {
    const library = tmp();
    await expect(loadResolvedBundle([library], "later/lesson.json")).rejects.toThrow(/not found/);
    lessonIn(library, "later/lesson.json", "later-001");
    expect((await loadResolvedBundle([library], "later/lesson.json")).bundle.bundle_id).toBe("later-001");
  });

  it("confines every root: traversal and a symlink leaving the root are refused", async () => {
    const bundles = tmp();
    const library = tmp();
    const outside = tmp();
    lessonIn(outside, "secret/lesson.json");
    await expect(loadResolvedBundle([bundles, library], "../../etc/passwd")).rejects.toThrow(/escapes/);
    symlinkSync(join(outside, "secret"), join(library, "link"));
    await expect(loadResolvedBundle([bundles, library], "link/lesson.json")).rejects.toThrow(/escapes/);
  });

  it("a missing lesson names the ref, never an absolute path, and suggests the closest refs", async () => {
    const bundles = tmp();
    lessonIn(bundles, "atomistique-l1/lesson.json");
    const error = await loadResolvedBundle([bundles], "atomistique/lesson.json").then(() => null, (e: Error) => e);
    expect(error?.message).toMatch(/^lesson not found: atomistique\/lesson\.json/);
    expect(error?.message).toContain("atomistique-l1/lesson.json");
    expect(error?.message).toContain("list_lessons");
    expect(error?.message).not.toContain(bundles);
  });

  it("an invalid lesson says which ref and what is wrong, in one short line", async () => {
    const bundles = tmp();
    mkdirSync(join(bundles, "broken"));
    writeFileSync(join(bundles, "broken", "lesson.json"), JSON.stringify({ ...MINI, scenes: "nope" }));
    const error = await loadResolvedBundle([bundles], "broken/lesson.json").then(() => null, (e: Error) => e);
    expect(error?.message).toMatch(/^lesson broken\/lesson\.json does not match the bundle schema: scenes/);
    // RT-7: the first issue in words, with what to change (formatBundleError), not Zod's raw message.
    expect(error?.message).toContain("scenes: expected array, got string — give an array");
    expect(error?.message.split("\n")).toHaveLength(1);
    expect(error?.message).not.toContain(bundles);
  });
});
