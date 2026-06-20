import { describe, it, expect } from "vitest";
import { sceneRenderAssets, RenderAssetSchema, ABSAssetSchema } from "../src/index";

const base = (over: Record<string, unknown>) => ({
  id: "s", title: "S", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 0, adaptation_hooks: [], ...over,
});

describe("scene-assets render manifest", () => {
  it("accepts the new plot_spec + equation_latex ABS asset types", () => {
    expect(ABSAssetSchema.safeParse({ asset_type: "plot_spec", payload_inline: "{}", prov_derived_from: "x" }).success).toBe(true);
    expect(ABSAssetSchema.safeParse({ asset_type: "equation_latex", payload_inline: "E=mc^2", prov_derived_from: "x" }).success).toBe(true);
  });

  it("flattens image_path + an equation_latex abs_asset into a typed manifest", () => {
    const scene = base({
      type: "concept", markdown: "body",
      image_path: "/tmp/fig.png",
      evidence: {
        abs_asset: { asset_type: "equation_latex", payload_inline: "\\cos\\theta", prov_derived_from: "doi:1" },
        enrichment_metadata: { enricher_version: "1", perspicacite_mode_used: "basic", timestamp: "t", degraded: false },
      },
    }) as never;
    const assets = sceneRenderAssets(scene);
    expect(assets.map(a => a.kind)).toEqual(["image", "equation_latex"]);
    expect(assets[1]!.payload).toBe("\\cos\\theta");
    for (const a of assets) expect(RenderAssetSchema.safeParse(a).success).toBe(true);
  });

  it("surfaces a reproduction's executed reference_result as an executed_result asset", () => {
    const scene = base({
      type: "reproduction", task_card_id: "t", steps: [{ step_id: "s1", instruction: "go", expected_input_schema: {}, expected_output: "out" }],
      reference_result: {
        ran: true, passed: true, landmark: "k=0.42", figure_path: "/tmp/decay.png", checks: [{ check: "exists", passed: true }],
        provenance: { capsule_doi: "10.x/y", cmd: ["python", "run.py"], env: "uv venv" },
      },
    }) as never;
    const assets = sceneRenderAssets(scene);
    const exec = assets.find(a => a.kind === "executed_result");
    expect(exec).toBeDefined();
    expect(exec!.path).toBe("/tmp/decay.png");
    expect((exec!.meta as Record<string, unknown>).passed).toBe(true);
    expect((exec!.meta as Record<string, unknown>).landmark).toBe("k=0.42");
  });

  it("returns an empty manifest for a plain quiz (no artifacts)", () => {
    const scene = base({ type: "quiz", question: "?", choices: [{ id: "a", text: "A", correct: true }, { id: "b", text: "B", correct: false }], feedback_correct: "y", feedback_incorrect: "n", hints: [] }) as never;
    expect(sceneRenderAssets(scene)).toEqual([]);
  });
});
