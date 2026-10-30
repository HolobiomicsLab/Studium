#!/usr/bin/env bash
# Contract tests for the dependency-free authored-bundle lint.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINT="$ROOT/tools/bundle_lint.mjs"
FIXTURES="$ROOT/tools/fixtures/bundle-lint"
BASE="$ROOT/fixtures/capsule-run-demo/lesson.json"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

test -f "$LINT" || { echo "FAIL: $LINT absent"; exit 1; }

OUTPUT=""
STATUS=0

run_lint() {
  set +e
  OUTPUT="$(node "$LINT" "$@" 2>&1)"
  STATUS=$?
  set -e
}

assert_finding_format() {
  local malformed
  [ -z "$OUTPUT" ] && return
  malformed="$(grep -Ev '^(ERROR|WARN|INFO)  .+  [a-z0-9_]+  .+$' <<<"$OUTPUT" || true)"
  [ -z "$malformed" ] || { echo "FAIL: malformed finding"; echo "$malformed"; exit 1; }
}

expect_finding() {
  local name="$1"
  local expected_status="$2"
  local code="$3"
  local file="$4"
  run_lint "$file"
  [ "$STATUS" -eq "$expected_status" ] || { echo "FAIL: $name exited $STATUS, expected $expected_status"; echo "$OUTPUT"; exit 1; }
  grep -Fq "  $code  " <<<"$OUTPUT" || { echo "FAIL: $name did not report $code"; echo "$OUTPUT"; exit 1; }
  assert_finding_format
  echo "OK: $name -> $code"
}

expect_clean() {
  local name="$1"
  shift
  run_lint "$@"
  [ "$STATUS" -eq 0 ] || { echo "FAIL: $name exited $STATUS"; echo "$OUTPUT"; exit 1; }
  [ -z "$OUTPUT" ] || { echo "FAIL: $name emitted findings"; echo "$OUTPUT"; exit 1; }
  echo "OK: $name"
}

# New learning_workflow_graph cases.
expect_clean "clean graph" "$FIXTURES/clean/lesson.json"
expect_finding "natural-reading flipped edge" 1 "lwg_locked_before_prereq" "$FIXTURES/flipped-edge/lesson.json"
grep -Fq "source = dependent concept, target = its prerequisite; flip the edge if you meant the opposite" <<<"$OUTPUT" || { echo "FAIL: flipped-edge guidance omits the engine convention"; echo "$OUTPUT"; exit 1; }
grep -Fq 'concept:root is carried by the first concept scene "s-root" and is locked at start' <<<"$OUTPUT" || { echo "FAIL: first-scene lock was not reported"; echo "$OUTPUT"; exit 1; }
grep -Fq 'concept:foundation first appears in "s-foundation" while concept:advanced first appears later' <<<"$OUTPUT" || { echo "FAIL: later out-of-order prerequisite was not reported"; echo "$OUTPUT"; exit 1; }
expect_finding "prerequisite cycle" 1 "lwg_cycle" "$FIXTURES/cycle/lesson.json"
expect_finding "unassessable prerequisite" 0 "lwg_prereq_unassessable" "$FIXTURES/unassessable/lesson.json"
grep -Fq "quiz, ai_critique" <<<"$OUTPUT" || { echo "FAIL: unassessable warning omits graded types"; echo "$OUTPUT"; exit 1; }
expect_finding "unknown graph endpoint" 1 "lwg_unknown_node" "$FIXTURES/unknown-node/lesson.json"
grep -Fq 'graph node "advanced" must be concept:<id>' <<<"$OUTPUT" || { echo "FAIL: unknown-node case did not check the concept: prefix"; echo "$OUTPUT"; exit 1; }
grep -Fq 'target "concept:missing" is not a declared graph node' <<<"$OUTPUT" || { echo "FAIL: unknown-node case did not check edge endpoints"; echo "$OUTPUT"; exit 1; }
expect_finding "single graded prerequisite" 0 "lwg_single_graded_item" "$FIXTURES/single-graded/lesson.json"
grep -Fq "one correct answer cannot reach theta, the gate will pass it on a correct answer" <<<"$OUTPUT" || { echo "FAIL: single-item information omits gate behaviour"; echo "$OUTPUT"; exit 1; }

# Who wrote the key (metadata.authoring, spec 2026-10-30 « Classes de clé »). The all-types
# fixture must hold exactly one scene per SceneType of the Zod schema, so a new scene type
# fails here until SCENE_KEY_CLASS in bundle_lint.mjs classifies it.
SCENE_TYPES_TS="$ROOT/packages/lesson-bundle-schema/src/scenes.ts"
ALL_TYPES="$FIXTURES/self-study-all-types/lesson.json"
zod_types="$(sed -n '/export const SceneTypeSchema = z.enum(\[/,/\]);/p' "$SCENE_TYPES_TS" | grep -o '"[a-z_]*"' | tr -d '"' | LC_ALL=C sort)"
fixture_types="$(node -e "const b=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(b.scenes.map((s)=>s.type).sort().join('\n'))" "$ALL_TYPES")"
[ -n "$zod_types" ] || { echo "FAIL: no SceneType enum found in $SCENE_TYPES_TS"; exit 1; }
[ "$zod_types" = "$fixture_types" ] || { echo "FAIL: self-study-all-types must hold one scene per SceneType"; echo "zod: $zod_types"; echo "fixture: $fixture_types"; exit 1; }
expect_finding "self-study key classes of every scene type" 0 "self_study_authoring" "$ALL_TYPES"
grep -Fq "key classes: author_keyed=2 (s-quiz, s-spot_the_flaw) production=7 (s-explain_back, s-comparison, s-summary_audit, s-prompt_practice, s-communication_sim, s-discussion, s-ai_critique) externally_grounded=1 (s-reproduction) ungraded=3" <<<"$OUTPUT" || { echo "FAIL: key classes differ from the spec table"; echo "$OUTPUT"; exit 1; }
grep -Fq "unknown=" <<<"$OUTPUT" && { echo "FAIL: a schema scene type has no key class"; echo "$OUTPUT"; exit 1; }

expect_finding "self-study open book" 0 "self_study_open_book" "$FIXTURES/self-study-open-book/lesson.json"
grep -Eq '^WARN  .+  self_study_open_book  ' <<<"$OUTPUT" || { echo "FAIL: open book is not a WARN"; echo "$OUTPUT"; exit 1; }
grep -Fq "s-foundation-quiz-1, s-foundation-quiz-2: " <<<"$OUTPUT" || { echo "FAIL: open-book warning does not list the author-keyed scenes"; echo "$OUTPUT"; exit 1; }
grep -Fq 'mode=self_study author_is_learner=true validated_by="SELF-STUDY' <<<"$OUTPUT" || { echo "FAIL: self_study_authoring omits mode, author or validator"; echo "$OUTPUT"; exit 1; }
grep -Fq "self_study_no_external_key" <<<"$OUTPUT" && { echo "FAIL: an explain_back scene is a production key"; echo "$OUTPUT"; exit 1; }
expect_finding "self-study without an external key" 0 "self_study_no_external_key" "$FIXTURES/self-study-no-external-key/lesson.json"
expect_finding "learner-authored teacher bundle" 0 "learner_authored_validated" "$FIXTURES/learner-authored/lesson.json"
grep -Fq "self_study_" <<<"$OUTPUT" && { echo "FAIL: a teacher-released bundle was reported as self-study"; echo "$OUTPUT"; exit 1; }

node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));b.scenes.push({...b.scenes[0],id:'s-hologram',type:'hologram'});fs.writeFileSync(process.argv[2],JSON.stringify(b));" "$FIXTURES/self-study-no-external-key/lesson.json" "$TMP/unknown-type.json"
expect_finding "unknown scene type is counted, not fatal" 0 "self_study_authoring" "$TMP/unknown-type.json"
grep -Fq "unknown=1 (s-hologram)" <<<"$OUTPUT" || { echo "FAIL: unknown scene type was not counted"; echo "$OUTPUT"; exit 1; }
node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));b.metadata.authoring={mode:'teacher'};fs.writeFileSync(process.argv[2],JSON.stringify(b));" "$FIXTURES/clean/lesson.json" "$TMP/teacher.json"
expect_clean "teacher authoring without a learner author" "$TMP/teacher.json"

# --root visits every */lesson.json at depth <= 2 and aggregates failures.
run_lint --root "$FIXTURES"
[ "$STATUS" -eq 1 ] || { echo "FAIL: fixture root should fail on ERROR findings"; echo "$OUTPUT"; exit 1; }
for code in lwg_locked_before_prereq lwg_cycle lwg_prereq_unassessable lwg_unknown_node lwg_single_graded_item; do
  grep -Fq "  $code  " <<<"$OUTPUT" || { echo "FAIL: root scan omitted $code"; echo "$OUTPUT"; exit 1; }
done
assert_finding_format
echo "OK: --root aggregates all graph cases"

mkdir -p "$TMP/depth/one/two"
cp "$FIXTURES/clean/lesson.json" "$TMP/depth/one/lesson.json"
cp "$FIXTURES/unknown-node/lesson.json" "$TMP/depth/one/two/lesson.json"
expect_clean "--root stops after depth 2" --root "$TMP/depth"

# Legacy checks remain active without TypeScript imports.
PRELUDE="\
const quiz=(choices)=>({id:'s-q',type:'quiz',title:'Q',objective_refs:[],concept_refs:['c-kinetics'],\
estimated_seconds:10,adaptation_hooks:[],question:'?',feedback_correct:'ok',feedback_incorrect:'non',hints:[],choices});\
const flaw=(model_correction)=>({id:'s-f',type:'spot_the_flaw',title:'F',objective_refs:[],concept_refs:['c-kinetics'],\
estimated_seconds:10,adaptation_hooks:[],flawed_content:'x',rubric:{completeness:0.6,evidence_quality:0.3,tone:0.1},\
claims:[{id:'c1',text:'t',flaws_expected:['hund']}],model_correction});"

mutate() {
  node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));$PRELUDE$2;fs.writeFileSync(process.argv[2],JSON.stringify(b));" "$BASE" "$TMP/$1"
}

mutate dup.json "b.scenes.push(JSON.parse(JSON.stringify(b.scenes[0])))"
expect_finding "duplicate scene id" 1 "duplicate_scene_id" "$TMP/dup.json"

mutate two-correct.json "b.scenes.push(quiz([{id:'a',text:'A',correct:true},{id:'b',text:'B',correct:true}]))"
expect_finding "two correct quiz choices" 1 "quiz_answer_key" "$TMP/two-correct.json"

mutate no-correct.json "b.scenes.push(quiz([{id:'a',text:'A',correct:false},{id:'b',text:'B',correct:false}]))"
expect_finding "zero correct quiz choices" 1 "quiz_answer_key" "$TMP/no-correct.json"

mutate missing-asset.json "b.scenes[0].render_assets=[{kind:'image',path:'assets/absent.png'}]"
expect_finding "missing render asset" 1 "unresolved_asset" "$TMP/missing-asset.json"

mutate blank-asset.json "b.scenes[0].render_assets=[{kind:'svg',title:'empty'}]"
expect_finding "blank render asset" 1 "schema_invalid" "$TMP/blank-asset.json"

mutate orphan-flaw.json "b.scenes.push(flaw('nothing relevant'))"
expect_finding "unexplained planted flaw" 1 "flaw_reveal_gap" "$TMP/orphan-flaw.json"

mutate sound-flaw.json "b.scenes.push(flaw('Hund requires parallel spins'))"
expect_clean "covered planted flaw" "$TMP/sound-flaw.json"

run_lint
[ "$STATUS" -eq 0 ] || { echo "FAIL: repo fixtures do not pass"; echo "$OUTPUT"; exit 1; }
grep -Eq '^ERROR  ' <<<"$OUTPUT" && { echo "FAIL: repo fixtures emitted an ERROR"; echo "$OUTPUT"; exit 1; }
assert_finding_format
echo "OK: repository fixtures pass with warnings/information only"

echo "OK: bundle_lint.mjs graph and legacy contracts pass"
