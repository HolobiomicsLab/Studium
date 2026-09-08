// tools/bundle_lint.mjs
//
// Repo-level lint for AUTHORED teaching material. Walks every fixtures/**/lesson.json and runs
// deterministic (non-LLM) checks that a schema parse alone cannot express: an answer key with two
// correct choices, a render asset pointing at a file that is not on disk, a planted flaw the scene's
// own reveal never explains, two scenes sharing an id. Promoted from
// fixtures/atomistique-l1/validate_bundle.mjs (which only parsed ONE bundle) and wired into CI.
//
// Run from the repo root:
//   node_modules/.pnpm/node_modules/.bin/tsx tools/bundle_lint.mjs                    # every fixture bundle
//   node_modules/.pnpm/node_modules/.bin/tsx tools/bundle_lint.mjs path/lesson.json   # named bundles only
// Exit 0 = clean, 1 = at least one error. Tested by tools/bundle_lint.test.sh.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LessonBundleSchema, sceneRenderAssets } from "../packages/lesson-bundle-schema/src/index.ts";
import { loadBundleJson } from "../packages/lesson-session/src/adapters/bundle-loader.ts";
import { matchClaimsAgainstCritique } from "../packages/lesson-session/src/grading/ai-audit-matcher.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES_DIR = join(REPO_ROOT, "fixtures");
const BUNDLE_FILENAME = "lesson.json";
const SKIPPED_DIRS = new Set(["node_modules", "dist", "__pycache__"]);
const MAX_REPORTED_SCHEMA_ISSUES = 5;
const EXPECTED_CORRECT_CHOICES = 1;

// Pre-existing reveal gaps in fixtures this change may not edit. Key = "<repo-relative bundle>::<scene>::<flaw>".
// Quarantined, NOT excused: each is reported as WARN, and an entry whose defect is gone is reported as
// stale — so the list cannot outlive the defects. Delete the entry once the fixture's reveal is fixed.
// Bundles that fail SCHEMA validation, quarantined on the same terms as KNOWN_FLAW_GAPS: reported on
// every run, and flagged stale the moment the bundle parses again, so an entry cannot outlive its defect.
// Empty since 2026-09-08 (INT-STUDIUM-004): the M6 demo entry is gone because the bundle is
// repaired, not because the entry was tidied away. Its defect — `evidence.abs_asset` and
// `bibliographic_refs[].doi` emitted as null where the schema expects an object/string or
// absence — was not the fixture's alone: `services/scene-synth/bundler.py` dumped every bundle
// with `exclude_none=False`, so this was the first bundle whose evidence was ever populated and
// therefore the first to show it. The emitter is fixed and guarded by
// `services/scene-synth/tests/test_bundle_null_contract.py`. The map stays: it is the mechanism,
// and an entry that outlives its defect is still reported as stale below.
const KNOWN_BROKEN_BUNDLES = new Map([]);

const KNOWN_FLAW_GAPS = new Map([
  // capsule-judgment-demo's five entries were deleted on 2026-09-08 (INT-STUDIUM-004): its reveal is
  // now built one clause per planted flaw by tools/build_capsule_judgment_demo.py, so every flaw it
  // plants is explained. The stale-entry detector below is what reported them gone.
  ["fixtures/capsule-loop-demo/lesson.json::s-flaw::unites",
    "reveal writes «unite de temps» (singular); the key expects «unites»"],
]);

/** Every lesson bundle under a directory, recursively. Input: an absolute directory path.
 * Output: absolute paths of the lesson.json files found. */
function findBundles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const isWalkable = entry.isDirectory() && !SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith(".");
    if (isWalkable) found.push(...findBundles(full));
    else if (entry.isFile() && entry.name === BUNDLE_FILENAME) found.push(full);
  }
  return found.sort();
}

/** Schema issues, capped so one broken bundle does not flood the log.
 * Input: a ZodError. Output: one human-readable line per reported issue. */
function schemaIssues(error) {
  return error.issues
    .slice(0, MAX_REPORTED_SCHEMA_ISSUES)
    .map((issue) => `schema: ${issue.path.join(".") || "<root>"} — ${issue.message}`);
}

/** Scene ids declared more than once (a duplicate makes progress and grading ambiguous).
 * Input: the parsed scenes. Output: the duplicated ids. */
function duplicateSceneIds(scenes) {
  const seen = new Set();
  const duplicates = new Set();
  for (const scene of scenes) (seen.has(scene.id) ? duplicates : seen).add(scene.id);
  return [...duplicates];
}

/** Quiz scenes whose answer key is not exactly one correct choice (single-answer quizzes are the
 * only kind the schema declares). Input: the parsed scenes. Output: one error line per bad quiz. */
function quizAnswerKeyErrors(scenes) {
  const quizzes = scenes.filter((scene) => scene.type === "quiz");
  return quizzes
    .map((scene) => ({ id: scene.id, correct: scene.choices.filter((c) => c.correct).length }))
    .filter((q) => q.correct !== EXPECTED_CORRECT_CHOICES)
    .map((q) => `${q.id}: ${q.correct} correct choices (expected ${EXPECTED_CORRECT_CHOICES})`);
}

/** Render assets whose file is not on disk (the learner would get an empty artifact pane). Paths
 * resolve against the bundle dir, like the session host does. Inputs: the parsed scenes, the bundle
 * directory. Output: one error line per unresolved asset. */
function unresolvedAssetErrors(scenes, bundleDir) {
  return scenes.flatMap((scene) =>
    sceneRenderAssets(scene)
      .filter((asset) => asset.path && !existsSync(resolve(bundleDir, asset.path)))
      .map((asset) => `${scene.id}: unresolved render asset (${asset.kind}) -> ${asset.path}`),
  );
}

/** Whether the offline flaw grader's own matcher would credit `token` in `text`. Reusing the grader
 * keeps lint and grade in agreement (same accent/superscript folding). Inputs: a flaw keyword, the
 * text to search. Output: true when that keyword would score. */
function isCreditedBy(token, text) {
  const oneFlawKey = [{ id: "lint", flaws_expected: [token] }];
  return matchClaimsAgainstCritique(oneFlawKey, text).true_positives > 0;
}

/** Whether a scene carries a planted-flaw answer key AND its reveal (spot_the_flaw, summary_audit).
 * Input: a parsed scene. Output: true when both fields are present. */
function hasFlawAnswerKey(scene) {
  return "claims" in scene && "model_correction" in scene;
}

/** Flaw keywords the scene's own model_correction would not credit — the reveal must explain every
 * flaw the grader scores, else a learner who catches one gets no explanation of it. Input: one scene
 * with a flaw answer key. Output: the uncredited keywords, deduplicated. */
function uncreditedFlawTokens(scene) {
  const tokens = new Set(scene.claims.flatMap((claim) => claim.flaws_expected));
  return [...tokens].filter((token) => !isCreditedBy(token, scene.model_correction));
}

/** Split a bundle's uncredited flaw keywords into hard errors and quarantined warnings.
 * Inputs: the parsed scenes, the bundle's repo-relative path. Output:
 * { flawErrors, flawWarnings, waiversHit } — lines to print plus the KNOWN_FLAW_GAPS keys matched. */
function flawRevealReport(scenes, bundlePath) {
  const gaps = scenes.filter(hasFlawAnswerKey).flatMap((scene) =>
    uncreditedFlawTokens(scene).map((token) => ({ key: `${bundlePath}::${scene.id}::${token}`, scene: scene.id, token })),
  );
  const isWaived = (gap) => KNOWN_FLAW_GAPS.has(gap.key);
  const line = (gap) => `${gap.scene}: flaw "${gap.token}" is never named in model_correction`;
  const waived = gaps.filter(isWaived);
  return {
    flawErrors: gaps.filter((gap) => !isWaived(gap)).map(line),
    flawWarnings: waived.map((gap) => `${line(gap)} [known: ${KNOWN_FLAW_GAPS.get(gap.key)}]`),
    waiversHit: waived.map((gap) => gap.key),
  };
}

/** Run every deterministic check on one bundle. Input: an absolute lesson.json path.
 * Output: { errors, warnings, waiversHit, sceneCount } for the reporter. */
function lintBundle(file) {
  const parsed = LessonBundleSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) return { errors: schemaIssues(parsed.error), warnings: [], waiversHit: [], sceneCount: 0 };
  const scenes = parsed.data.scenes;
  const flaws = flawRevealReport(scenes, relative(REPO_ROOT, file));
  const errors = [
    ...duplicateSceneIds(scenes).map((id) => `duplicate scene id: ${id}`),
    ...quizAnswerKeyErrors(scenes),
    ...unresolvedAssetErrors(scenes, dirname(file)),
    ...flaws.flawErrors,
  ];
  return { errors, warnings: flaws.flawWarnings, waiversHit: flaws.waiversHit, sceneCount: scenes.length };
}

/** Whether a failing bundle is one of the quarantined known-broken fixtures.
 * Inputs: the bundle path, its lint result. Output: true when the failure is waived. */
function isQuarantined(file, result) {
  return result.errors.length > 0 && KNOWN_BROKEN_BUNDLES.has(relative(REPO_ROOT, file));
}

/** Print one bundle's result. Inputs: the bundle path, its lint result. Output: none (writes to the
 * console); the caller decides the exit code. */
function report(file, result) {
  const name = relative(REPO_ROOT, file);
  const quarantined = isQuarantined(file, result);
  const status = result.errors.length === 0 ? "OK  " : quarantined ? "QUAR" : "FAIL";
  console.log(`${status} ${name} — ${result.sceneCount} scenes`);
  if (quarantined) console.log(`     known: ${KNOWN_BROKEN_BUNDLES.get(name)}`);
  for (const warning of result.warnings) console.log(`     WARN ${warning}`);
  for (const error of result.errors) (quarantined ? console.log : console.error)(`     ${error}`);
}

/** Quarantined gaps that no longer reproduce (the fixture was fixed but the entry stayed).
 * Input: the waiver keys matched during this run. Output: the stale keys. */
function staleWaivers(hitKeys) {
  return [...KNOWN_FLAW_GAPS.keys()].filter((key) => !hitKeys.has(key));
}

/** Lint the given bundles (or every fixture bundle when none are named).
 * Input: the CLI arguments. Output: the process exit code. */
function main(args) {
  const files = args.length > 0 ? args.map((arg) => resolve(arg)) : findBundles(FIXTURES_DIR);
  const results = files.map((file) => [file, lintBundle(file)]);
  for (const [file, result] of results) report(file, result);
  const failed = results.filter(([file, result]) => result.errors.length > 0 && !isQuarantined(file, result)).length;
  for (const [file, result] of results) {
    const name = relative(REPO_ROOT, file);
    if (KNOWN_BROKEN_BUNDLES.has(name) && result.errors.length === 0) {
      console.error(`stale KNOWN_BROKEN_BUNDLES entry (bundle parses now — delete it): ${name}`);
    }
  }
  const hitKeys = new Set(results.flatMap(([, result]) => result.waiversHit));
  const stale = args.length > 0 ? [] : staleWaivers(hitKeys); // a targeted run visits only some bundles
  for (const key of stale) console.error(`stale KNOWN_FLAW_GAPS entry (defect gone — delete it): ${key}`);
  console.log(`\n${files.length} bundle(s) linted, ${failed} failing, ${hitKeys.size} known gap(s) quarantined`);
  const revived = results.filter(([file, result]) =>
    KNOWN_BROKEN_BUNDLES.has(relative(REPO_ROOT, file)) && result.errors.length === 0).length;
  return failed > 0 || stale.length > 0 || revived > 0 ? 1 : 0;
}

process.exit(main(process.argv.slice(2)));
