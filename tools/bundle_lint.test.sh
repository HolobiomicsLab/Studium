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

# Who drafted the key (metadata.authoring.drafted_by, contract C3): an agent-drafted key is not
# open book, it is unchecked by a teacher; the INFO line names the effective drafter.
node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));b.metadata.authoring={mode:'self_study',author_is_learner:false,drafted_by:'agent'};fs.writeFileSync(process.argv[2],JSON.stringify(b));" "$FIXTURES/self-study-open-book/lesson.json" "$TMP/agent-drafted.json"
expect_finding "agent-drafted self-study key" 0 "self_study_agent_key" "$TMP/agent-drafted.json"
grep -Eq '^WARN  .+  self_study_agent_key  s-foundation-quiz-1, s-foundation-quiz-2: .*drafted by an agent.*not checked by a teacher' <<<"$OUTPUT" || { echo "FAIL: agent-key warning does not name the scenes and the unchecked agent key"; echo "$OUTPUT"; exit 1; }
grep -Fq "self_study_open_book" <<<"$OUTPUT" && { echo "FAIL: an agent-drafted key was reported as open book"; echo "$OUTPUT"; exit 1; }
grep -Fq 'drafted_by=agent; key classes:' <<<"$OUTPUT" || { echo "FAIL: self_study_authoring omits drafted_by"; echo "$OUTPUT"; exit 1; }
run_lint "$FIXTURES/self-study-open-book/lesson.json"
grep -Fq 'drafted_by=learner; key classes:' <<<"$OUTPUT" || { echo "FAIL: a pre-C3 learner bundle is not read as drafted by the learner"; echo "$OUTPUT"; exit 1; }
echo "OK: drafted_by decides between open book and an unchecked agent key"

# Unfilled skeleton placeholders (AUTH-1): a learner-visible or grading string that starts with TODO
# or contains "TODO:" is an ERROR; todo-* stays allowed in identifier fields only.
node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const q=b.scenes[1];q.question='TODO: rédiger la question';q.choices[0].id='todo-correct';q.choices[1].text='TODO distracteur';b.metadata.discipline='TODO: discipline à préciser';b.scenes[0].markdown='Un texte fini qui cite la règle « TODO: » des squelettes.';fs.writeFileSync(process.argv[2],JSON.stringify(b));" "$FIXTURES/self-study-open-book/lesson.json" "$TMP/placeholders.json"
expect_finding "unfilled skeleton placeholders" 1 "unfilled_placeholder" "$TMP/placeholders.json"
for path in "scenes.1.question" "scenes.1.choices.1.text" "metadata.discipline" "scenes.0.markdown"; do
  grep -Eq "^ERROR  .+  unfilled_placeholder  $path: " <<<"$OUTPUT" || { echo "FAIL: placeholder at $path not reported as an ERROR"; echo "$OUTPUT"; exit 1; }
done
grep -Fq 'scenes.1.question: unfilled placeholder "TODO: rédiger la question"' <<<"$OUTPUT" || { echo "FAIL: the placeholder finding does not quote the text"; echo "$OUTPUT"; exit 1; }
grep -Fq "choices.0.id" <<<"$OUTPUT" && { echo "FAIL: a todo-* identifier was reported"; echo "$OUTPUT"; exit 1; }
[ "$(grep -c '  unfilled_placeholder  ' <<<"$OUTPUT")" -eq 4 ] || { echo "FAIL: expected exactly 4 placeholder findings"; echo "$OUTPUT"; exit 1; }
node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));b.scenes[1].task_card_id='TODO:s-repro:task-card';b.scenes[1].steps[0].step_id='TODO-step';fs.writeFileSync(process.argv[2],JSON.stringify(b));" "$BASE" "$TMP/placeholder-id.json"
expect_finding "placeholder inside an identifier field" 1 "unfilled_placeholder" "$TMP/placeholder-id.json"
grep -Fq "scenes.1.task_card_id: " <<<"$OUTPUT" || { echo "FAIL: a TODO: task card id was not reported"; echo "$OUTPUT"; exit 1; }
grep -Fq "step_id" <<<"$OUTPUT" && { echo "FAIL: a TODO-* step id was reported"; echo "$OUTPUT"; exit 1; }
echo "OK: unfilled placeholders are ERRORs, todo-* identifiers are not"

# A quoted source is not the author's placeholder: evidence excerpts are copied verbatim from the
# source, and a programming text that itself holds "TODO:" must not make the lesson unfixable.
node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));b.scenes[1].evidence={bibliographic_refs:[{id:'ref-1',title:'Notes de code',excerpt:'// TODO: handle the empty list'}]};fs.writeFileSync(process.argv[2],JSON.stringify(b));" "$FIXTURES/self-study-open-book/lesson.json" "$TMP/evidence-todo.json"
run_lint "$TMP/evidence-todo.json"
grep -Fq "unfilled_placeholder" <<<"$OUTPUT" && { echo "FAIL: a quoted source holding TODO: was reported as an unfilled placeholder"; echo "$OUTPUT"; exit 1; }
node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));b.scenes[1].question='TODO: rédiger la question';fs.writeFileSync(process.argv[2],JSON.stringify(b));" "$TMP/evidence-todo.json" "$TMP/evidence-todo-and-question.json"
expect_finding "a real placeholder beside a quoted TODO: is still reported" 1 "unfilled_placeholder" "$TMP/evidence-todo-and-question.json"
[ "$(grep -c '  unfilled_placeholder  ' <<<"$OUTPUT")" -eq 1 ] || { echo "FAIL: only the question should be reported"; echo "$OUTPUT"; exit 1; }
grep -Eq "unfilled_placeholder  [^ ]*evidence" <<<"$OUTPUT" && { echo "FAIL: the evidence excerpt was reported"; echo "$OUTPUT"; exit 1; }
echo "OK: evidence (quoted source text) is not scanned for placeholders"

# The lint core is importable (the MCP authoring route lints in process) without running the CLI.
set +e
IMPORT_OUTPUT="$(node --input-type=module -e "
import { lintBundleData, placeholderPaths } from '$LINT';
import { readFileSync } from 'node:fs';
const bundle = JSON.parse(readFileSync('$TMP/placeholders.json', 'utf8'));
const { findings } = lintBundleData(bundle, { bundleDir: '$TMP' });
const codes = findings.filter((item) => item.level === 'ERROR').map((item) => item.code);
if (codes.length !== 4 || codes.some((code) => code !== 'unfilled_placeholder')) { console.error(JSON.stringify(findings)); process.exit(3); }
if (JSON.stringify(placeholderPaths({ a: ['TODO: x'], id: 'todo-1' })) !== JSON.stringify(['a.0'])) process.exit(4);
" 2>&1)"
IMPORT_STATUS=$?
set -e
[ "$IMPORT_STATUS" -eq 0 ] || { echo "FAIL: importing the lint core failed ($IMPORT_STATUS)"; echo "$IMPORT_OUTPUT"; exit 1; }
[ -z "$IMPORT_OUTPUT" ] || { echo "FAIL: importing the lint core ran the CLI"; echo "$IMPORT_OUTPUT"; exit 1; }
echo "OK: the lint core is importable without running the CLI"

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

printf 'null' > "$TMP/null.json"
expect_finding "a JSON null is not a bundle" 1 "schema_invalid" "$TMP/null.json"

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
