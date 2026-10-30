import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { LessonBundleSchema } from "@studium/lesson-bundle-schema";
import { BundleSchemaError, loadBundleJson, loadBundleZip } from "./bundle-loader.js";

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
