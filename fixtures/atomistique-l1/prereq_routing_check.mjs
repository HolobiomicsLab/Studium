// PREREQ ROUTING CHECK — a diagnostic, not an assertion. Exits 0 always.
//
//   node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/prereq_routing_check.mjs
//
// INT-STUDIUM-036 bounded the prerequisite detour and made the release audible: past
// MAX_PREREQ_DETOURS the learner is let into the gated scene and the session says so
// (`graph_prereq_gate_released`). This driver exists because there is a SECOND way through the same
// gate, and until INT-STUDIUM-037 it was silent — the router returned the same "advance" an
// ordinary next-scene step carries.
//
// It happens when the unmet prerequisite has NO scene the router will route back to. No detour is
// spent, so the budget never runs out, so the release never fires. On this bundle it is
// `concept:c-configuration`: a prerequisite of both `c-periodicite` and `c-geometrie`, assessed
// only by a `prompt_practice` — a scene type that emits an `answer_submitted` like any other and is
// not one of the two the router lists (`ANSWER_GRADED_TYPES`).
//
// Read the two blocks below. The first walks a learner who has mastered nothing — the case the gate
// exists for — and prints the reason at every step. The second says, per concept, what its
// remediation target is and whether the router can reach it.
//
// SINCE INT-STUDIUM-035 CANDIDATE 2 the second block also carries the offline half: a scene type
// that certifies only under a live evaluator cannot raise mastery on the default tester path, so a
// detour there cannot converge even when the router CAN reach it. Which set the router should use
// is the open question INT-STUDIUM-037 files; this driver measures the gap rather than closing it.
import { readFileSync } from "node:fs";
import { graphAwareNextIndex, ANSWER_GRADED_TYPES } from "../../packages/lesson-session/src/graph-nav.ts";
import { isAvailable, remediationTarget } from "../../packages/adaptation-engine/src/index.ts";

const bundle = JSON.parse(readFileSync(new URL("./lesson.json", import.meta.url), "utf8"));
const { scenes, learning_workflow_graph: lwg } = bundle;
const THETA = 0.8;
const mastery = {}; // a learner who has mastered nothing

// Offline, only these two carry a `correct` — quiz by the marked choice, spot_the_flaw by the
// verdict deck. Both are scored against the key by identity, never by looking for words in prose.
// (Measured by packages/lesson-session/src/grading/answer-graded-types.contract.test.ts.)
const CERTIFIES_OFFLINE = new Set(["quiz", "spot_the_flaw"]);

const pad = (s, n) => String(s).padEnd(n);
const conceptOf = (s) => (s.concept_refs?.[0] ? `concept:${s.concept_refs[0]}` : null);

console.log(`\n  ${pad("from", 40)} ${pad("to", 34)} ${pad("reason", 19)} prereq met?`);
console.log("  " + "-".repeat(112));
const tally = {};
for (let i = 0; i < scenes.length - 1; i++) {
  const r = graphAwareNextIndex(scenes, i, lwg, mastery, THETA, false, {}, {});
  if (r.index === null) continue;
  tally[r.reason] = (tally[r.reason] ?? 0) + 1;
  const to = scenes[r.index];
  const cid = conceptOf(to);
  const met = cid === null ? "n/a" : String(isAvailable(lwg, cid, mastery, THETA));
  const mark = r.reason === "gate_unassessable" ? "! " : "  ";
  console.log(`${mark}${pad(`${scenes[i].id} (${scenes[i].type})`, 40)} ${pad(`${to.id} (${to.type})`, 34)} ${pad(r.reason, 19)} ${met}`);
}
console.log(`\n  ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`  Every "!" row is a gate opened WITHOUT a detour being spent — announced since`);
console.log(`  INT-STUDIUM-037 (graph_prereq_unassessable), reported as a plain "advance" before it.\n`);

console.log(`  ${pad("gated concept", 28)} ${pad("remediation target", 28)} ${pad("its scenes", 46)} router  offline`);
console.log("  " + "-".repeat(122));
for (const n of lwg.nodes.filter((x) => x.node_kind === "concept")) {
  if (isAvailable(lwg, n.id, mastery, THETA)) continue;
  const target = remediationTarget(lwg, n.id, mastery, THETA);
  const types = scenes.filter((s) => conceptOf(s) === target).map((s) => s.type);
  const reachable = types.some((t) => ANSWER_GRADED_TYPES.has(t));
  const converges = types.some((t) => ANSWER_GRADED_TYPES.has(t) && CERTIFIES_OFFLINE.has(t));
  console.log(`  ${pad(n.id, 28)} ${pad(String(target), 28)} ${pad(`[${types.join(",")}]`, 46)} ${pad(reachable ? "yes" : "NO", 7)} ${converges ? "can converge" : "CANNOT converge"}`);
}
console.log(`\n  "router" = the target has a scene of a type the router will route to.`);
console.log(`  "offline" = that scene can actually raise mastery on the default tester path (no LLM).`);
console.log(`  A "NO" in the router column is the row that opens the gate silently-no-longer.\n`);
