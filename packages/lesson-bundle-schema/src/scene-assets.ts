// packages/lesson-bundle-schema/src/scene-assets.ts
//
// The normalized RENDER MANIFEST for a scene. A Scene carries renderable payloads in several
// places (markdown, image_path, evidence.abs_asset, a reproduction's reference_result). A UI
// shouldn't have to know each field's home — `sceneRenderAssets(scene)` flattens them into a
// single typed `RenderAsset[]`, so the client renders strictly BY KIND. This is what a webview /
// VS Code panel consumes to draw the artifact paired with the current scene, pair by pair.
import type { Scene } from "./scenes";
import {
  RenderAssetKindSchema,
  RenderAssetSchema,
  type RenderAssetKind,
  type RenderAsset,
} from "./render-asset";

// Re-exported for back-compat: consumers import these from "./scene-assets" (and via the package index).
export { RenderAssetKindSchema, RenderAssetSchema };
export type { RenderAssetKind, RenderAsset };

const ABS_KIND: Record<string, RenderAssetKind> = {
  spectrum_viewer_svg: "svg",
  code_snippet: "code",
  script_snippet: "code",
  data_csv: "data_csv",
  protocol_card_md: "protocol_md",
  plot_spec: "plot_spec",
  equation_latex: "equation_latex",
  orbital_viewer_3d: "orbital",
  molecule_3d: "mol_3d",
  spectrum_data: "spectrum",
};

/** Flatten a scene's renderable payloads into a single ordered manifest (prose markdown excluded —
 * it is the scene body the tutor surface already shows; this manifest is the *artifact* pane). */
export function sceneRenderAssets(scene: Scene): RenderAsset[] {
  const out: RenderAsset[] = [];

  // 0) explicit typed assets the author attached to the scene (interactive orbital / spectrum /
  //    equation / plot rendered pair-by-pair with the cell). These are the primary artifacts.
  if ("render_assets" in scene && scene.render_assets) {
    out.push(...scene.render_assets);
  }

  // 1) a static figure on a concept/reproduction scene
  if ("image_path" in scene && scene.image_path) {
    out.push({ kind: "image", title: "Figure", path: scene.image_path });
  }

  // 2) a typed ABS domain asset carried on the scene's evidence
  const abs = "evidence" in scene ? scene.evidence?.abs_asset : undefined;
  if (abs) {
    const kind = ABS_KIND[abs.asset_type];
    if (kind) {
      out.push({
        kind,
        title: abs.asset_type,
        ...(abs.payload_inline ? { payload: abs.payload_inline } : {}),
        ...(abs.payload_path ? { path: abs.payload_path } : {}),
        ...(abs.asset_type === "code_snippet" || abs.asset_type === "script_snippet" ? { language: "python" } : {}),
        provenance: abs.prov_derived_from,
        ...(abs.legend ? { legend: abs.legend } : {}),
      });
    }
  }

  // 3) the executed reference run (figure + graded checks) on ANY scene grounded in a real capsule
  //    execution: the `reproduction` scene (authenticity) OR a judgment scene (`spot_the_flaw`) whose
  //    flawed_content interprets that genuine output. Same `executed_result` asset for both — the
  //    `"reference_result" in scene` guard narrows the union to exactly the types that carry it.
  if ("reference_result" in scene && scene.reference_result?.ran) {
    const rr = scene.reference_result;
    out.push({
      kind: "executed_result",
      title: "Reference run",
      ...(rr.figure_path ? { path: rr.figure_path } : {}),
      ...(rr.provenance?.capsule_doi ? { provenance: rr.provenance.capsule_doi } : {}),
      meta: { passed: rr.passed, landmark: rr.landmark, checks: rr.checks, cmd: rr.provenance?.cmd },
    });
  }

  return out;
}
