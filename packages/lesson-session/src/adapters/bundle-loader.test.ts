import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LessonBundleSchema } from "@studium/lesson-bundle-schema";
import { loadBundleJson, loadBundleZip } from "./bundle-loader.js";

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
