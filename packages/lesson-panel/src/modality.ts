// modality.ts — modality-adaptive render selection for the artifact pane.
//
// Ciussi's "comment mieux apprendre si je suis visuel" — a LEARNER who knows they are visual (or
// textual) should see the SAME scene render with the modality they prefer emphasized first. This is
// a pure, content-preserving reorder + emphasis pass over a scene's normalized scene_assets[]: it
// NEVER drops an artifact (no content is removed), it only:
//   - reorders assets so the preferred modality leads (stable within each tier — equal-tier assets
//     keep their authored order), and
//   - tags each asset with an `emphasis` ('expanded' | 'normal' | 'compact') the pane uses to expand
//     the preferred modality and gently de-emphasize (collapse, never hide) the other.
//
// 'balanced' is the identity transform: the authored order is preserved and every asset is 'normal',
// so behaviour is byte-for-byte the pre-existing pane behaviour.
//
// Shared, pure ordering policy for all panel hosts.

export type ModalityPreference = "visual" | "textual" | "balanced";
export type Emphasis = "expanded" | "normal" | "compact";

// The asset `kind`s the pane knows how to render (see media/artifact-pane.js RENDERERS). Each is
// classed as primarily VISUAL (a figure / 3D scene / plot the eye reads) or TEXTUAL (equations,
// prose, code, tables the mind reads symbolically). `executed_result` is visual: it typically
// carries a rendered figure/landmark.
const VISUAL_KINDS = new Set<string>([
  "orbital", "mol_3d", "plot_spec", "spectrum", "image", "svg", "executed_result",
]);
const TEXTUAL_KINDS = new Set<string>([
  "equation_latex", "protocol_md", "code", "data_csv",
]);

/** Modality class of a single asset kind. Unknown kinds are 'neutral' (never reordered away). */
export function modalityOf(kind: string): "visual" | "textual" | "neutral" {
  if (VISUAL_KINDS.has(kind)) return "visual";
  if (TEXTUAL_KINDS.has(kind)) return "textual";
  return "neutral";
}

type AnyAsset = { kind: string; [k: string]: any };

// Tier within the preferred ordering: 0 = preferred modality (leads, expanded), 1 = neutral/unknown
// (keeps the middle, normal), 2 = the other modality (trails, compact). 'balanced' collapses all to
// a single tier so the sort is a no-op.
function tierFor(kind: string, pref: ModalityPreference): number {
  if (pref === "balanced") return 0;
  const m = modalityOf(kind);
  const preferred = pref === "visual" ? "visual" : "textual";
  if (m === preferred) return 0;
  if (m === "neutral") return 1;
  return 2;
}

function emphasisFor(kind: string, pref: ModalityPreference): Emphasis {
  if (pref === "balanced") return "normal";
  const t = tierFor(kind, pref);
  return t === 0 ? "expanded" : t === 2 ? "compact" : "normal";
}

/**
 * Reorder + emphasis-tag a scene's assets for the learner's modality preference.
 *
 * Content-preserving: the returned array is a permutation of the input (same length, same objects,
 * none added or dropped) with an added `emphasis` field on each. The sort is STABLE — assets in the
 * same tier keep their authored relative order — so 'balanced' (single tier) returns the input order
 * unchanged, every asset 'normal'.
 */
export function selectRenderOrder<T extends AnyAsset>(
  assets: readonly T[],
  pref: ModalityPreference,
): Array<T & { emphasis: Emphasis }> {
  const decorated = (assets || []).map((a, i) => ({
    a,
    i,
    tier: tierFor(a.kind, pref),
  }));
  decorated.sort((x, y) => (x.tier - y.tier) || (x.i - y.i)); // stable: tie-break on original index
  return decorated.map(({ a }) => ({ ...a, emphasis: emphasisFor(a.kind, pref) }));
}
