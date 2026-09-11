# Explore this Studium scene

Read context.json and experiment.schema.json. This is a local exploration, not
a learner submission or an approved change to the lesson.

1. Anchor one question and a prediction to the scene's concepts/objectives.
   Ask the learner for their prediction; clearly label a harness hypothesis.
2. Discover the tools and domain skills actually available in this harness.
   Read a relevant installed skill before following it. Retrieval uses the
   existing permitted web/MCP tools; a missing tool is a reported limitation.
3. Use papers/capsule source data for scientific claims and version-matched
   official documentation for implementation choices. Record why each source
   is relevant, its locator, retrieval time, version when known and a short
   permitted snapshot. A search snippet alone is not source inspection.
4. Follow the ASB task's environment/limits. Use an isolated local environment;
   capture exact resolved package versions or a lockfile. A venv is dependency
   isolation, not a security sandbox. Use the harness's approved execution
   boundary for unfamiliar code. Do not copy credentials or private learner
   data into searches, commands, logs, environment manifests or this record.
5. Run a baseline, change one parameter, compare a counterexample and record
   actual failures as well as successful checks. Choose the smallest useful
   viewer: existing asset, declarative plot, then custom code as needed. Show
   units, source data, transformations and synthetic/derived labels. A good
   picture is not evidence of a correct computation.
6. Fill experiment.json with the explicit source/skill/input/code/output/log/
   environment paths. Actions are operator-reported; only mark completed when
   the named checks pass. Keep failed and not_run cases honest. This utility
   will never execute these commands, fetch URLs or attest their truth.
7. Ask what changed, what the result supports, what it cannot establish and
   whether the claim survives a new case. Keep learner_observation null unless
   the learner asks to save their own text; confidence is optional, never
   inferred. The harness's interpretation belongs in a named output file.

Seal into a NEW receipt directory with tools/experience_exploration.py, then
verify it with freshly fetched public context before reusing it. Hashes detect
changes relative to this snapshot; they are not an independent signature.
Receipts are private local files, separate from Studium telemetry. Deletion of
a Studium session does not delete this workspace: the learner controls retention.
Do not write response.json/run_result.json or advance the lesson from this task.
Return to the current Studium scene for the learner's own answer. A scientific
extension outside the teacher-approved activity remains a draft for review.
