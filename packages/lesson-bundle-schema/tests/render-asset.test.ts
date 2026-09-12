// A RenderAsset must name WHERE its content comes from. Before the XOR refine, `payload` and `path`
// were both optional, so an asset carrying neither parsed as valid and rendered a blank pane — an
// authoring defect no schema check caught. These tests pin the content-source contract.
import { describe, it, expect } from "vitest";
import { RenderAssetSchema } from "../src/index";

const FIGURE = { ran: true, passed: true, landmark: "k=0.42", checks: [] };

describe("RenderAsset content source — payload XOR path", () => {
  it("rejects an asset carrying NEITHER payload nor path (renders blank)", () => {
    const r = RenderAssetSchema.safeParse({ kind: "svg", title: "Spectre" });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.success ? [] : r.error.issues)).toContain("payload");
  });

  it("rejects an asset carrying BOTH payload and path (ambiguous source)", () => {
    const both = { kind: "orbital", payload: "CUBE", path: "assets/2pz.cube" };
    expect(RenderAssetSchema.safeParse(both).success).toBe(false);
  });

  it("accepts payload-only and path-only assets", () => {
    expect(RenderAssetSchema.safeParse({ kind: "equation_latex", payload: "E=h\\nu" }).success).toBe(true);
    expect(RenderAssetSchema.safeParse({ kind: "image", path: "figures/decay.png" }).success).toBe(true);
    expect(RenderAssetSchema.safeParse({ kind: "audio", path: "media/narration.wav" }).success).toBe(true);
    expect(RenderAssetSchema.safeParse({ kind: "video", path: "media/observation.mp4" }).success).toBe(true);
  });

  it("accepts an executed_result with no figure — its content is `meta` (figure_path is nullable)", () => {
    expect(RenderAssetSchema.safeParse({ kind: "executed_result", meta: FIGURE }).success).toBe(true);
    expect(RenderAssetSchema.safeParse({ kind: "executed_result", path: "decay.png", meta: FIGURE }).success).toBe(true);
  });

  it("rejects an executed_result with no meta and no figure (nothing to show)", () => {
    expect(RenderAssetSchema.safeParse({ kind: "executed_result", title: "Reference run" }).success).toBe(false);
  });
});
