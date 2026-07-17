<div align="center">

# Studium — Agentic, Ontology-Grounded Adaptive Teaching

*Turn a corpus of teaching material into a transparent, adaptive course where every pedagogical decision is grounded, typed, and auditable.*

**Teaching-as-a-workflow** &nbsp;·&nbsp; **Learning Workflow Graph** &nbsp;·&nbsp; **Claim-native provenance** &nbsp;·&nbsp; **Backend-only, agent-drivable**

![Status](https://img.shields.io/badge/status-research_prototype-orange?style=flat-square)
![TypeScript](https://img.shields.io/badge/runtime-TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/author--time-Python_3.13-3776ab?style=flat-square&logo=python&logoColor=white)
![HITL](https://img.shields.io/badge/human--in--the--loop-required-success?style=flat-square)
![RGPD](https://img.shields.io/badge/learner_data-local--first-success?style=flat-square)

</div>

---

**Studium** is a research prototype for **adaptive scientific teaching in the agentic-AI era**. It treats a *course* the way modern science treats an *analysis*: as a workflow of decisions that should be **grounded in evidence, typed against shared ontologies, and auditable end-to-end** — by a human, before any student sees it.

The motivating problem: AI can now generate a "course" from a pile of documents in seconds. But a generated course is only trustworthy if you can see *why* it teaches what it teaches, *what evidence* grounds each prerequisite, and *whether a learner actually demonstrated mastery* — not just clicked through. Studium makes those things first-class.

## The core idea: a course is a Learning Workflow Graph

The backbone of every Studium course is a **Learning Workflow Graph (LWG)** — a typed DAG that decomposes teaching into:

- **concept nodes** (`concept:<id>`, Bloom-typed: remember → … → create) and **task nodes** (`task:<id>`, scene types: quiz, ai_critique, reproduction, …),
- connected by typed edges — **`prerequisite_for`**, **`assesses`**, **`part_of`**, **`decomposes_into`**, **`aligns_with`**.

The LWG is **built agentically** from two sources:

- **Mode A — documents:** lecture notes / textbook chapters → concepts (from objectives) + tasks (from scenes), with prerequisite edges *proposed* by an LLM and *grounded* in citable literature passages.
- **Mode B — reproduction:** an [AgenticScienceBuilder](https://github.com/HolobiomicsLab/AgenticScienceBuilder) capsule → a *reproduction subgraph* that makes "learn to reproduce this published analysis" a first-class, scaffolded, prerequisite-gated experience.

Every consequential build step runs through an **agentic-step contract** (lenient admission + quality flags + an [ASTRA](https://github.com/LightconeResearch/astra-spec) Decision/Insight + JSONL telemetry), and the whole graph is serialized as **[indicium](https://github.com/HolobiomicsLab/indicium) Claims** (Bucur 5-slot, SEPIO/ECO evidence) so each edge is a verifiable, provenance-stamped assertion — not an opaque model output.

## Four siblings, four jobs

Studium is the teaching layer that composes the lab's standards into one loop:

| Sibling | Role in Studium |
|---|---|
| **[Perspicacité](https://github.com/HolobiomicsLab/Perspicacite-AI)** | **grounds** — every prerequisite edge is anchored in a citable literature passage |
| **[indicium](https://github.com/HolobiomicsLab/indicium)** | **represents** — the graph is a set of typed, evidence-bound Claims |
| **[ASTRA](https://github.com/LightconeResearch/astra-spec)** | **explains the decision** — every adaptive move is a replayable Decision over Options |
| **[ASB](https://github.com/HolobiomicsLab/AgenticScienceBuilder)** | **the agentic-step standard** + the source of reproduction tasks |

*Perspicacité grounds · indicium represents · ASTRA explains · ASB sets the agentic-step standard.*

## How it works (end to end)

```
corpus (.md / ASB capsule)
   │  author-time (services/planner, services/scene-synth) — agentic, grounded, validated
   ▼
LessonBundle  +  Learning Workflow Graph  +  Universes (baseline / remedial)  +  indicium/ASTRA provenance
   │  runtime (@studium/lesson-session) — adaptive, learner-scoped, durable
   ▼
a learner session: prerequisite-gated navigation · remediation · hints · calibration · mastery
   │
   ▼
local, RGPD-safe "demonstrates_mastery_of" claims  +  a HITL course audit report
```

**Runtime adaptivity that *acts* (not just configured):**

- **Mastery is earned, not clicked** — a Beta/IRT model with a minimum-attempts floor; `demonstrates_mastery_of` is only asserted above a fixed bar.
- **Universes drive the live experience** — `baseline` vs `remedial` set the prerequisite threshold θ; `pacing` skips mastered concepts; `scaffolding` unlocks hints. A struggling learner is **escalated** baseline → remedial one-way.
- **Anti-offloading** — hints scaffold reasoning but *discount* mastery credit, so you can't offload to the answer. (Enforced as a cross-cutting engine invariant; not a per-decision modulator tag.)
- **Metacognition (M3)** — declared confidence is compared to real performance; over-/under-confidence is surfaced.
- **Prerequisite-gated remediation (M6)** — unmet prerequisites route to remediation and repeated struggle escalates the support universe; `explainLast()` surfaces why the system did what it did.
- **Modulator vocabulary** — the reconciled M-series (only **M1, M3, M6** are active tags; see [`docs/ontology/modulators.md`](docs/ontology/modulators.md)).
- **Privacy (RGPD / ADR-006)** — learner mastery is **local-only**, pseudonymized, and a real `forget()` erases it; shared telemetry carries refs/scalars only, never free text.

## Quickstart — test a real course end to end (no frontend)

The fastest way to see Studium is the **backend eval harness**: it takes a real university course material, runs the whole pipeline, simulates a live agentic-AI ↔ student interaction, and runs an **auditing studio** that scores the course + the run and emits refinement feedback.

```bash
cd prototype-build
pnpm install            # workspace (TypeScript runtime)
python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt

# key-free: deterministic author + 3 student personas + heuristic auditing studio
./.venv/bin/python eval/run_eval.py --corpus 04

# LIVE: Claude authors the course + a live Claude auditing studio scores it
./.venv/bin/python eval/run_eval.py --corpus 04 --author claude --audit-llm

# the whole corpus (5 sciences + 5 humanities)
./.venv/bin/python eval/run_eval.py --all
```

See [`eval/README.md`](eval/README.md) for the full harness (author modes, student personas, the audit rubric, reports). Drop your own `.md` into `eval/corpus/` and add a manifest entry to evaluate your own course.

## Architecture

| Layer | Where | What |
|---|---|---|
| **Author-time** | [`services/planner`](services/planner), [`services/scene-synth`](services/scene-synth), [`services/ingest`](services/ingest) | corpus → LessonPlan → LWG (agentic, grounded) → validated LessonBundle |
| **Runtime** | [`packages/lesson-session`](packages/lesson-session), [`packages/adaptation-engine`](packages/adaptation-engine), [`packages/learner-state`](packages/learner-state) | the adaptive engine: graph-aware navigation, mastery, universes, hints, calibration, local mastery claims |
| **Schemas** | [`packages/learning-workflow-schema`](packages/learning-workflow-schema), [`packages/lesson-bundle-schema`](packages/lesson-bundle-schema), [`packages/telemetry-events`](packages/telemetry-events) | the typed contracts (Zod + Pydantic mirrors) |
| **Provenance** | `services/planner/provenance` | indicium-claim + ASTRA serializers, the education adapter, HITL `approve_course` + course audit report |
| **Hosts** | [`packages/lesson-session-host`](packages/lesson-session-host), [`apps/lesson-server`](apps/lesson-server), [`apps/lesson-mcp`](apps/lesson-mcp) | multi-session host behind HTTP + MCP |
| **Eval** | [`eval/`](eval) | the backend auditing harness (this is how you exercise everything above) |

GUI apps under `apps/` (`teacher-dashboard`, `student-runtime`, `author-web`) exist but the **runtime + author-time + eval are the substance**; the project is backend-evaluable without a frontend.

## Status

Research **prototype**. The runtime adaptive loop, the agentic author-time pipeline, the indicium/ASTRA provenance, the HITL approval + audit report, and the eval harness are implemented and tested; the system runs end-to-end on real OER course material across humanities and sciences. It is **not** production software and has **not** been formally evaluated for learning outcomes — that study is pending. Human-in-the-loop approval is required before any student-facing use (rule-003).

## Documentation

- [`eval/README.md`](eval/README.md) — the backend eval harness (how to test a course)
- [`docs/user/teacher-guide.md`](docs/user/teacher-guide.md) · [`docs/user/student-guide.md`](docs/user/student-guide.md) — role guides
- [`CLAUDE.md`](CLAUDE.md) — agentic-development conventions (`.venv`, TDD, rule-003 HITL, RGPD)

## License

Research prototype — license to be finalized. Third-party OER course material under `eval/corpus/` is **not** redistributed (gitignored; see its manifest for per-source licenses).
