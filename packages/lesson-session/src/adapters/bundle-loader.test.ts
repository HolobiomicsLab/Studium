import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { LessonBundleSchema } from "@studium/lesson-bundle-schema";
import { BundleSchemaError, MAX_APPROVAL_JSON_BYTES, MAX_LESSON_JSON_BYTES, loadBundleJson, loadBundleZip, readBundleZip } from "./bundle-loader.js";

const m3 = fileURLToPath(new URL("../../../../fixtures/m3/demo-metabolomics-bundle.zip", import.meta.url));
const m6 = fileURLToPath(new URL("../../../../fixtures/m6/demo-atomistique-bundle.zip", import.meta.url));
const capsuleLoop = fileURLToPath(new URL("../../../../fixtures/capsule-loop-demo/lesson.json", import.meta.url));

describe("loadBundleZip", () => {
  it("loads + validates the m3 demo bundle", async () => {
    const b = await loadBundleZip(m3);
    expect(b.bundle_id).toBe("demo-metabolomics-001");
    expect(b.scenes.length).toBeGreaterThan(0);
  });
  it("loads the richer m6 bundle (has ai_critique + reproduction)", async () => {
    const b = await loadBundleZip(m6);
    const types = new Set(b.scenes.map((s) => s.type));
    expect(types.has("ai_critique")).toBe(true);
    expect(types.has("reproduction")).toBe(true);
  });
  it("throws on a zip without lesson.json", async () => {
    await expect(loadBundleZip(fileURLToPath(new URL("./bundle-loader.ts", import.meta.url)))).rejects.toThrow();
  });

  it("preserves nullable reference-run evidence accepted by the bundle schema", () => {
    const raw = JSON.parse(readFileSync(capsuleLoop, "utf8"));
    const nullableReference = {
      ran: true,
      passed: true,
      landmark: null,
      figure_path: null,
      checks: [],
      provenance: { capsule_doi: null, cmd: ["python", "run.py"], env: "test" },
    };
    for (const scene of raw.scenes) {
      if (scene.type === "reproduction" || scene.type === "spot_the_flaw") {
        scene.reference_result = nullableReference;
      }
    }

    expect(() => LessonBundleSchema.parse(raw)).not.toThrow();
    const loaded = loadBundleJson(raw);
    const evidenceScenes = loaded.scenes.filter(
      (scene) => scene.type === "reproduction" || scene.type === "spot_the_flaw",
    );
    expect(evidenceScenes).toHaveLength(2);
    for (const scene of evidenceScenes) {
      expect(scene.reference_result).toMatchObject({
        landmark: null,
        figure_path: null,
        provenance: { capsule_doi: null },
      });
    }
  });
});

// RT-7 (W1 #6, integration item 7): a bundle that does not match the schema is reported as readable
// issues — {path, message, hint} from formatBundleError — and one line naming the first of them,
// instead of the raw ZodError dump every caller had to unpick.
describe("a bundle that does not match the schema", () => {
  const written = (): Record<string, unknown> => JSON.parse(readFileSync(capsuleLoop, "utf8"));

  it("loadBundleJson raises a BundleSchemaError: readable issues and a one-line message", () => {
    const error = (() => { try { loadBundleJson({ ...written(), schema_version: "1.5" }); } catch (e) { return e; } return null; })();
    expect(error).toBeInstanceOf(BundleSchemaError);
    const issues = (error as BundleSchemaError).issues;
    expect(issues[0]).toMatchObject({ path: "schema_version", message: 'must be "1.4", got "1.5"' });
    expect(issues[0]!.hint).toMatch(/lesson bundles 1\.4/);
    expect((error as Error).message).toMatch(/^schema_version: must be "1\.4", got "1\.5" — this Studium reads lesson bundles 1\.4/);
    expect((error as Error).message.split("\n")).toHaveLength(1);
  });

  it("counts the issues beyond the first, and names the offending value where Zod does not", () => {
    const raw = written();
    const scenes = raw["scenes"] as Array<Record<string, unknown>>;
    scenes[0] = { ...scenes[0], type: "hologram" };
    const error = (() => { try { loadBundleJson({ ...raw, schema_version: "1.5" }); } catch (e) { return e as BundleSchemaError; } return null; })();
    expect(error?.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(["schema_version", "scenes.0.type"]));
    expect(error?.issues.find((issue) => issue.path === "scenes.0.type")?.message).toBe('"hologram" is not a known type');
    expect(error?.message).toMatch(/\(\+\d+ more\)$/);
  });

  it("loadBundleZip raises the same error for the lesson.json inside the archive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-loader-"));
    try {
      const zip = join(dir, "broken.zip");
      writeFileSync(zip, zipSync({ "lesson.json": strToU8(JSON.stringify({ ...written(), scenes: "nope" })) }));
      const error = await loadBundleZip(zip).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(BundleSchemaError);
      expect((error as BundleSchemaError).issues[0]).toMatchObject({ path: "scenes", message: "expected array, got string" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// SEC-5 (2026-10-30): a community .zip is untrusted. The loader inflated every entry whole (fflate
// unzipSync), so a tiny archive could exhaust the server. It now inflates lesson.json only, refuses one
// whose declared size exceeds MAX_LESSON_JSON_BYTES (8 MB), and stops inflating at that cap when the
// archive lies about the size.
describe("SEC-5 — an archive cannot make the loader inflate more than the cap", () => {
  const written = (): Record<string, unknown> => JSON.parse(readFileSync(capsuleLoop, "utf8"));
  const withTmp = async (fn: (dir: string) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-loader-cap-"));
    try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  /** Rewrite the uncompressed size of every central-directory entry (offset 24) — what a forged zip does. */
  const lieAboutSize = (zip: Uint8Array, size: number): Uint8Array => {
    const out = new Uint8Array(zip);
    const view = new DataView(out.buffer);
    for (let i = 0; i + 46 <= out.length; i++) if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, size, true);
    return out;
  };

  it("exports the 8 MB cap", () => {
    expect(MAX_LESSON_JSON_BYTES).toBe(8 * 1024 * 1024);
  });

  it("refuses a lesson.json declared larger than the cap", async () => {
    await withTmp(async (dir) => {
      const zip = join(dir, "big.zip");
      const padded = JSON.stringify({ ...written(), padding: "x".repeat(MAX_LESSON_JSON_BYTES + 16) });
      writeFileSync(zip, zipSync({ "lesson.json": strToU8(padded) }));
      await expect(loadBundleZip(zip)).rejects.toThrow(/lesson\.json.*(exceeds|larger)/);
    });
  });

  it("stops inflating at the cap when the declared size lies", async () => {
    await withTmp(async (dir) => {
      const zip = join(dir, "forged.zip");
      const padded = JSON.stringify({ ...written(), padding: "x".repeat(MAX_LESSON_JSON_BYTES + 16) });
      writeFileSync(zip, lieAboutSize(zipSync({ "lesson.json": strToU8(padded) }), 1000));
      await expect(loadBundleZip(zip)).rejects.toThrow(/lesson\.json.*(exceeds|larger)/);
    });
  });

  it("never inflates the other entries, however large", async () => {
    await withTmp(async (dir) => {
      const zip = join(dir, "assets.zip");
      const bytes = zipSync({ "lesson.json": strToU8(JSON.stringify(written())), "media/huge.bin": new Uint8Array(MAX_LESSON_JSON_BYTES * 2) });
      writeFileSync(zip, lieAboutSize(bytes, 0) /* both entries now claim 0 bytes */);
      // lesson.json claims 0 bytes but inflates to the real JSON (under the cap): it still loads.
      const b = await loadBundleZip(zip);
      expect(b.scenes.length).toBeGreaterThan(0);
    });
  });

  it("loads a stored (uncompressed) lesson.json", async () => {
    await withTmp(async (dir) => {
      const zip = join(dir, "stored.zip");
      writeFileSync(zip, zipSync({ "lesson.json": [strToU8(JSON.stringify(written())), { level: 0 }] }));
      expect((await loadBundleZip(zip)).scenes.length).toBeGreaterThan(0);
    });
  });
});

// C5: a lesson archive (a teacher's distribution, a community bundle) may carry its approval record as
// the member `approval.json`, bound to the bytes of its `lesson.json` member. readBundleZip returns both,
// and reads a bad approval member as none rather than refusing the lesson.
describe("readBundleZip — the lesson.json bytes and the approval member", () => {
  const written = (): Record<string, unknown> => JSON.parse(readFileSync(capsuleLoop, "utf8"));
  const withTmp = async (fn: (dir: string) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-loader-approval-"));
    try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  };

  it("returns the exact lesson.json member bytes and the approval member's text", async () => {
    await withTmp(async (dir) => {
      const zip = join(dir, "approved.zip");
      const lesson = JSON.stringify(written());
      const approval = JSON.stringify({ schema: "studium-approval/1", bundle_sha256: "x", reviewer: "Dr Example" });
      writeFileSync(zip, zipSync({ "lesson.json": strToU8(lesson), "approval.json": strToU8(approval) }));
      const read = await readBundleZip(zip);
      expect(read.lessonBytes.toString("utf8")).toBe(lesson);
      expect(read.approvalText).toBe(approval);
      expect(read.bundle.scenes.length).toBeGreaterThan(0);
    });
  });

  it("has no approval text for an archive without the member (the shipped demo bundle)", async () => {
    expect((await readBundleZip(m6)).approvalText).toBeNull();
  });

  it("reads an oversized approval member as none and still loads the lesson", async () => {
    await withTmp(async (dir) => {
      const zip = join(dir, "big-approval.zip");
      writeFileSync(zip, zipSync({ "lesson.json": strToU8(JSON.stringify(written())),
        "approval.json": strToU8("x".repeat(MAX_APPROVAL_JSON_BYTES + 1)) }));
      const read = await readBundleZip(zip);
      expect(read.approvalText).toBeNull();
      expect(read.bundle.scenes.length).toBeGreaterThan(0);
    });
  });
});
