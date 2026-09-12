<div align="center">

# Studium — Agentic, Ontology-Grounded Adaptive Teaching

*Turn a corpus of teaching material into a transparent, adaptive course where every pedagogical decision is grounded, typed, and auditable.*

**Teaching-as-a-workflow** &nbsp;·&nbsp; **Learning Workflow Graph** &nbsp;·&nbsp; **Claim-native provenance** &nbsp;·&nbsp; **Visual or harness-driven learning**

![Status](https://img.shields.io/badge/status-research_prototype-orange?style=flat-square)
![TypeScript](https://img.shields.io/badge/runtime-TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/author--time-Python_3.12-3776ab?style=flat-square&logo=python&logoColor=white)
![HITL](https://img.shields.io/badge/human--in--the--loop-required-success?style=flat-square)
![RGPD](https://img.shields.io/badge/learner_data-local--first-success?style=flat-square)

</div>

---

**Studium** is a research prototype for **adaptive scientific teaching in the agentic-AI era**. It treats a *course* the way modern science treats an *analysis*: as a workflow of decisions that should be **grounded in evidence, typed against shared ontologies, and auditable end-to-end** — by a human, before any student sees it.

The motivating problem: AI can now generate a "course" from a pile of documents in seconds. But a generated course is only trustworthy if you can see *why* it teaches what it teaches, *what evidence* grounds each prerequisite, and *whether a learner actually demonstrated mastery* — not just clicked through. Studium makes those things first-class.

## Documentation and first use

Start with the **[documentation portal](docs/README.md)** (French). Studium can be
operated through its VS Code panel, an AI harness, or a local HTTP client.

| Your goal | Start here |
|---|---|
| Take a lesson visually, without an LLM account for the demo | [Install and open the VS Code panel](docs/getting-started/installation.md) |
| Learn with Copilot Student | [Account setup and MCP connection](docs/getting-started/copilot.md) |
| Use Claude Code, Codex or OpenCode | [Harness onboarding and connection checks](docs/getting-started/harnesses-and-api.md) |
| Use an API and switch local harnesses | [HTTP API, session continuity and exports](docs/guides/api-and-harness.md) |
| Prepare a course from literature or an ASB capsule | [Teacher guide](docs/user/teacher-guide.md) and [practical use cases](docs/tutorials/use-cases.md) |
| Build an interactive activity and review its trace | [Activity → ASTRA/MySTRA report](docs/tutorials/activity-to-report.md) |

Read the [10–12 September development update](docs/updates/2026-09-12.md) for the
latest additions and their verification, and [capability status](docs/features.md)
for surface-specific limits. These are development docs: use code and guides from
the same revision. The dated update identifies changes still awaiting integration;
it does not announce a release.

For a first local lesson without a backend API key, follow the
[installation guide](docs/getting-started/installation.md). The evaluation harness
below is a developer research workflow, not the student onboarding path.

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
   │  runtime (@studium/lesson-session) — adaptive, learner-scoped
   ▼
a learner session: prerequisite-gated navigation · remediation · hints · calibration · mastery
   │
   ▼
local-first "demonstrates_mastery_of" claims  +  a HITL course audit report
```

The same runtime is accessible through MCP, the local HTTP operation API and a
file channel. An AI harness can prepare code, figures and reusable activities
from public lesson context; the learner supplies predictions and conclusions.
Portable activities offer five templates, optional scientific/media supports,
language selection and an opt-in action export to ASTRA/ARA/MySTRA. A viewer is
a local artifact, not an embedded agent. See [worked scenarios](docs/tutorials/use-cases.md).

Live session position belongs to the server process. Some learner state and
journals can be persisted under their consent rules; restarting the HTTP server
does not restore its active sessions.

**Runtime adaptivity that *acts* (not just configured):**

- **Mastery is earned, not clicked** — a Beta/IRT model with a minimum-attempts floor; `demonstrates_mastery_of` is only asserted above a fixed bar.
- **Universes drive the live experience** — `baseline` vs `remedial` set the prerequisite threshold θ; `pacing` skips mastered concepts; `scaffolding` unlocks hints. A struggling learner is **escalated** baseline → remedial one-way.
- **Anti-offloading** — hints scaffold reasoning but *discount* mastery credit, so you can't offload to the answer. (Enforced as a cross-cutting engine invariant; not a per-decision modulator tag.)
- **Metacognition (M3)** — declared confidence is compared to real performance; over-/under-confidence is surfaced.
- **Prerequisite-gated remediation (M6)** — unmet prerequisites route to remediation and repeated struggle escalates the support universe; `explainLast()` surfaces why the system did what it did.
- **Modulator vocabulary** — the reconciled M-series (only **M1, M3, M6** are active tags; see [`docs/ontology/modulators.md`](docs/ontology/modulators.md)).
- **Privacy boundaries** — local learner state, pseudonymization and explicit forgetting are part of the runtime design. Storage depends on the client/configuration; harness history and exported experiments have separate retention. See [privacy and limits](docs/privacy-and-limits.md) before a class pilot.

## Developer evaluation harness (no frontend)

For developers, the **backend eval harness** runs the pipeline over course
material, simulates learner interactions and emits technical audit feedback.
For a first student session, use the installation and onboarding above.

```bash
# From the root of your Studium checkout
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
| **Hosts** | [`packages/lesson-session-host`](packages/lesson-session-host), [`apps/lesson-mcp`](apps/lesson-mcp) | common operations over MCP and authenticated local HTTP; file-channel runner |
| **Clients and activities** | [`apps/studium-vscode`](apps/studium-vscode), [`tools/experience_templates.py`](tools/experience_templates.py), [`packages/activity-presentation`](packages/activity-presentation) | lesson panel/notebook, five portable templates, local scientific renderers |
| **Review** | [`services/observatory`](services/observatory), [`tools/learner_report.py`](tools/learner_report.py) | course review, MySTRA and portable learner reports |
| **Eval** | [`eval/`](eval) | the backend auditing harness (this is how you exercise everything above) |

GUI apps under `apps/` include `teacher-dashboard`, `student-runtime` and
`author-web`. Their coverage differs from portable activities and the VS Code
panel; see the [capability map](docs/features.md). The legacy REST service
[`apps/lesson-server`](apps/lesson-server) remains separate from the new operation
API. The project can still be evaluated without a frontend.

## Status

Research **prototype**. The runtime adaptive loop, the agentic author-time pipeline, the indicium/ASTRA provenance, the HITL approval + audit report, and the eval harness are implemented and tested; the system runs end-to-end on real OER course material across humanities and sciences. It is **not** production software and has **not** been formally evaluated for learning outcomes — that study is pending. Human-in-the-loop approval is required before any student-facing use (rule-003).

## Documentation

- [`eval/README.md`](eval/README.md) — the backend eval harness (how to test a course)
- [`docs/user/teacher-guide.md`](docs/user/teacher-guide.md) · [`docs/user/student-guide.md`](docs/user/student-guide.md) — role guides
- [`CLAUDE.md`](CLAUDE.md) — agentic-development conventions (`.venv`, TDD, rule-003 HITL, RGPD)

## License

Research prototype — license to be finalized. Third-party OER course material under `eval/corpus/` is **not** redistributed (gitignored; see its manifest for per-source licenses).
