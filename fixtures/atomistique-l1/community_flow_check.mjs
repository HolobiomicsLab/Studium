// P5 — atomistique learner-as-author end-to-end (TS half: discover -> load -> grade).
//
// This driver owns the SECOND half of the learner-as-author loop. It meets the Python half
// (services/scene-synth/tests/test_atomistique_learner_flow.py: author -> peer -> approve ->
// emit) AT THE EMITTED COMMUNITY BUNDLE: the Python `decide_item()` approve branch writes a
// single-scene `community-<item>.zip` into a known bundles root, and this driver reads it.
//
// Layout of the shared bundles root (built here by invoking the same Python emit path):
//   <root>/lesson.json                      the canonical atomistique-l1 (copied, IMMUTABLE)
//   <root>/community/community-<item>.zip    the emitted learner-authored community bundle
//
// The driver then proves, with NO API key (host live:false) and using only EXISTING code:
//   1. P4 discovery (SessionHost.listCommunityBundles) finds the emitted community bundle
//      ALONGSIDE the canonical atomistique-l1 (which loads by its own `lesson.json` ref).
//   2. A SessionHost loads the community bundle exactly like the canonical one.
//   3. A CLASSMATE answering the CORRECT choice ('2' radial nodes for the 3s) is graded
//      CORRECT by the EXISTING quizGrader (via grade()), and a WRONG choice is graded
//      incorrect — the classmate NEVER sees the author (no author field on the loaded scene).
//
// Run from repo root:
//   node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/community_flow_check.mjs
import { mkdtempSync, rmSync, copyFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SessionHost, discoverCommunityBundles, COMMUNITY_DIR } from "../../packages/lesson-session-host/src/index.ts";
import { resolveBundle } from "../../packages/lesson-session-host/src/bundle-resolver.ts";
import { grade } from "../../packages/lesson-session/src/grading/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const CANONICAL = join(HERE, "lesson.json");
const VENV_PY = join(REPO, ".venv", "bin", "python");
const SCENE_SYNTH = join(REPO, "services", "scene-synth");
const ITEM_ID = "atomistique-la-3s-noeuds";
const CONCEPT_ID = "c-orbitales-formes";
const PSEUDONYM = "hmac-0123456789abcdef0123456789abcdef";
const TEACHER = "https://univ-cotedazur.fr/people/teacher-001";

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }

// --- Build the shared bundles root by running the REAL Python emit path -----------------
// We drive author -> peer -> approve -> emit through the actual learner_items_store /
// learner_review code (the same path the integration test exercises), writing the emitted
// community bundle into <root>/community. This is the meeting point; the TS side reads it.
const root = mkdtempSync(join(tmpdir(), "atomistique-e2e-"));
copyFileSync(CANONICAL, join(root, "lesson.json")); // canonical, immutable

const PY_EMIT = `
import json, sys
sys.path.insert(0, ${JSON.stringify(SCENE_SYNTH)})
from bundler import validate_scene
from learner_items_store import LAItemEnvelope, LearnerItemsStore
from learner_review import decide_item, record_peer_review, community_emit_dir

root = ${JSON.stringify(root)}
concepts = json.load(open(${JSON.stringify(CANONICAL)}, encoding="utf-8"))["concepts"]
concept_ids = [c["id"] for c in concepts]

scene = {
  "id": "s-la-3s-noeuds", "type": "quiz",
  "title": "Noeuds radiaux de la 3s (item etudiant)",
  "objective_refs": [], "concept_refs": [${JSON.stringify(CONCEPT_ID)}],
  "estimated_seconds": 60, "adaptation_hooks": [],
  "question": "Combien de noeuds RADIAUX possede l'orbitale 3s ?",
  "choices": [
    {"id": "a", "text": "0", "correct": False},
    {"id": "b", "text": "1", "correct": False},
    {"id": "c", "text": "2", "correct": True},
    {"id": "d", "text": "3", "correct": False},
  ],
  "feedback_correct": "Exact : n - l - 1 = 3 - 0 - 1 = 2.",
  "feedback_incorrect": "Rappel : noeuds radiaux = n - l - 1.",
  "hints": ["n - l - 1"],
}

v = validate_scene(scene, course_concept_ids=concept_ids)
assert v["ok"], v["errors"]

store = LearnerItemsStore(root + "/learner_items.jsonl")
store.append_new(LAItemEnvelope(
  item_id=${JSON.stringify(ITEM_ID)}, course_id="atomistique-l1",
  target_bundle_ref="atomistique-l1/lesson.json", scene=scene,
  author_pseudonym=${JSON.stringify(PSEUDONYM)}, created_at="2026-06-26T09:00:00Z",
  review_state="submitted", validation=v,
))
# peer rates (P3) -> opens peer_review
record_peer_review(store, ${JSON.stringify(ITEM_ID)}, passed=True, rating=5, helpful=True)
# teacher approves (rule-003) -> emits community/community-<item>.zip.
# A3 PATH RECONCILIATION: we hand decide_item the SHARED community_emit_dir(courseRoot) helper
# (== <root>/community), the exact dir the TS discoverCommunityBundles(root) scans — so the
# emit side and the discover side agree by construction, without the bridge hardcoding the subdir.
pub = decide_item(
  store, ${JSON.stringify(ITEM_ID)}, decision="approve",
  reviewer=${JSON.stringify(TEACHER)}, reviewed_at="2026-06-26T15:30:00Z",
  bundles_root=community_emit_dir(root), course_concepts=concepts, note_code="ok",
)
assert pub.review_state == "published", pub.review_state
print(pub.published_bundle_ref)
`;

let emittedUri = "";
try {
  emittedUri = execFileSync(VENV_PY, ["-c", PY_EMIT], { encoding: "utf8", cwd: SCENE_SYNTH }).trim();
} catch (e) {
  fail(`Python emit half failed: ${e.stderr || e.message}`);
}
console.log(`● Python half emitted (author -> peer -> approve -> publish):\n  ${emittedUri}`);

// --- 1. P4 discovery finds the emitted bundle alongside the canonical course ------------
const host = new SessionHost({ bundlesRoot: root, live: false });
const refs = await host.listCommunityBundles();
const direct = await discoverCommunityBundles(root);
if (JSON.stringify(refs) !== JSON.stringify(direct)) fail("host.listCommunityBundles != discoverCommunityBundles");
const expectedRef = `${COMMUNITY_DIR}/community-${ITEM_ID}.zip`;
if (!refs.includes(expectedRef)) fail(`discovery did not find ${expectedRef}; got ${JSON.stringify(refs)}`);
if (refs.length !== 1) fail(`expected exactly one community bundle, got ${refs.length}: ${JSON.stringify(refs)}`);
// canonical course is discoverable too (by its own ref) and was NOT swept into the community list.
if (refs.some((r) => r.endsWith("lesson.json"))) fail("canonical lesson.json leaked into community refs");
console.log(`● P4 discovery found the community bundle alongside the canonical course:\n  ${refs[0]}`);

// --- 2. A SessionHost loads the community bundle exactly like the canonical one ---------
// canonical loads by its own ref...
const canonSession = await host.create("lesson.json", "classmate-canon");
if (!canonSession.presentation?.scene) fail("canonical course failed to boot");
// ...and the community bundle boots through the SAME create() path.
const community = await host.create(refs[0], "classmate-bob");
if (!community.presentation?.scene) fail("community bundle failed to boot a session");
console.log(`● SessionHost booted the community bundle the same way as the canonical course (sessionId ok).`);

// --- 3. The classmate is graded by the EXISTING quizGrader; never sees the author ------
// Load the community bundle's quiz scene (post-shuffle, exactly as a learner would receive it).
const loaded = await resolveBundle(root, refs[0]);
const quiz = loaded.scenes.find((s) => s.type === "quiz");
if (!quiz) fail("emitted community bundle has no quiz scene");

// PRIVACY: the loaded scene the classmate sees carries NO author identity, anywhere.
const sceneJson = JSON.stringify(quiz);
if (sceneJson.includes(PSEUDONYM)) fail("author_pseudonym leaked into the loaded community scene");
if ("author" in quiz || "author_pseudonym" in quiz || "prior_author" in quiz) {
  fail("author field present on the loaded scene — the classmate must never see the author");
}
// Also assert the whole distributed bundle is pseudonym-free (lesson.json + the scene).
if (JSON.stringify(loaded).includes(PSEUDONYM)) fail("author_pseudonym leaked into the loaded bundle");

// The correct choice is the one whose TEXT is '2' (radial nodes of the 3s = n-l-1 = 2).
// After shuffle the choice IDS are re-lettered, so we resolve by the post-shuffle `correct` flag
// AND cross-check it still corresponds to text '2' — proving the answer key survived emit + shuffle.
const correctChoice = quiz.choices.find((c) => c.correct);
if (!correctChoice) fail("no correct choice in the loaded quiz");
if (correctChoice.text !== "2") fail(`correct choice text drifted: expected '2', got '${correctChoice.text}'`);
const wrongChoice = quiz.choices.find((c) => !c.correct);
if (!wrongChoice) fail("no wrong choice in the loaded quiz");

const deps = { critiqueEvaluator: { evaluate: async () => ({ score: 0 }) } }; // unused for quiz

// classmate answers the CORRECT choice -> graded correct.
const okRes = await grade(quiz, { kind: "quiz_choice", choiceId: correctChoice.id }, deps);
if (okRes.signal.kind !== "answer_submitted") fail(`expected answer_submitted, got ${okRes.signal.kind}`);
if (okRes.signal.correct !== true) fail("correct choice ('2') was NOT graded correct by quizGrader");
if (okRes.signal.concept_id !== CONCEPT_ID) fail(`graded against wrong concept: ${okRes.signal.concept_id}`);

// classmate answers a WRONG choice -> graded incorrect.
const wrongRes = await grade(quiz, { kind: "quiz_choice", choiceId: wrongChoice.id }, deps);
if (wrongRes.signal.correct !== false) fail(`wrong choice ('${wrongChoice.text}') was NOT graded incorrect`);

console.log(`● Classmate graded by the EXISTING quizGrader:`);
console.log(`    correct choice (text '2', id '${correctChoice.id}') -> correct=${okRes.signal.correct}`);
console.log(`    wrong   choice (text '${wrongChoice.text}', id '${wrongChoice.id}') -> correct=${wrongRes.signal.correct}`);
console.log(`    concept = ${okRes.signal.concept_id};  author never exposed to the classmate.`);

// canonical course bytes are untouched (immutability) end-to-end.
const canonBytes = readFileSync(join(root, "lesson.json"));
const origBytes = readFileSync(CANONICAL);
if (!canonBytes.equals(origBytes)) fail("canonical lesson.json was mutated during the e2e");

rmSync(root, { recursive: true, force: true });
console.log(`\nOK — full learner-as-author loop proved end-to-end:`);
console.log(`     author -> peer(rate) -> teacher(approve+IRI+ts) -> emit  ⟶  discover -> load -> grade.`);
console.log(`     The 3s radial-nodes item (correct = '2') is graded correct by the existing quizGrader,`);
console.log(`     the canonical atomistique-l1 was never mutated, and the author stayed invisible.`);
