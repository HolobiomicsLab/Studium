English · [Français](README.fr.md)

# Studium evaluation harness

A backend-only harness that takes real university course material, authors a lesson from it, drives the
lesson with simulated students, and audits both the course and the run. It produces a scored report with
findings, so a change to Studium can be re-run and compared. It measures whether a generated course is
structurally sound (prerequisite gates fire, no same-item replay, distinct pseudonyms); it does not
measure whether students learn.

| | |
|---|---|
| Status | **maintained** (research instrument) |
| Run | `.venv/bin/python eval/run_eval.py --smoke` (offline), `--corpus <id>` (one material) |
| Port | none |
| Calls | nothing by default; the `claude` command line in `claude` modes, LiteLLM with `--live`, Perspicacité when grounding finds it |
| Tests | `.venv/bin/python -m pytest eval/tests -q` |

Python runs in the repository's `.venv`; the lesson runtime is the committed `@studium/lesson-session`
package, driven from Node, so `pnpm install` must have run at the repository root.

## Run it

From the repository root:

```bash
# offline smoke on the committed m3 fixture: no author, no keys
.venv/bin/python eval/run_eval.py --smoke

# list the corpus materials (needs the local corpus, see below)
.venv/bin/python eval/run_eval.py --list

# full run on one material: deterministic author, five personas, audit, report
.venv/bin/python eval/run_eval.py --corpus 04

# live: Claude author, live scorers, and a Claude auditor pass with a different model
.venv/bin/python eval/run_eval.py --corpus 04 --author claude --live --audit-llm --audit-model sonnet

# every material
.venv/bin/python eval/run_eval.py --all
```

| Option | Meaning |
|---|---|
| `--author deterministic` (default) or `claude` | key-free structural author, or live authoring through the `claude` command line |
| `--personas …` | simulated students to drive (default: all five deterministic personas) |
| `--live` | live LLM scorers instead of stubs (needs `LITELLM_*` or the scene-synth critique endpoint) |
| `--audit-llm`, `--audit-model` | add a Claude auditor pass; a distinct auditor model avoids a shared blind spot with the author |
| `--model` | model for the Claude author and student |
| `--refine-from <run dir>` | re-author from the findings of an earlier run |
| `--ground auto` (default), `corpus`, `literature`, `mock`, `off` | how edges and scenes are grounded in citations; `auto` uses live literature search when the Perspicacité server answers, else the course's own passages, and never fakes |

### The corpus

`eval/corpus/` holds third-party open educational material and is ignored by git (some items are all
rights reserved). It lives in the separate `studium_eval` repository and is linked or copied here, with
its `manifest.json`; on a fresh clone only `--smoke` works until the corpus is in place.

## Outputs

Each run writes `eval/reports/<corpus>-<mode>-<timestamp>/` (ignored by git; it can hold corpus-derived
content and per-learner state):

```
<run>/
  <id>-bundle.zip           # the authored lesson bundle (lesson.json + prov.json)
  author_provenance.json    # author mode, model, hash and structural facts
  sessions/<persona>/       # one folder per simulated student: driver_result.json, events.jsonl,
                            #   telemetry.jsonl, state/
  audit.json                # rubric scores, findings, per-persona signals
  report.md                 # readable report with the refinement feedback
  refinement_feedback.json  # findings keyed to the design backlog
```

The [Observatory](../services/observatory/README.md) shows these runs under `/eval/runs/<id>`.

## The four stages

1. **Author** ([`harness/author.py`](harness/author.py)): corpus Markdown to a schema-valid bundle with a
   learning-workflow graph (prerequisite chain, baseline and remedial universes) whose concept ids match
   the scenes, so prerequisite gating and universe escalation actually fire. The deterministic author lifts
   concept prose verbatim from the corpus sections and marks its templated quiz items as synthetic, so the
   auditor never credits them. Both authors build through `services/scene-synth/bundler.build_bundle` and
   fail loudly on any schema or alignment violation.
2. **Drive** ([`harness/drive_session.mjs`](harness/drive_session.mjs)): runs `LessonSession` in process.
   Each turn the student policy sees the rendered scene before answering. Each persona writes durable
   state under its own folder with its own pseudonym secret.
3. **Audit** ([`harness/audit.py`](harness/audit.py)): a key-free heuristic auditor scores eight
   dimensions; the optional Claude auditor adds a narrative and findings, merged, never replacing the
   objective signals.
4. **Report** ([`harness/report.py`](harness/report.py)): `report.md` and `refinement_feedback.json`.

## Simulated students

| Persona | Behaviour | Exercises |
|---|---|---|
| `proficient` | correct, calibrated high confidence, thorough critiques | clean advance, mastery reached |
| `struggling` | wrong on the first visits to a concept, low confidence, then correct | replay, prerequisite gating, universe escalation |
| `overconfident` | one wrong answer with maximum confidence, then correct | calibration mismatch |
| `hint_reliant` | consumes every authored hint before answering | anti-offloading discount, autonomy below 1 |
| `misconception` | keeps picking the same wrong distractor and asks for hints | a distinct wrong-answer signature |
| `claude` | a live student through the `claude` command line, with a safe fallback | free behaviour; a malformed turn is recorded as degraded |

## Audit dimensions

Each score is between 0 and 1; each finding carries a dimension, severity, summary, evidence path and
backlog reference.

| Dimension | Asks |
|---|---|
| `pedagogical_soundness` | does Bloom level progress; is remediation a different item, not the same one again |
| `grounding_citations` | are graph edges and concept scenes backed by citable evidence |
| `adaptivity` | do decisions branch across personas; do gating and escalation fire |
| `anti_offloading` | does the autonomy ratio reflect hints and replays; are critiques audited |
| `rgpd` | per-learner pseudonyms, no raw learner id in telemetry, a working forget |
| `mastery_validity` | is mastery earned over distinct items |
| `assessment_quality` | quiz craft: distinct stems and distractors, enough items per concept, exactly one correct choice |
| `retention` | how much earned mastery survives a simulated seven-day gap (FSRS curve) |

Declared non-goals (an inert reproduction, offline discussion) are reported as `info` findings, never
scored as broken. The auditor scores the presence of citations, not their relevance; the validity suite
below covers that blind spot.

## Other instruments

| Command | What it does |
|---|---|
| `.venv/bin/python eval/harness/scene_judge.py <lesson.json> --out <course dir>` | an LLM judge of every scene's content, with discrete verdicts and a required failure scenario; `--calibrate` checks separation on deliberately corrupted scenes. Results appear in the Observatory review page |
| `.venv/bin/python eval/run_class.py <bundle> <run_dir> --learners 24` | simulate a class through an existing bundle, then build the teacher class report; fewer than five learners shows the suppression |
| `.venv/bin/python eval/author_one.py <corpus id> <out dir> --claude` | author one bundle for a live demonstration |
| `.venv/bin/python eval/enrich_bundle_artifacts.py` | attach renderable equation, plot and executed-result artifacts to an authored bundle |
| [`validity/`](validity/README.md) | validates the instrument itself: learner-model calibration, persona divergence, citation relevance |
| [`decisive-trial/`](decisive-trial/PREREGISTRATION.md) | the pre-registration of a classroom trial (a plan, not yet run) |

## Limits

- Without keys, the driver's scorers are stubs: discussion is always scored the same, and the critique
  evaluator matches planted flaws deterministically.
- The real planner and scene-synth pipeline is not an author mode: it needs a LiteLLM endpoint, and
  scene-synth has no mock. [`services/scene-synth/tests/e2e/test_full_pipeline.py`](../services/scene-synth/tests/e2e/test_full_pipeline.py)
  shows the injected-client pattern such a mode would use.
- `bundler.py` writes `validated_at` with a `+00:00` offset that the TypeScript loader rejects; the harness
  normalises it to `Z` and records `bundler_validated_at_offset_defect` in the provenance and the audit.

## Layout

```
eval/
  run_eval.py            the orchestrating command (stages 1 to 4)
  run_class.py           class simulation and class report
  author_one.py          one-bundle author for demonstrations
  corpus/                git-ignored corpus and manifest
  reports/               git-ignored run outputs
  harness/               author, drive, personas, audit, report, grounding, scene judge
  tests/                 unit and integration tests
  validity/              validity suite of the instrument
  decisive-trial/        classroom trial pre-registration
```

The Node driver imports `@studium/lesson-session` through `harness/node_modules/`, a git-ignored link that
`harness/runner.py` creates at run time.
