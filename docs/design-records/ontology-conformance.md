# Ontology conformance (generated)

**Generated from source by `tools/ontology_report.py` — do not edit by hand; run the tool to refresh.**
This table is derived from the schemas on disk so the code and the paper's ontology claims cannot
silently diverge. A stale row is a diff, not a lie.

## Modulators
Active runtime set: **M1, M3, M6** (3). Definitions + retired ids: `docs/ontology/modulators.md`.

## Scene types — the three schema sites
| site | count | scene types |
| --- | --- | --- |
| TS · learning-workflow-schema | 14 | ai_critique, communication_sim, comparison, concept, discussion, explain_back, intro, meta_checkpoint, prompt_practice, quiz, reproduction, simulation, spot_the_flaw, summary_audit |
| Py · lesson-bundle-schema | 13 | ai_critique, communication_sim, comparison, concept, discussion, explain_back, intro, meta_checkpoint, prompt_practice, quiz, reproduction, spot_the_flaw, summary_audit |
| Py · scene-synth | 13 | ai_critique, communication_sim, comparison, concept, discussion, explain_back, intro, meta_checkpoint, prompt_practice, quiz, reproduction, spot_the_flaw, summary_audit |

Bundle scene mirrors (lesson-bundle-schema, scene-synth): **in sync** (13 types) — pinned by `test_scene_types_match_canonical_mirror`.
Graph task-node vocabulary (learning-workflow-schema) additionally lists: `simulation` — declared as a valid graph task-node scene_type but with **no bundle scene schema** (a ghost, cf. the ghost edge relations).

## Edge relations — declared vs produced
| relation | declared | produced by a generator |
| --- | --- | --- |
| prerequisite_for | yes | yes |
| part_of | yes | yes |
| decomposes_into | yes | **NO** (declared, never emitted) |
| assesses | yes | yes |
| aligns_with | yes | **NO** (declared, never emitted) |

## Referential integrity enforced
| check | enforced? | where |
| --- | --- | --- |
| unique node/edge ids | yes | LearningWorkflowGraph |
| edge endpoints reference declared nodes (no dangling) | yes | LearningWorkflowGraph (TS superRefine + Py validator) |
| prerequisite acyclicity | yes (build path) | services/planner/graph/cycle.py |
| concept_refs ⊆ course concepts | yes | services/scene-synth bundler.validate_scene |
| objective_refs ⊆ declared objectives (shipped bundle) | **NO** | the LessonBundle carries no learning_objectives field |

## Open author decisions (not settleable from code)
- **objective_refs enforcement** in the shipped bundle: needs `learning_objectives` on the LessonBundle model.
- **Ghost relations**: `decomposes_into`, `aligns_with` are declared in EdgeRelationSchema but no producer emits them — implement a producer or retract.
- **Ghost graph scene types**: `simulation` are valid graph task-node scene_types with no bundle scene schema — implement the scene or drop from SceneTypeSchema.
