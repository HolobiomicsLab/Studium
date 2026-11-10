English · [Français](agentic-session-protocol.fr.md)

# Agentic session protocol

An assistant working in the learner's workspace (Copilot, Claude Code, Codex, OpenCode) can drive a
Studium lesson and run the real science itself. Studium stays the lesson's brain: it chooses the
next scene, grades answers and updates mastery. The assistant, called the operator here, executes
code in the workspace terminal or notebook, and the editor renders the figures. Studium itself never
executes code and needs no sandbox per learner.

This page describes the two channels between Studium and an operator, and the file channel in full.

## Two channels

| Channel | Surface | Best for |
|---|---|---|
| MCP (typed, live) | the [MCP tools](mcp-tools.md) of `apps/lesson-mcp`: `start_lesson_session`, `get_current_scene`, `get_scene_artifacts`, `submit_response`, `submit_turn`, `request_hint`, `get_run_manifest`, `submit_run_result`, `end_session` | an assistant or editor that speaks MCP |
| Files (universal) | a `.studium-session/` folder | any assistant that can read and write plain files |

Both apply the same redaction: the answer key (claims, expected flaws, model answers, the correct
quiz choice) is removed before anything reaches the operator. The operator audits an AI reading
without being handed the solution.

## The file channel

```text
.studium-session/
  task.md                 Studium -> operator  the current step, redacted: what to do and the real artifact reference
  response.json           operator -> Studium  the learner's answer, e.g. {"text": "..."} or {"kind": "flaw_report", "text": "..."}
  run.json                Studium -> operator  a learner-time run manifest (reproduction scenes only)
  run_result.json         operator -> Studium  {"ran": true, "passed": true, "landmark": "...", "artifacts": [...], "checks": [...]}
  feedback.md             Studium -> operator  the graded outcome and whether the lesson advanced
  index.json              shared log           one entry per step: {step, scene_id, scene_type, status}
  experiment-action.json  operator -> Studium  {session_id, scene_id, input}: a prediction, begin, observation or conclusion
  experiment.json         Studium -> operator  the private experiment journal (mode 0600), once it has entries
  session-language.json   operator -> Studium  {session_id, presentation_language}: change the presentation language
```

A step's `status` in `index.json` is one of `awaiting_response`, `graded`, `awaiting_run`, `ran`
or `complete`.

### The loop

1. Studium writes `task.md` (the redacted scene, plus the reference of a real executed result when
   the scene has one) and logs the step as `awaiting_response`.
2. The operator reads `task.md`, does the work in the workspace, and writes the learner's answer to
   `response.json`.
3. Studium grades it, writes `feedback.md`, marks the step `graded` and writes the next `task.md`,
   or a `complete` entry at the end.

A malformed or mismatched `response.json` is not fatal: Studium consumes it and writes a corrective
`feedback.md`, so the operator can retry.

### Instructions for an operator

> Read `.studium-session/task.md`. Do what it asks in this workspace (run the code, inspect the
> real result the editor shows). Write the learner's answer to `.studium-session/response.json` as
> `{"text": "<the judgment, with its justification>"}`, writing `response.json.tmp` first and then
> renaming it, so Studium never reads half a file. Then read `.studium-session/feedback.md` and, if
> there is a new `task.md`, continue. Do not look for the answer key: it is not there.

### Learner-time runs

A `reproduction` scene can carry a `run_manifest`: the capsule, install and command, the files it
should produce and the checks to run, never the expected values. On such a scene Studium writes
`run.json` and a provision-and-run `task.md`, and logs `awaiting_run`. The operator provisions the
environment, installs the dependencies, runs the capsule in the workspace and writes
`run_result.json`.

| Result | What Studium does |
|---|---|
| `ran` and `passed` | Records the learner's own run (`status: "ran"`, with its landmark and artifacts) and advances. |
| missing or partial | Keeps waiting. |
| `ran: false` or failed checks | Consumes it and writes a corrective `feedback.md`; the operator fixes and reruns. |

The author's reference landmark is withheld so the learner produces a fresh result. Over MCP the
same exchange is `get_run_manifest` then `submit_run_result`.

## Run the harness

`runStudiumSession(host, bundleRef, dir, operator)` in `@studium/lesson-session-host` drives the
loop with a pluggable operator. The command-line runner wraps it:

```bash
# Watch mode (default): Studium writes task.md and waits for you or an assistant to write response.json
apps/lesson-mcp/node_modules/.bin/tsx apps/lesson-mcp/src/session-runner-cli.ts capsule-judgment-demo/lesson.json --dir=.studium-session

# Stub mode: a key-free placeholder operator drives the loop to the end (a quick smoke test)
STUDIUM_EPHEMERAL=1 apps/lesson-mcp/node_modules/.bin/tsx apps/lesson-mcp/src/session-runner-cli.ts capsule-judgment-demo/lesson.json --stub --dir=reports/session
```

The `--dir` folder must be new. Without `--stub`, the runner waits for real answers. The
[harness skill](../../skills/studium-harness/SKILL.md) describes the formats.

Options: `--bundles-root=DIR` (default `BUNDLES_ROOT`, else `./fixtures`), `--dir=DIR` (default
`./.studium-session`), `--language=BCP47` (presentation language).

| Operator | Behaviour |
|---|---|
| `watchOperator({pollMs, timeoutMs})` | Waits for an external assistant to write `response.json` or `run_result.json`. Studium never calls a model. |
| `stubOperator` | A deterministic placeholder; on a run scene it writes a passing result without executing anything. |
| `makeLlmOperator({llm, runCapsule})` | An operator backed by a model that owns execution: it runs the capsule on a reproduction scene and asks the model to judge the AI reading of its own run. Both dependencies are injected. |

The model-backed demo runs the real capsule with `tools/capsule_runner.py` and a placeholder model,
or a live one with `--live` and `LITELLM_BASE_URL`:

```bash
apps/lesson-mcp/node_modules/.bin/tsx apps/lesson-mcp/src/llm-operator-demo.ts capsule-loop-demo/lesson.json --dir=reports/session
```

## Execution and rendering belong to the editor

- Execution happens in the workspace terminal or notebook kernel, driven by the operator.
  `tools/capsule_runner.py` still produces an author's reference run once, to ground a scene; the
  learner's runs are requested through `run.json` (or `get_run_manifest`) and reported back.
- Rendering is native: the VS Code notebook controller shows an `executed_result` or image figure
  inline with a caption, and the file channel carries the same reference.

## What is covered

The file round trip is tested on `fixtures/capsule-judgment-demo`, with the answer key absent from
every `task.md`, and the learner-time run on `fixtures/capsule-run-demo`: the manifest carries no
answer, the author's landmark is withheld, and failed or missing runs recover. A passing run is
recorded as the learner's own result, which a later `spot_the_flaw` scene can be grounded on
(`reference_from_run` in the [lesson bundle format](lesson-bundle.md#spot_the_flaw)).
