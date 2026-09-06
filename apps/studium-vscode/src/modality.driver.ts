// modality.driver.ts — a standalone tsx driver unit-testing the modality-adaptive render selection
// (modality.ts). Asserts that, given a scene with mixed render_assets, the ORDER + EMPHASIS follow
// the learner's modality preference, and that no content is ever dropped.
//
// Run from the repo root:
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/modality.driver.ts
//
// Exits non-zero (and prints FAIL) on any failed assertion.
import { selectRenderOrder, modalityOf, type ModalityPreference } from "./modality.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) {
  checks++;
  if (!cond) failures.push(msg);
}
const kinds = (xs: Array<{ kind: string }>) => xs.map((x) => x.kind).join(",");

// A scene with mixed modalities, authored in a deliberately interleaved order so a reorder is
// observable (orbital is visual; equation is textual; image visual; protocol textual; plot visual).
const scene = [
  { kind: "equation_latex", title: "Schrödinger", payload: "i\\hbar\\partial_t\\psi" },
  { kind: "orbital", title: "2p_z orbital", payload: "CUBE..." },
  { kind: "protocol_md", title: "Procedure", payload: "1. ..." },
  { kind: "image", title: "Energy diagram", path: "/x.png" },
  { kind: "code", title: "snippet", payload: "print()" },
  { kind: "plot_spec", title: "Radial distribution", payload: "{}" },
];
const n = scene.length;

// --- 1) content-preserving for every preference: same length, same kinds (as a multiset) ----------
for (const pref of ["visual", "textual", "balanced"] as ModalityPreference[]) {
  const out = selectRenderOrder(scene, pref);
  expect(out.length === n, `[${pref}] length preserved (got ${out.length}, want ${n})`);
  const inSorted = scene.map((a) => a.kind).sort().join(",");
  const outSorted = out.map((a) => a.kind).sort().join(",");
  expect(inSorted === outSorted, `[${pref}] same multiset of kinds (got ${outSorted})`);
  // every asset carries an emphasis tag
  expect(out.every((a) => !!a.emphasis), `[${pref}] every asset tagged with emphasis`);
  // original payloads/titles preserved (objects only decorated, not mutated away)
  expect(out.every((a) => a.title !== undefined), `[${pref}] titles preserved`);
}

// --- 2) 'balanced' is the identity transform (authored order, all 'normal') ------------------------
{
  const out = selectRenderOrder(scene, "balanced");
  expect(kinds(out) === kinds(scene), `[balanced] order unchanged (got ${kinds(out)})`);
  expect(out.every((a) => a.emphasis === "normal"), `[balanced] all emphasis 'normal'`);
}

// --- 3) 'visual' leads with visual kinds, all visual before all textual ----------------------------
{
  const out = selectRenderOrder(scene, "visual");
  // the first asset must be a visual kind
  expect(modalityOf(out[0].kind) === "visual", `[visual] first asset is visual (got ${out[0].kind})`);
  // the last position of any visual must precede the first position of any textual
  const lastVisual = Math.max(...out.map((a, i) => (modalityOf(a.kind) === "visual" ? i : -1)));
  const firstTextual = Math.min(...out.map((a, i) => (modalityOf(a.kind) === "textual" ? i : n)));
  expect(lastVisual < firstTextual, `[visual] all visual before all textual (lastV=${lastVisual} firstT=${firstTextual})`);
  // visual kinds are 'expanded', textual are 'compact'
  expect(out.filter((a) => modalityOf(a.kind) === "visual").every((a) => a.emphasis === "expanded"),
    `[visual] visual kinds expanded`);
  expect(out.filter((a) => modalityOf(a.kind) === "textual").every((a) => a.emphasis === "compact"),
    `[visual] textual kinds compact`);
  // stability: among the visual assets, authored relative order is preserved (orbital,image,plot)
  const vis = out.filter((a) => modalityOf(a.kind) === "visual").map((a) => a.kind);
  expect(kinds([{ kind: vis.join("|") }]) === "orbital|image|plot_spec",
    `[visual] visual assets keep authored order (got ${vis.join("|")})`);
}

// --- 4) 'textual' is the mirror image -------------------------------------------------------------
{
  const out = selectRenderOrder(scene, "textual");
  expect(modalityOf(out[0].kind) === "textual", `[textual] first asset is textual (got ${out[0].kind})`);
  const lastTextual = Math.max(...out.map((a, i) => (modalityOf(a.kind) === "textual" ? i : -1)));
  const firstVisual = Math.min(...out.map((a, i) => (modalityOf(a.kind) === "visual" ? i : n)));
  expect(lastTextual < firstVisual, `[textual] all textual before all visual (lastT=${lastTextual} firstV=${firstVisual})`);
  expect(out.filter((a) => modalityOf(a.kind) === "textual").every((a) => a.emphasis === "expanded"),
    `[textual] textual kinds expanded`);
  expect(out.filter((a) => modalityOf(a.kind) === "visual").every((a) => a.emphasis === "compact"),
    `[textual] visual kinds compact`);
  // textual authored order: equation, protocol, code
  const txt = out.filter((a) => modalityOf(a.kind) === "textual").map((a) => a.kind);
  expect(txt.join("|") === "equation_latex|protocol_md|code",
    `[textual] textual assets keep authored order (got ${txt.join("|")})`);
}

// --- 5) empty + single-asset edge cases -----------------------------------------------------------
{
  expect(selectRenderOrder([], "visual").length === 0, `empty scene yields empty`);
  const one = selectRenderOrder([{ kind: "image", title: "t" }], "textual");
  expect(one.length === 1 && one[0].emphasis === "compact", `single visual under textual is compact`);
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} modality assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — modality render-selection passed all ${checks} assertions.`);
