// packages/lesson-bundle-schema/src/scene-assets.ts
//
// The normalized RENDER MANIFEST for a scene. A Scene carries renderable payloads in several
// places (markdown, image_path, evidence.abs_asset, a reproduction's reference_result). A UI
// shouldn't have to know each field's home — `sceneRenderAssets(scene)` flattens them into a
// single typed `RenderAsset[]`, so the client renders strictly BY KIND. This is what a webview /
// VS Code panel consumes to draw the artifact paired with the current scene, pair by pair.
import { z } from "zod";
import type { Scene } from "./scenes";

export const RenderAssetKindSchema = z.enum([
  "image",            // a rendered figure (path)
  "svg",              // inline SVG markup (e.g. a spectrum viewer)
  "equation_latex",   // a LaTeX string → KaTeX/MathJax
  "plot_spec",        // a Vega-Lite / Plotly JSON spec → interactive plot
  "code",             // a code/script snippet
  "data_csv",         // tabular data → a table
  "protocol_md",      // a protocol card in markdown
  "executed_result",  // the graded output of a reference run (figure + checks + landmark)
]);
export type RenderAssetKind = z.infer<typeof RenderAssetKindSchema>;

export const RenderAssetSchema = z.object({
  kind: RenderAssetKindSchema,
  title: z.string().optional(),
  payload: z.string().optional(),   // inline content (latex, vega/plotly json, svg, code, csv, md)
  path: z.string().optional(),      // a file path (image / figure)
  language: z.string().optional(),  // for `code`
  provenance: z.string().optional(),
  meta: z.record(z.unknown()).optional(), // e.g. executed_result {passed, landmark, checks}
});
export type RenderAsset = z.infer<typeof RenderAssetSchema>;

const ABS_KIND: Record<string, RenderAssetKind> = {
  spectrum_viewer_svg: "svg",
  code_snippet: "code",
  script_snippet: "code",
  data_csv: "data_csv",
  protocol_card_md: "protocol_md",
  plot_spec: "plot_spec",
  equation_latex: "equation_latex",
};

/** Flatten a scene's renderable payloads into a single ordered manifest (prose markdown excluded —
 * it is the scene body the tutor surface already shows; this manifest is the *artifact* pane). */
export function sceneRenderAssets(scene: Scene): RenderAsset[] {
  const out: RenderAsset[] = [];

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
      });
    }
  }

  // 3) the executed reference run on a reproduction scene (figure + graded checks)
  if (scene.type === "reproduction" && scene.reference_result?.ran) {
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
