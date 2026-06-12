# Studium backend eval harness

A **backend-only** (no frontend) eval harness that takes a **real university
course material**, runs it through the Studium pipeline, simulates a live
agentic-AI ↔ student interaction, and runs an **auditing studio** that scores
both the run and the generated course, emitting refinement feedback mapped back
to the prioritized backlog in `../../studium/docs/superpowers/REVIEW-FINDINGS.md`.

This is critical **#6** of that backlog ("one e2e golden-path + committed LWG
fixture → *this is the eval harness*") and the **measurement instrument** the
loop strategy calls for: re-run after each backlog fix and diff the scores.

The GUI apps under `apps/` are untouched. Python runs under the repo `.venv`;
the runtime is driven via the committed `@studium/lesson-session` package.

---

## TL;DR — how to run

```bash
# from the repo root: /Users/holobiomicslab/git/prototype-build

# List the 10 corpus materials (manifest-driven)
.venv/bin/python eval/run_eval.py --list

# FULL run on one real corpus material — key-free:
#   author (deterministic, corpus-faithful) -> drive 3 personas -> audit -> report
.venv/bin/python eval/run_eval.py --corpus 04

# OFFLINE SMOKE — proves the plumbing on the committed m3 fixture (no author, no keys)
.venv/bin/python eval/run_eval.py --smoke

# LIVE Claude author (corpus-faithful LLM authoring) + live driver + LLM auditor pass
.venv/bin/python eval/run_eval.py --corpus 04 --author claude --live --audit-llm

# Every corpus material, deterministic author
.venv/bin/python eval/run_eval.py --all
```

Outputs land in `eval/reports/<corpus>-<mode>-<ts>/` (gitignored):

```
<run>/
  <id>-bundle.zip           # the authored LessonBundle (lesson.json + prov.json)
  author_provenance.json    # author mode/model/hash + structural facts (attribution)
  sessions/<persona>/        # one dir per student persona (isolated state/logs)
    driver_result.json       #   transcript + transitions + final state + mastery
    events.jsonl             #   per-signal event log (FileStateStore/Jsonl adapters)
    telemetry.jsonl          #   adaptation_applied / universe_selected / quiz_answered ...
    state/                   #   durable FileStateStore (per-persona namespace)
  audit.json                 # rubric scores + findings (backlog_ref) + per-persona signals
  report.md                  # human-readable report + refinement-feedback list
  refinement_feedback.json   # findings keyed by REVIEW-FINDINGS.md backlog id
```

Run the unit tests (rule 004 — separate from the planner/scene-synth suites):

```bash
.venv/bin/python -m pytest eval/tests -q
```

---

## The 4 stages

### Stage 1 — AUTHOR (corpus `.md` → schema-valid `LessonBundle` ZIP)

Pluggable author backend, both producing the **same runtime-exercising
structure** — an LWG with a `prerequisite_for` edge chain plus `baseline`/
`remedial` universes whose concept node ids align to `scene.concept_refs`
(`concept:<id>` per `graph-nav.ts`), so the previously-inert prereq-gating **and**
universe-escalation paths actually fire (closes the fixture gap behind #6):

- **`deterministic`** (default, **key-free**): concepts/scenes/quizzes/LWG/
  universes are built from the corpus *structure* (markdown headings + the
  manifest summary). Concept prose is lifted **verbatim** from the corpus
  sections, so the bundle is section-faithful even with no LLM. It is **not** a
  content-blind metabolomics mock — it refuses an unknown mode and stamps
  `synthetic_assessment=true` so the auditor never credits the templated quiz
  items as validated questions.
- **`claude`** (live): the `claude` CLI reads the raw corpus and authors the
  concept/quiz/critique **prose** as JSON; the harness grafts it onto the same
  structural scaffold and **validates** the whole bundle. Concept-id alignment
  is machine-guaranteed regardless of LLM drift.

Both reuse `services/scene-synth/bundler.build_bundle` (strict
`LessonBundle.model_validate` + PROV sidecar) and **fail loud** on any schema /
LWG / alignment violation (`assert` before zip; re-validate after zip).

> **Why not the "real" planner + scene-synth by default?** Verified: the planner
> mock is content-blind (returns a hardcoded metabolomics plan), and scene-synth
> has **no** mock fallback (`agents/base.py` calls `self.llm.complete`
> unconditionally; `/scenes/synthesize` → 503 without keys). LiteLLM
> (`localhost:4000`) and Perspicacité (`localhost:8000`) are both unreachable
> here. A real-pipeline mode is sketched below but is intentionally **not** the
> default. The Claude-author step is the cleanest corpus-faithful, key-free
> "agentic-AI-as-author" seam.

### Stage 2 — DRIVE (per-scene present → decide → respond)

`harness/drive_session.mjs` imports `LessonSession` **in-process** (avoiding the
host's non-durable `InMemory` stores) and loops `start()` / `respond()`,
consulting a **pluggable student policy per turn** — the student *sees* the
rendered scene before answering (unlike the static-script CLI `runPlaythrough`).
Durable node adapters (`FileStateStore`, `JsonlEventLog`, `JsonlTelemetrySink`)
write under a **per-persona** `outDir` with a **per-persona pseudonym secret**,
so the two learners never collide in a shared store (works around the
lessonId-only keying defect #4 instead of masking it).

Each persona run captures `events.jsonl` + `telemetry.jsonl` + a
`CompletionSummary` + the final `LearnerState`.

### Stage 3 — AUDIT (auditing studio scores course + run)

`harness/audit.py` assembles a dossier (bundle scenes/concepts/rules/LWG/
universes + `author_provenance` + every persona's telemetry/summary) and scores a
**6-dimension rubric**. The **heuristic auditor** is pure-Python and key-free; an
optional **Claude auditor** (`--audit-llm`) augments it with a pedagogical
narrative + extra findings (merged, never replacing the objective signals).

### Stage 4 — REPORT + FEEDBACK

`harness/report.py` renders `report.md` + `refinement_feedback.json`. Every
actionable finding carries a `backlog_ref` into `REVIEW-FINDINGS.md`, so the
report doubles as the loop's regression signal.

---

## Student model (the Claude / scripted learner)

Each turn the driver serializes the current `Presentation.scene` to the student
policy, which returns a strict `ResponseInput`
(`response-input-schema.ts`: `ack` | `quiz_choice` | `confidence` | `critique`).
Three deterministic personas exercise different runtime branches:

| Persona | Quiz | Confidence | Critique | Exercises |
|---|---|---|---|---|
| **proficient** | correct | high (4) | thorough (names claim ids + flaws) | clean advance, mastery ≥ θ, autonomyRatio high |
| **struggling** | wrong first 2 visits, then correct | low (1) | shallow → thorough after remediation | replay, prereq-gating, universe escalation (#1, #6) |
| **overconfident** | wrong first 2 visits, then correct | max (4) | shallow → thorough | M3 calibration miscalibration (high confidence + wrong) |

`struggling`/`overconfident` are **stateful** (a student who eventually learns
through remediation): they answer wrong the first `failsBefore=2` visits to a
scene, then correct — so the run progresses through replay → prereq-gating →
escalation instead of looping forever. The replay *streak* still shows up in the
transcript and is reported as the same-item-remediation finding (#1).

A live **`claude`** persona is also available (`--author` is independent of the
persona): it shells the `claude` CLI per turn, rendering the scene and parsing a
JSON `ResponseInput`, with a safe fallback so a malformed turn never crashes the
run (recorded as a degraded turn).

## Auditor model (the auditing studio)

`audit.json.dimension_scores` ∈ [0,1] per dimension; `findings[]` each carry
`{dimension, severity, summary, evidence_path, backlog_ref}`:

1. **pedagogical_soundness** — Bloom progression monotonic? remediation valid
   (flags **same-item** remediation, #1)? difficulty modulated by Bloom (M1 — it
   isn't)?
2. **grounding_citations** — are LWG edges / concept scenes backed by citable
   evidence? Flags ungrounded edges (`quality_flags: ["ungrounded"]`, mirroring
   the planner `_ARTIFACT_FALLBACK_CONF=0.4` fallback) and absent Perspicacité
   grounding (#7).
3. **adaptivity** — did decisions actually **branch** across personas (detects
   the "every chosen=include" defect)? did `graph_prereq_gate` /
   `graph_universe_escalated` fire? `0.0` + **blocker** when no LWG/universes
   (adaptivity *untestable*, #6).
4. **anti_offloading** — `autonomyRatio` (flags the always-1.0 defect despite
   replays), `ai_critique` true/false-positive audit.
5. **rgpd** — per-learner pseudonym (flags lessonId-only, #4), no raw
   `learner_id` in telemetry, no-op `forget()`.
6. **mastery_validity** — was "mastered" earned via min-attempts + **distinct**
   items, or two same-item corrects = 0.80 = θ (#1)?

Declared **non-goals** (#5 reproduction inert, offline discussion inert) are
emitted as `info` findings, never scored as broken.

---

## What is wired live vs stubbed (honest holes)

| Piece | Status | Note |
|---|---|---|
| Runtime (`LessonSession`, graph-nav, universes) | **live** | the real committed runtime; prereq-gating + escalation genuinely fire |
| Author — `deterministic` | **real, key-free** | corpus-section-faithful structure + prose; quiz items templated (flagged synthetic) |
| Author — `claude` | **live LLM** via `claude` CLI | prose + assessment LLM-authored; structure machine-constrained |
| Author — real planner + scene-synth | **NOT default** | needs LiteLLM (`:4000` unreachable) + keys; scene-synth has no mock |
| Driver scorers offline (`live=false`) | **stub** | `StubReasoningScorer` (discussion always `{justification,0.5}`), `StubCritiqueEvaluator` (matches planted flaws — deterministic) |
| Driver scorers `--live` | **live** | `LiteLLMReasoningScorer` / `HttpCritiqueEvaluator` (need `LITELLM_*` / scene-synth `/scenes/critique-eval`) |
| Auditor — heuristic | **real, key-free** | objective signals from artifacts |
| Auditor — `--audit-llm` | **live LLM** | narrative + extra findings, merged |
| Perspicacité grounding / evidence | **off** | `:8000` unreachable; LWG edges flagged ungrounded (honest #7) |

### Harness-discovered defect (surfaced, not masked)

`bundler.py` writes `validated_at` via `datetime.now(timezone.utc).isoformat()`
→ `...+00:00`, but the TS loader (`bundle-loader.ts` → Zod
`z.string().datetime()`) **rejects numeric offsets** (only `...Z`). The Pydantic
mirror accepts both, so the Python round-trip passes yet the **runtime refuses to
load the bundle**. The harness normalises to `Z` so the session can run and flags
`bundler_validated_at_offset_defect` in the provenance + audit (schema
single-source-of-truth cluster).

---

## The "real pipeline" author mode (key-gated, documented, not default)

When `LITELLM_BASE_URL` / `LITELLM_API_KEY` exist and (optionally)
`localhost:8000` is up, a corpus-faithful real-pipeline author would:

1. `POST` the corpus manifest to the planner `/plan` with
   `STUDIUM_LLM_MODE=litellm STUDIUM_LWG_BUILD=on` (+
   `STUDIUM_PERSPICACITE_ENABLED=1`), taking the returned `LessonPlan` (+
   `.lwg/<id>/` artifacts):
   ```bash
   cd services/planner && STUDIUM_LLM_MODE=litellm STUDIUM_LWG_BUILD=on \
     LITELLM_BASE_URL=... LITELLM_API_KEY=... \
     ../../.venv/bin/uvicorn planner_app:app
   ```
2. drive `SceneSynthOrchestrator(llm_client=...)` with a real injected LLM to
   emit scenes, then `bundler.build_bundle(...)`.

The injected-LLM pattern is templated by
`services/scene-synth/tests/e2e/test_full_pipeline.py` (a deterministic FAKE
client returning canned JSON per scene type). This mode is intentionally left as
a documented seam because the proxy is unreachable in this environment and the
Claude-author step is the cleaner key-free corpus-faithful path.

---

## Layout

```
eval/
  run_eval.py             # the single orchestrating CLI (stages 1-4)
  README.md               # this file
  .gitignore              # ignores reports/* (keeps .gitkeep) + harness/node_modules
  corpus/                 # GITIGNORED — third-party OER material + manifest.json
  reports/                # GITIGNORED run outputs (.gitkeep tracked)
  harness/
    __init__.py
    paths.py              # repo-root / venv / scene-synth resolution
    corpus.py             # manifest loader
    author.py             # Stage 1 — deterministic + claude authors, schema-valid
    llm.py                # `claude` CLI bridge (author/student/auditor)
    drive_session.mjs     # Stage 2 — in-process LessonSession driver loop
    personas.mjs          # student policies (3 deterministic + live claude)
    runner.py             # Python -> Node driver invocation (+ tsx/symlink wiring)
    audit.py              # Stage 3 — heuristic + claude auditor, 6-dim rubric
    report.py             # Stage 4 — report.md + refinement_feedback.json
  tests/
    test_author.py        # schema validity + runtime-contract invariants
    test_audit.py         # rubric scoring + backlog mapping (synthetic run dirs)
    test_drive_integration.py  # author -> drive 2 personas -> assert branching + gating
```

> **Note on `harness/node_modules/`**: the Node driver's bare
> `import "@studium/lesson-session"` needs a `node_modules` tree carrying the
> workspace symlink. `runner.py` creates
> `harness/node_modules/@studium/lesson-session -> ../../../../packages/lesson-session`
> idempotently at run time. It is gitignored (local-only convenience).
> Requires `pnpm install` to have been run at the repo root.

---

## Grounding (`grounding_citations` dimension, REVIEW-FINDINGS #7)

The harness attaches citable evidence to LWG edges + intro/concept scenes via
`harness/grounding.py::ground_bundle`, wired into `author_bundle` and gated by
`STUDIUM_PERSPICACITE_ENABLED` (off by default → the unchanged 0.30 path).

**Step A — mock (deterministic, key-free, CI/regression):**
```bash
STUDIUM_PERSPICACITE_ENABLED=on STUDIUM_PERSPICACITE_MODE=mock \
  .venv/bin/python eval/run_eval.py --corpus 04
```
Lifts `grounding_citations` 0.30 → 1.0 (verified on corpora 01–03: edges 2/2, scenes 4/4).
Citations are mock fixtures — this proves the wiring and gives a deterministic regression signal.

**Step B — live KB-less literature (`:8002`):** real citations, no knowledge base.
```bash
STUDIUM_PERSPICACITE_ENABLED=on STUDIUM_PERSPICACITE_MODE=literature \
  PERSPICACITE_MCP_URL=http://localhost:8002/mcp \
  .venv/bin/python eval/run_eval.py --corpus 04
```
`STUDIUM_PERSPICACITE_MODE=literature` routes grounding through `search_literature`
(live database search, **no KB** — the no-KGmemory constraint) with server-side rerank
filtering, so scenes get **topically-relevant** citations or **honestly degrade** (no
fake evidence). Env knobs: `STUDIUM_GROUNDING_MIN_RELEVANCE` (default `0.3`),
`STUDIUM_PERSPICACITE_TIMEOUT` (default `120`s — each `search_literature` call is ~24s).
Verified on corpus 01: grounding 0.30 → 1.0, e.g. *Peroxisomes* → real peroxisome-biology
DOIs, while a generic *Introduction* scene degrades honestly.

Note: the **default** live mode (no `STUDIUM_PERSPICACITE_MODE`) uses `get_relevant_passages`,
which **requires a KB** — with `kb_names=[]` it returns nothing (grounding stays 0.30). Use
`literature` mode for the KB-less path. (Caveat: the auditor scores evidence *presence*, not
relevance; the rerank filter is what keeps live citations on-topic.)
