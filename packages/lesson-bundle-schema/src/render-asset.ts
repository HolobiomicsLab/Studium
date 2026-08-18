// packages/lesson-bundle-schema/src/render-asset.ts
//
// The normalized RenderAsset KIND + schema, in their own module so both `scenes.ts`
// (a scene may carry explicit typed assets) and `scene-assets.ts` (flattens a scene into a
// render manifest) depend on it without an import cycle. A UI renders strictly BY KIND.
import { z } from "zod";

export const RenderAssetKindSchema = z.enum([
  "image",            // a rendered figure (path)
  "svg",              // inline SVG markup (e.g. a spectrum viewer)
  "equation_latex",   // a LaTeX string → KaTeX/MathJax
  "plot_spec",        // a Vega-Lite / Plotly JSON spec → interactive plot
  "code",             // a code/script snippet
  "data_csv",         // tabular data → a table
  "protocol_md",      // a protocol card in markdown
  "executed_result",  // the graded output of a reference run (figure + checks + landmark)
  // ── interactive scientific kinds (rendered client-side; see apps/studium-vscode artifact-pane) ──
  "orbital",          // a 3D volumetric .cube (atomic / molecular orbital) → 3Dmol.js addVolumetricData
  "mol_3d",           // a 3D molecule (xyz / mol / pdb / SMILES) → 3Dmol.js / RDKit.js
  "spectrum",         // spectral data (λ–intensity, m/z–intensity, raies) → Vega-Lite stem plot
]);
export type RenderAssetKind = z.infer<typeof RenderAssetKindSchema>;

const RenderAssetFieldsSchema = z.object({
  kind: RenderAssetKindSchema,
  title: z.string().optional(),
  payload: z.string().optional(),   // inline content (latex, vega/plotly json, svg, code, csv, md, xyz, cube)
  path: z.string().optional(),      // a file path (image / figure / .cube)
  language: z.string().optional(),  // for `code`
  format: z.string().optional(),    // renderer hint for the payload, e.g. "cube" | "xyz" | "smiles" | "vega-lite"
  provenance: z.string().optional(),
  meta: z.record(z.unknown()).optional(), // e.g. executed_result {passed, landmark, checks}; orbital {iso, level}
});

type RenderAssetFields = z.infer<typeof RenderAssetFieldsSchema>;

// The ONE kind whose content is its `meta` (landmark + graded checks) rather than payload/path: a
// reference run legitimately has no figure (ReferenceRun.figure_path is nullable), so `path` stays
// optional for it while `meta` becomes required.
const META_BACKED_KIND: RenderAssetKind = "executed_result";

const CONTENT_SOURCE_MESSAGE =
  "a render asset needs exactly one content source: `payload` (inline) or `path` (file) — " +
  "`executed_result` instead needs `meta` and at most one of them";

/** Whether an asset names exactly one content source (inline payload XOR file path).
 * Input: the asset's parsed fields. Output: true when exactly one of the two is set. */
function hasOneContentSource(asset: RenderAssetFields): boolean {
  return (asset.payload !== undefined) !== (asset.path !== undefined);
}

/** Whether an asset carries something renderable at all — the guard that keeps a blank pane out of
 * an authored bundle. Input: the asset's parsed fields. Output: true when the asset is renderable. */
function isRenderable(asset: RenderAssetFields): boolean {
  if (asset.kind !== META_BACKED_KIND) return hasOneContentSource(asset);
  return asset.meta !== undefined && !(asset.payload !== undefined && asset.path !== undefined);
}

export const RenderAssetSchema = RenderAssetFieldsSchema.refine(isRenderable, {
  message: CONTENT_SOURCE_MESSAGE,
  path: ["payload"],
});
export type RenderAsset = z.infer<typeof RenderAssetSchema>;
