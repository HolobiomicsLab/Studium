import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { loadBundleZip } from "./bundle-loader.js";

const m3 = fileURLToPath(new URL("../../../../fixtures/m3/demo-metabolomics-bundle.zip", import.meta.url));
const m6 = fileURLToPath(new URL("../../../../fixtures/m6/demo-atomistique-bundle.zip", import.meta.url));

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
});
