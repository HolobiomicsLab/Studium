[English](lesson-bundle.md) · Français

# Format du bundle de leçon

Une leçon Studium est un fichier JSON, `lesson.json`, en général rangé dans son propre dossier avec
les médias qu'il cite. Toutes les surfaces (serveur MCP, panneau VS Code, serveurs HTTP, tableau de
bord enseignant) lisent ce même format. Cette page le décrit champ par champ ; les tables sont
générées à partir des schémas Zod de
[packages/lesson-bundle-schema](../../packages/lesson-bundle-schema/src/index.ts), qui font foi, et
restent en anglais. Un miroir Pydantic pour les services Python se trouve dans
`packages/lesson-bundle-schema/python/`.

Pour écrire une leçon, partez de [Écrire une leçon](../teach/author-a-lesson.fr.md) ou laissez un
assistant la construire avec les [outils d'auteur](mcp-tools.fr.md#authoring-tools). Ce que chaque
type de scène demande à l'apprenant est expliqué dans [Types de scènes](../concepts/scene-types.fr.md).

## Un bundle sur disque

```text
mon-cours/
  lesson.json      le bundle (ce format)
  approval.json    écrit par `experience_packet.py approve`, lié aux octets exacts de lesson.json
  media/...        fichiers cités par render_assets ou image_path, relatifs au dossier
```

Un `bundle_ref` (l'argument de `start_lesson_session`) est un chemin relatif au dossier des leçons :
un `lesson.json`, son dossier ou un bundle `.zip`. Les leçons construites par un assistant arrivent
dans la bibliothèque de l'apprenant, `<STUDIUM_HOME>/library` (voir
[Configuration](configuration.fr.md)). Exemples complets :
[fixtures/capsule-run-demo/lesson.json](../../fixtures/capsule-run-demo/lesson.json) (deux scènes)
et [fixtures/atomistique-l1/lesson.json](../../fixtures/atomistique-l1/lesson.json) (un cours entier).

## Vérifier un bundle

```bash
# Schéma : code 0 et « OK <fichier>: N scenes » quand le fichier est valide
node_modules/.pnpm/node_modules/.bin/tsx tools/bundle_validate.ts chemin/vers/lesson.json

# Relecture pédagogique : les ERROR font échouer, les WARN et INFO non
node tools/bundle_lint.mjs chemin/vers/lesson.json
```

Le linter va au-delà du schéma : un quiz a exactement un choix correct, un gabarit `TODO` non rempli
est une erreur, les relations du graphe et les types de supports doivent être connus, et les bundles
d'autoformation reçoivent des constats sur l'auteur de la clé. Les deux commandes sont décrites dans
la [référence des commandes](cli.fr.md).

## Qui l'a écrit, et qui l'a vérifié

`metadata.authoring` indique à chaque surface comment présenter la leçon honnêtement :

| Champ | Valeurs | Sens |
|---|---|---|
| `mode` | `teacher`, `self_study` | Une leçon d'enseignant, ou une leçon que l'apprenant (ou son assistant) a faite à partir de références de son choix. |
| `drafted_by` | `agent`, `learner`, `teacher` | Qui a écrit le contenu et ses clés de réponse. Un brouillon `agent` s'ouvre sur un avis : une IA l'a rédigé à partir des sources de l'apprenant et aucun enseignant ne l'a vérifié. |
| `author_is_learner` | `true`, `false` | La personne qui répond a aussi écrit la leçon. |
| `learner_profile` | `{minutes_per_day?, target_date?}` | Les minutes par jour de l'apprenant (de 1 à 600) et sa date visée, conservées par `create_lesson` ; le plan d'étude dimensionne l'étape suivante avec les minutes. Ce que l'apprenant a dit savoir ou aimer n'est jamais conservé ici. |

Deux autres champs portent la provenance. Une scène marquée `diagnostic: true` est une question
d'ouverture sur ce que l'apprenant sait déjà : elle est jouée une fois et n'est jamais choisie pour une
révision. Une citation de `evidence.bibliographic_refs[]` peut porter la `license` de la source, que les
surfaces affichent après son titre.

Un bundle sans `metadata.authoring` (bundles plus anciens) est lu comme une leçon d'enseignant.
`validated_by` et `validated_at` consignent la relecture de l'enseignant ;
`experience_packet.py approve` les renseigne et écrit `approval.json` avec l'empreinte SHA-256 des
octets finaux, si bien que toute modification ultérieure apparaît comme non approuvée. Un bundle
d'autoformation ne peut pas être approuvé.

## Référence des champs

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
| `legend` | array of objects, at least 1 item | no |
| `legend[].symbol` | string | yes |
| `legend[].meaning` | string | yes |

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
| `abs_asset.legend` | array of objects, at least 1 item | no |
| `abs_asset.legend[].symbol` | string | yes |
| `abs_asset.legend[].meaning` | string | yes |
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

## Tenir cette page à jour

```bash
pnpm docs:gen     # réécrit les sections générées à partir des schémas
pnpm docs:check   # échoue quand une section générée ne correspond plus au code
```
