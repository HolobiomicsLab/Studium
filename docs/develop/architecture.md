English · [Français](architecture.fr.md)

# Architecture

This page shows how Studium is put together: which unit does what, how a lesson travels from sources to a
learner's answer, and where state is kept. Read it before changing code that crosses a package boundary.
Terms such as *scene*, *key class* or *FSRS* are defined in the [glossary](../concepts/glossary.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/architecture-dark.svg">
  <img src="../assets/diagrams/architecture-light.svg" alt="Studium architecture: sources go through authoring into typed course artifacts (LessonBundle and Learning Workflow Graph); the adaptive runtime (lesson-session, adaptation-engine, learner-state) runs inside the session host (lesson-session-host), which serves VS Code and AI harnesses over MCP, HTTP and a file channel; the teacher dashboard and the Observatory are separate review surfaces.">
</picture>

## One contract, several surfaces

Everything a learner plays is a **lesson bundle**: a `lesson.json` file validated against the LessonBundle
schema (version 1.4, [`packages/lesson-bundle-schema`](../../packages/lesson-bundle-schema/src/index.ts)).
It holds the scenes, the concepts and the Learning Workflow Graph (LWG) that links them. Authoring tools
write bundles; every runtime surface reads them through the same host. The layers are:

| Layer | Units | Responsibility |
|---|---|---|
| Course contract | `lesson-bundle-schema`, `learning-workflow-schema` | the bundle format and the typed graph |
| Adaptive runtime | `lesson-session`, `adaptation-engine`, `learner-state`, `reasoning-scorer` | grading, navigation, mastery, review scheduling |
| Session host | `lesson-session-host` | many sessions, one per learner and lesson; persistence; redaction; study plan; authoring checks |
| Transports | `apps/lesson-mcp` (MCP over stdio, HTTP adapter), `apps/lesson-server` (HTTP), file channel `.studium-session/` | the public session contract |
| Learner clients | VS Code extension, any MCP harness | presentation |
| Review surfaces | teacher dashboard, Observatory | teacher and operator views, separate from learner clients |

## Data flow of one answer

1. A client calls `start_lesson_session` with a bundle reference. The host resolves it under
   `BUNDLES_ROOT`, then the learner's library, and loads and validates the bundle.
2. The host returns the current scene as a **public projection**:
   [`public-scene.ts`](../../packages/lesson-session-host/src/public-scene.ts) removes every answer-bearing
   field (correct flags, key points, model answers) before anything leaves the server, on MCP, HTTP and the
   file channel alike.
3. The client sends the learner's answer with `submit_response`. The session grades it, applies the signal
   to the learner model, decides the next step and navigates the graph.
4. Only a measured answer moves mastery. Without a judge model (`LITELLM_BASE_URL` empty), an open answer
   gets the reference to compare with and no coverage count; a self-rating (`rate_recall`) schedules
   reviews but never changes mastery. See [honesty and provenance](../concepts/honesty-and-provenance.md).
5. Cited source passages and the reference are released only when the learner leaves the scene for good.
6. The host writes the learner state to the data directory. With `STUDIUM_TELEMETRY_CONSENT` set and
   durable storage, it also appends pseudonymised events to `telemetry.jsonl`, which `class_report`
   aggregates behind a floor of five learners.

### Where state lives

| What | Default | Set by |
|---|---|---|
| Lessons read | `BUNDLES_ROOT`, then `~/.studium/library` | `BUNDLES_ROOT`, `STUDIUM_HOME` |
| Lessons and sources written by authoring | `~/.studium/library` only, never `BUNDLES_ROOT` | `STUDIUM_HOME` |
| Learner state | `~/.studium/data` | `STUDIUM_DATA_DIR`, `STUDIUM_HOME` |
| In-memory only | off | `STUDIUM_EPHEMERAL=1` (tests, demos, CI) |
| On-disk learner folders | HMAC pseudonyms | `STUDIUM_PSEUDO_SECRET`, else `<data dir>/.studium-secret` |

These defaults are applied only by the stdio entry point
([`persistence.ts`](../../packages/lesson-session-host/src/persistence.ts)); library code and its tests stay
in memory unless they configure a directory. The full list is in
[configuration](../reference/configuration.md).

## Two authoring routes

| | Conversation route | Packet route |
|---|---|---|
| For | a self-learner with an AI assistant | a teacher preparing a course |
| Entry | MCP tools `get_authoring_guide`, `prepare_sources`, `create_lesson` | `tools/experience_packet.py passages`, `prepare`, `check`, `bundle`, `approve` |
| Code | [`apps/lesson-mcp/src/authoring-tools.ts`](../../apps/lesson-mcp/src/authoring-tools.ts), [`authoring-draft/`](../../packages/lesson-session-host/src/authoring-draft) | [`tools/experience_packet.py`](../../tools/experience_packet.py) |
| Checks | quotes matched to source passages character for character, no `TODO`, sound concept graph, bundle lint | schema validation, structured findings (`check --json`), bundle lint |
| Output | `<library>/<course_id>/lesson.json`, marked agent-drafted, not teacher-validated | a course folder; `approve` writes `approval.json` bound to the SHA-256 of `lesson.json` |
| Guide | [Learn a topic in a conversation](../tutorials/learn-a-topic-in-a-conversation.md) | [Author a lesson](../teach/author-a-lesson.md) |

Both routes end in the same bundle format, and both go through
[`tools/bundle_lint.mjs`](../../tools/bundle_lint.mjs). The FastAPI services `planner` and `scene-synth`
are kept as legacy and research code; they are not a supported authoring route.

## Package map

### Apps

| Unit | Role | README |
|---|---|---|
| `apps/lesson-mcp` | MCP server (39 tools, stdio) and HTTP adapter for lesson operations | [README](../../apps/lesson-mcp/README.md) |
| `apps/studium-vscode` | VS Code extension: lesson pane, chat participant, bundled MCP server | [README](../../apps/studium-vscode/README.md) |
| `apps/lesson-panel-ui` | Shared lesson and graph renderers, with VS Code and MCP Apps bridges | [README](../../apps/lesson-panel-ui/README.md) |
| `apps/claude-code-mod` | Claude Code plugin: native lesson pane over the shared panel tools | [README](../../apps/claude-code-mod/README.md) |
| `apps/lesson-server` | Fastify HTTP server for lessons, answer keys redacted | [README](../../apps/lesson-server/README.md) |
| `apps/teacher-dashboard` | Next.js dashboard: class analytics, lesson library and review pages | [README](../../apps/teacher-dashboard/README.md) |
| `apps/student-runtime` | Tauri desktop app, frozen | [README](../../apps/student-runtime/README.md) |
| `apps/author-web` | Next.js authoring app, legacy | [README](../../apps/author-web/README.md) |

### TypeScript packages

| Unit | Role | README |
|---|---|---|
| `lesson-bundle-schema` | LessonBundle 1.4 schema (Zod) and Python mirror | [README](../../packages/lesson-bundle-schema/README.md) |
| `learning-workflow-schema` | Learning Workflow Graph: concept and task nodes, typed edges | [README](../../packages/learning-workflow-schema/README.md) |
| `lesson-plan-schema` | lesson plan sub-schema (JSON Schema, types, Pydantic mirror) | [README](../../packages/lesson-plan-schema/README.md) |
| `lesson-schema` | earlier lesson schema v1 (ADR 003); the bundle schema is current | [README](../../packages/lesson-schema/README.md) |
| `lesson-session` | one learner in one lesson: grading, navigation, tutor | [README](../../packages/lesson-session/README.md) |
| `lesson-session-host` | multi-session host: persistence, redaction, study plan, authoring | [README](../../packages/lesson-session-host/README.md) |
| `lesson-panel` | public view, actions and composition shared by harnesses | [README](../../packages/lesson-panel/README.md) |
| `adaptation-engine` | Beta mastery updates, FSRS review scheduling, graph routing | [README](../../packages/adaptation-engine/README.md) |
| `learner-state` | learner model types: mastery, calibration, trust | [README](../../packages/learner-state/README.md) |
| `reasoning-scorer` | classifies the reasoning of a tutoring turn | [README](../../packages/reasoning-scorer/README.md) |
| `llm-client` | model client: mock and LiteLLM-compatible endpoint | [README](../../packages/llm-client/README.md) |
| `perspicacite-client` | DOI metadata client for the Perspicacité service, offline fallback | [README](../../packages/perspicacite-client/README.md) |
| `telemetry-events` | telemetry event schema (TypeScript and Python) | [README](../../packages/telemetry-events/README.md) |
| `typed-graph-lens` | typed graph view with live state, used by the VS Code graph pane | [README](../../packages/typed-graph-lens/README.md) |
| `activity-presentation` | portable HTML renderers with inlined KaTeX for viewers and reports | [README](../../packages/activity-presentation/README.md) |

### Python services

| Unit | Role | README |
|---|---|---|
| `services/analytics-collector` | stores telemetry and serves class aggregates (development and demo service) | [README](../../services/analytics-collector/README.md) |
| `services/observatory` | read-only operator page over provenance, evaluations and validity | [README](../../services/observatory/README.md) |
| `services/ingest` | source ingest: PDF extraction, BibTeX, DOI resolution | [README](../../services/ingest/README.md) |
| `services/planner` | legacy and research planner; answers 503 without a configured model | [README](../../services/planner/README.md) |
| `services/scene-synth` | legacy and research scene synthesis | [README](../../services/scene-synth/README.md) |

### Other folders

| Folder | Content |
|---|---|
| [`design/`](../../design/README.md) | design tokens, VS Code bridge, components, preview |
| `ui/` | shared viewer theme and contextual help catalogue |
| `tools/` | authoring, lint, report and audit scripts; `pytest_all.py` |
| [`eval/`](../../eval/README.md) | evaluation harness and validity studies |
| `fixtures/` | example lessons, including `atomistique-l1` |
| `skills/` | assistant skills for students, teachers and self-learners ([skills](../start/skills.md)) |

## Limits

The HTTP adapter exposes the 25 lesson operations plus `rate_recall`; other study, authoring and teacher tools are MCP-only. No single
wire connects the runtime host to both review surfaces: they read course and review artifacts from disk.
