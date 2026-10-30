English · [Français](lesson-bundle.fr.md)

# Lesson bundle format

A Studium lesson is one JSON file, `lesson.json`, usually in its own folder with the media it refers
to. Every surface (MCP server, VS Code pane, HTTP servers, teacher dashboard) reads the same format.
This page describes it field by field; the tables are generated from the Zod schemas in
[packages/lesson-bundle-schema](../../packages/lesson-bundle-schema/src/index.ts), which are the
reference. A Pydantic mirror for the Python services lives in
`packages/lesson-bundle-schema/python/`.

To write a lesson, start from [Author a lesson](../teach/author-a-lesson.md) or let an assistant
build one with the [authoring tools](mcp-tools.md#authoring-tools). What each scene type asks of the
learner is explained in [Scene types](../concepts/scene-types.md).

## A bundle on disk

```text
my-course/
  lesson.json      the bundle (this format)
  approval.json    written by `experience_packet.py approve`, bound to the exact bytes of lesson.json
  media/...        files that render_assets or image_path point to, relative to the folder
```

A `bundle_ref` (the argument of `start_lesson_session`) is a path relative to the lessons folder: a
`lesson.json`, its folder, or a `.zip` bundle. Lessons built by an assistant land in the learner's
library, `<STUDIUM_HOME>/library` (see [Configuration](configuration.md)). Working examples:
[fixtures/capsule-run-demo/lesson.json](../../fixtures/capsule-run-demo/lesson.json) (two scenes) and
[fixtures/atomistique-l1/lesson.json](../../fixtures/atomistique-l1/lesson.json) (a full course).

## Check a bundle

```bash
# Schema: exit 0 and "OK <file>: N scenes" when the file parses
node_modules/.pnpm/node_modules/.bin/tsx tools/bundle_validate.ts path/to/lesson.json

# Teaching-material lint: ERROR findings fail, WARN and INFO do not
node tools/bundle_lint.mjs path/to/lesson.json
```

The linter goes beyond the schema: a quiz needs exactly one correct choice, an unfilled `TODO`
placeholder is an error, graph relations and asset kinds must be known ones, and self-study bundles
get findings about who wrote the key. Both commands are described in the [CLI reference](cli.md).

## Who wrote it, and who checked it

`metadata.authoring` tells every surface how to present the lesson honestly:

| Field | Values | Meaning |
|---|---|---|
| `mode` | `teacher`, `self_study` | A teacher's lesson, or one the learner (or their assistant) made from references they chose. |
| `drafted_by` | `agent`, `learner`, `teacher` | Who wrote the content and its answer keys. An `agent` draft opens with a notice that an AI drafted it from the learner's sources and no teacher checked it. |
| `author_is_learner` | `true`, `false` | The person who answers also wrote the lesson. |
| `learner_profile` | `{minutes_per_day?, target_date?}` | The learner's minutes a day (1 to 600) and target date, kept by `create_lesson`; the study plan sizes the next step with the minutes. What the learner said they know or like is never stored here. |

Two more fields carry provenance. A scene marked `diagnostic: true` is an opening question on what the
learner already knows: it is played once and never chosen for a review. A citation in
`evidence.bibliographic_refs[]` can carry the source's `license`, which surfaces show after its title.

A bundle without `metadata.authoring` (older bundles) is read as a teacher's lesson. `validated_by`
and `validated_at` record the teacher's review; `experience_packet.py approve` sets them and writes
`approval.json` with the SHA-256 of the final bytes, so any later edit shows as unapproved. A
self-study bundle cannot be approved.

## Field reference

<!-- BEGIN GENERATED: lesson-bundle (tools/docs/gen-lesson-bundle.mjs; do not edit by hand) -->

Schema version: `1.4`. Field tables are generated from the Zod schemas; rules that span several fields (weights that sum to 1, ids that must exist) are checked by the schema and the linter but do not appear here.

## Bundle

| Field | Type | Required | Description |
|---|---|---|---|
| `schema_version` | `1.4` | yes |  |
| `bundle_id` | string | yes |  |
| `source_plan_id` | string | yes |  |
| `metadata` | object | yes | See [Metadata](#metadata). |
| `concepts` | array of objects, at least 1 item | yes | See [Concept](#concept). |
| `scenes` | array of objects of 13 shapes, at least 1 item | yes | See [Scene types](#scene-types). |
| `rules` | array of objects | yes | See [Adaptation rule](#adaptation-rule). |
| `validated_by` | string (at least 3 chars) | yes |  |
| `validated_at` | string, date-time | yes |  |
| `assessment_blueprint` | object | no | See [Assessment blueprint](#assessment-blueprint). |
| `learning_workflow_graph` | object or null | no |  |
| `universes` | object or null | no |  |

## Metadata

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes |  |
| `target` | string | yes |  |
| `duration_minutes` | integer (> 0) | yes |  |
| `language` | string (at least 2 chars) | yes |  |
| `discipline` | string | yes |  |
| `authoring` | object | no |  |
| `authoring.mode` | one of `teacher`, `self_study` | yes |  |
| `authoring.author_is_learner` | boolean | no | Default `false`. |
| `authoring.drafted_by` | one of `agent`, `learner`, `teacher` | no |  |
| `authoring.note` | string | no |  |
| `authoring.learner_profile` | object | no |  |

## Concept

| Field | Type | Required |
|---|---|---|
| `id` | string | yes |
| `title` | string | yes |
| `description` | string | yes |
| `bloom_level_target` | one of `remember`, `understand`, `apply`, `analyze`, `evaluate`, `create` | yes |

## Scene fields

Every scene, whatever its type, has these fields.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (non-empty) | yes |  |
| `type` | one of `intro`, `concept`, `quiz`, `meta_checkpoint`, `reproduction`, `ai_critique`, `discussion`, `spot_the_flaw`, `explain_back`, `comparison`, `summary_audit`, `prompt_practice`, `communication_sim` | yes |  |
| `title` | string (non-empty) | yes |  |
| `objective_refs` | array of string | yes |  |
| `concept_refs` | array of string | yes |  |
| `estimated_seconds` | integer (≥ 0) | yes |  |
| `adaptation_hooks` | array of string | yes |  |
| `render_assets` | array of objects | no | See [Render asset](#render-asset). |
| `evidence` | object | no | See [Evidence](#evidence). |
| `diagnostic` | boolean | no |  |

## Scene types

13 types. Each table lists the fields a type adds to the [scene fields](#scene-fields).

### intro

| Field | Type | Required |
|---|---|---|
| `markdown` | string | yes |

### concept

| Field | Type | Required |
|---|---|---|
| `markdown` | string | yes |
| `image_path` | string | no |

### quiz

| Field | Type | Required |
|---|---|---|
| `question` | string | yes |
| `choices` | array of objects, 2–6 items | yes |
| `choices[].id` | string | yes |
| `choices[].text` | string | yes |
| `choices[].correct` | boolean | yes |
| `feedback_correct` | string | yes |
| `feedback_incorrect` | string | yes |
| `hints` | array of string | yes |

### meta_checkpoint

| Field | Type | Required |
|---|---|---|
| `pre_question` | string | yes |
| `post_question` | string | yes |
| `scale_labels` | array of string, 5 items | yes |

### reproduction

| Field | Type | Required |
|---|---|---|
| `task_card_id` | string | yes |
| `steps` | array of objects, at least 1 item | yes |
| `steps[].step_id` | string | yes |
| `steps[].instruction` | string | yes |
| `steps[].expected_input_schema` | object (free form) | yes |
| `steps[].expected_output` | string or object (free form) | yes |
| `prov_derived_from` | string, uri | no |
| `image_path` | string | no |
| `reference_result` | object | no |
| `reference_result.ran` | boolean | yes |
| `reference_result.passed` | boolean | yes |
| `reference_result.landmark` | string or null | yes |
| `reference_result.figure_path` | string or null | yes |
| `reference_result.checks` | array of objects | yes |
| `reference_result.checks[].check` | string | yes |
| `reference_result.checks[].passed` | boolean | yes |
| `reference_result.provenance` | object | yes |
| `reference_result.provenance.capsule_doi` | string or null | yes |
| `reference_result.provenance.cmd` | array of string | yes |
| `reference_result.provenance.env` | string | yes |
| `run_manifest` | object | no |
| `run_manifest.capsule_ref` | string (non-empty) | yes |
| `run_manifest.cmd` | array of string, at least 1 item | yes |
| `run_manifest.working_dir` | string or null | no |
| `run_manifest.timeout_s` | number (> 0) | no |
| `run_manifest.requirements` | array of string | no |
| `run_manifest.expected_outputs` | array of string | yes |
| `run_manifest.verify_checks` | array of string | yes |
| `run_manifest.research_question` | string | no |
| `run_manifest.landmark_pattern` | string | no |

### ai_critique

| Field | Type | Required |
|---|---|---|
| `claims` | array of objects, 1–3 items | yes |
| `claims[].id` | string | yes |
| `claims[].text` | string | yes |
| `claims[].flaws_expected` | array of string | yes |
| `rubric` | object | yes |
| `rubric.completeness` | number (0–1) | yes |
| `rubric.evidence_quality` | number (0–1) | yes |
| `rubric.tone` | number (0–1) | yes |

### discussion

| Field | Type | Required |
|---|---|---|
| `topic` | string (non-empty) | yes |
| `seed_claim` | string (non-empty) | yes |
| `target_signals` | array of one of `justification`, `hypothesis`, `question`, `counterexample`, `synthesis`, at least 1 item | yes |
| `max_turns` | integer (> 0) | yes |

### spot_the_flaw

| Field | Type | Required |
|---|---|---|
| `flawed_content` | string (non-empty) | yes |
| `claims` | array of objects, 1–5 items | yes |
| `claims[].id` | string | yes |
| `claims[].text` | string | yes |
| `claims[].flaws_expected` | array of string, at least 1 item | yes |
| `model_correction` | string (non-empty) | yes |
| `rubric` | object | yes |
| `rubric.completeness` | number (0–1) | yes |
| `rubric.evidence_quality` | number (0–1) | yes |
| `rubric.tone` | number (0–1) | yes |
| `reference_result` | object | no |
| `reference_result.ran` | boolean | yes |
| `reference_result.passed` | boolean | yes |
| `reference_result.landmark` | string or null | yes |
| `reference_result.figure_path` | string or null | yes |
| `reference_result.checks` | array of objects | yes |
| `reference_result.checks[].check` | string | yes |
| `reference_result.checks[].passed` | boolean | yes |
| `reference_result.provenance` | object | yes |
| `reference_result.provenance.capsule_doi` | string or null | yes |
| `reference_result.provenance.cmd` | array of string | yes |
| `reference_result.provenance.env` | string | yes |
| `sound_claims` | array of objects | no |
| `sound_claims[].id` | string | yes |
| `sound_claims[].text` | string | yes |
| `reference_from_run` | string | no |
| `regenerate_from_run` | boolean | no |
| `verdict_deck` | boolean | no |

### explain_back

| Field | Type | Required |
|---|---|---|
| `prompt` | string (non-empty) | yes |
| `key_points` | array of objects, 1–6 items | yes |
| `key_points[].id` | string | yes |
| `key_points[].text` | string | yes |
| `key_points[].cues` | array of string, at least 1 item | yes |
| `model_explanation` | string (non-empty) | yes |
| `rubric` | object | yes |
| `rubric.completeness` | number (0–1) | yes |
| `rubric.evidence_quality` | number (0–1) | yes |
| `rubric.tone` | number (0–1) | yes |

### comparison

| Field | Type | Required |
|---|---|---|
| `prompt` | string (non-empty) | yes |
| `artifact_a` | string (non-empty) | yes |
| `artifact_b` | string (non-empty) | yes |
| `key_points` | array of objects, at least 1 item | yes |
| `key_points[].id` | string | yes |
| `key_points[].text` | string | yes |
| `key_points[].cues` | array of string, at least 1 item | yes |
| `model_answer` | string (non-empty) | yes |
| `rubric` | object | yes |
| `rubric.completeness` | number (0–1) | yes |
| `rubric.evidence_quality` | number (0–1) | yes |
| `rubric.tone` | number (0–1) | yes |

### summary_audit

| Field | Type | Required |
|---|---|---|
| `source_content` | string (non-empty) | yes |
| `ai_summary` | string (non-empty) | yes |
| `claims` | array of objects, 1–5 items | yes |
| `claims[].id` | string | yes |
| `claims[].text` | string | yes |
| `claims[].flaws_expected` | array of string, at least 1 item | yes |
| `model_correction` | string (non-empty) | yes |
| `rubric` | object | yes |
| `rubric.completeness` | number (0–1) | yes |
| `rubric.evidence_quality` | number (0–1) | yes |
| `rubric.tone` | number (0–1) | yes |

### prompt_practice

| Field | Type | Required |
|---|---|---|
| `task` | string (non-empty) | yes |
| `starter_prompt` | string | no |
| `key_points` | array of objects, at least 1 item | yes |
| `key_points[].id` | string | yes |
| `key_points[].text` | string | yes |
| `key_points[].cues` | array of string, at least 1 item | yes |
| `model_prompt` | string (non-empty) | yes |
| `rubric` | object | yes |
| `rubric.completeness` | number (0–1) | yes |
| `rubric.evidence_quality` | number (0–1) | yes |
| `rubric.tone` | number (0–1) | yes |

### communication_sim

| Field | Type | Required |
|---|---|---|
| `scenario` | string (non-empty) | yes |
| `prompt` | string (non-empty) | yes |
| `key_points` | array of objects, at least 1 item | yes |
| `key_points[].id` | string | yes |
| `key_points[].text` | string | yes |
| `key_points[].cues` | array of string, at least 1 item | yes |
| `model_response` | string (non-empty) | yes |
| `rubric` | object | yes |
| `rubric.completeness` | number (0–1) | yes |
| `rubric.evidence_quality` | number (0–1) | yes |
| `rubric.tone` | number (0–1) | yes |

## Adaptation rule

| Field | Type | Required |
|---|---|---|
| `id` | string | yes |
| `when` | map of string | yes |
| `action` | object, one of 5 shapes | yes |
| `action.kind` | one of `advance_to_next_scene`, `replay_current_scene`, `skip_to_next_concept`, `show_calibration_panel`, `show_explanation_panel` | yes |
| `action.reason` | string | in `replay_current_scene` |
| `modulator` | one of `M1`, `M3`, `M6` | yes |
| `explanation_short` | string | yes |

## Render asset

| Field | Type | Required |
|---|---|---|
| `kind` | one of `image`, `audio`, `video`, `svg`, `equation_latex`, `plot_spec`, `code`, `data_csv`, `protocol_md`, `executed_result`, `orbital`, `mol_3d`, `spectrum` | yes |
| `title` | string | no |
| `payload` | string | no |
| `path` | string | no |
| `language` | string | no |
| `format` | string | no |
| `provenance` | string | no |
| `meta` | object (free form) | no |

## Evidence

| Field | Type | Required |
|---|---|---|
| `bibliographic_refs` | array of objects | no |
| `bibliographic_refs[].perspicacite_doc_id` | string (non-empty) | yes |
| `bibliographic_refs[].doi` | string | no |
| `bibliographic_refs[].title` | string (non-empty) | yes |
| `bibliographic_refs[].authors` | array of string | yes |
| `bibliographic_refs[].year` | integer | no |
| `bibliographic_refs[].excerpt` | string (≤ 500 chars) | yes |
| `bibliographic_refs[].relevance_score` | number (0–1) | yes |
| `bibliographic_refs[].prov_derived_from` | string (non-empty) | yes |
| `bibliographic_refs[].license` | string (non-empty) | no |
| `case_studies` | array of objects | no |
| `case_studies[].title` | string (non-empty) | yes |
| `case_studies[].summary` | string (≤ 1000 chars) | yes |
| `case_studies[].source_refs` | array of string | yes |
| `abs_asset` | object | no |
| `abs_asset.asset_type` | one of `spectrum_viewer_svg`, `code_snippet`, `data_csv`, `protocol_card_md`, `script_snippet`, `plot_spec`, `equation_latex`, `orbital_viewer_3d`, `molecule_3d`, `spectrum_data` | yes |
| `abs_asset.payload_inline` | string | no |
| `abs_asset.payload_path` | string | no |
| `abs_asset.abs_task_card_id` | string | no |
| `abs_asset.prov_derived_from` | string (non-empty) | yes |
| `enrichment_metadata` | object | yes |
| `enrichment_metadata.enricher_version` | string (non-empty) | yes |
| `enrichment_metadata.perspicacite_mode_used` | one of `basic`, `advanced`, `profound`, `agentic`, `passages` | yes |
| `enrichment_metadata.timestamp` | string (non-empty) | yes |
| `enrichment_metadata.degraded` | boolean | yes |

## Assessment blueprint

| Field | Type | Required |
|---|---|---|
| `dimensions` | array of objects, at least 1 item | yes |
| `dimensions[].id` | string (non-empty) | yes |
| `dimensions[].label` | string (non-empty) | yes |
| `dimensions[].weight` | number (0–1) | yes |
| `dimensions[].metrics` | array of objects, at least 1 item | yes |
| `dimensions[].metrics[].endpoint` | one of `progress`, `calibration`, `autonomy`, `ai_literacy`, `reasoning`, `ai_audit` | yes |
| `dimensions[].metrics[].field` | string (non-empty) | yes |
| `dimensions[].metrics[].weight_in_dimension` | number (0–1) | yes |

<!-- END GENERATED: lesson-bundle -->

## Keep this page current

```bash
pnpm docs:gen     # rewrite the generated sections from the schemas
pnpm docs:check   # fails when a generated section no longer matches the code
```
