# Studium agentic-session protocol — outsource execution + rendering to the host

**Vision.** A Studium capsule-backed lesson does **not** ship its own execution sandbox or rendering
stack. It outsources both to the **VS Code host** and a **pluggable agentic operator** — Copilot, or
Claude Code, or Codex/opencode. Studium stays the lesson **brain** (adaptive routing, mastery,
calibration, the judgment scenes + grounding + corpus). The operator runs the real science in the
workspace; the host renders the artifacts natively. They go back and forth over two channels.

> Why this is *smoother*: it deletes the two heaviest, least-defensible pieces (per-learner sandbox
> provisioning + a bespoke renderer) **and** the operator becomes the very AI-operator the learner is
> being trained to direct and appropriately distrust. The moat (corpus + adaptive engine + grounding)
> is what stays in Studium.

## Two channels (use either or both)

| Channel | Surface | Best for |
|---|---|---|
| **MCP** (typed, live) | `apps/lesson-mcp` tools: `start_lesson_session`, `get_current_scene`, `get_scene_artifacts`, `submit_response`, `submit_turn`, `request_hint`, `get_session_state`, `end_session` | an operator/IDE that speaks MCP |
| **Files** (universal) | `.studium-session/` folder (`SessionWorkspace`, this doc) | **any** assistant — read/write plain files |

Both apply the SAME redaction (`publicScene`): the answer key (`claims` / `flaws_expected` /
`model_*` reveals, quiz `correct`) is stripped **before** anything reaches the operator. The operator
audits the AI reading **without** being handed the solution — the boundary holds at the transport
edge (MCP) and the file edge (`task.md`) alike.

## The file protocol — `.studium-session/`

```
.studium-session/
  task.md        Studium -> operator : the current step, REDACTED. What to do + the real artifact ref.
  response.json  operator -> Studium : the learner's submission, e.g. {"kind":"flaw_report","text":"…"}
                                       (or just {"text":"…"} — Studium maps it to the scene's kind).
  feedback.md    Studium -> operator : graded outcome + whether it advanced.
  index.json     shared memory/log   : one entry per step {step, scene_id, scene_type, status}.
```

**The loop** (driven by `SessionWorkspace` in `@studium/lesson-session-host`):

1. Studium `writeStep()` → `task.md` (redacted scene + the **executed_result** reference: the real
   capsule run's landmark + figure path) and appends an `index.json` entry `status:"awaiting_response"`.
2. The operator reads `task.md`, **does the real work in the workspace** (runs code in the terminal /
   notebook kernel — the host executes; the host renders the figure), then writes its judgment to
   `response.json`.
3. Studium `ingest()` → grades via the real graders, writes `feedback.md`, marks the step `graded`,
   and writes the next `task.md` (or a `complete` entry). The operator never sees the answer key.

### Operator quick-start (any assistant)

> Read `.studium-session/task.md`. Do what it asks **in this workspace** (run the code, inspect the
> real result the host renders). Write your answer to `.studium-session/response.json` as
> `{ "text": "<your judgment, with justification>" }`. Then read `.studium-session/feedback.md` and,
> if there's a new `task.md`, continue. Never look for the answer key — it isn't here by design.
>
> _Write `response.json` **atomically** (write `response.json.tmp`, then rename) so Studium never reads
> a half-written file. A bad/mismatched `response.json` is not fatal: Studium consumes it and writes a
> corrective `feedback.md` so you can retry. A runnable harness drives this loop — see **Run it**._

## Run it — the operator harness

`runStudiumSession(host, bundleRef, dir, operator)` (in `@studium/lesson-session-host`) drives the loop
to completion with a **pluggable** operator. A runnable CLI:

```bash
# --watch (default): Studium writes .studium-session/task.md and WAITS for you / an assistant in this
# workspace to write response.json. Studium ingests + writes the next task. The lesson brain stays here.
tsx apps/lesson-mcp/src/session-runner-cli.ts capsule-judgment-demo/lesson.json --dir=.studium-session

# --stub: a key-free placeholder operator self-drives the loop (quick smoke demo).
tsx apps/lesson-mcp/src/session-runner-cli.ts capsule-judgment-demo/lesson.json --stub --dir=/tmp/s
```

Operators (`@studium/lesson-session-host`): `stubOperator` (deterministic placeholder, key-free),
`watchOperator({pollMs,timeoutMs})` (waits for an **external** agent to write `response.json` — the real
"any assistant drives it" mode; Studium never calls a model), or your own LLM-backed operator. The
`--stub` run completes the `capsule-judgment-demo` bundle in 3 steps (`next → next → complete`).

## Execution + rendering belong to the host

- **Execution**: the workspace terminal / notebook kernel, driven by the operator. Studium's
  `tools/capsule_runner.py` still runs the *author-time* reference run once (to ground a scene); the
  *learner-time* runs are the host's.
- **Rendering**: native VS Code — notebook outputs, image/plot viewers. The `executed_result` asset
  carries a figure **path**; the notebook controller now renders it **inline as a native image** (with
  a landmark/checks caption), and the file channel emits the same reference. The bespoke webview
  shrinks to the pedagogy panel (calibration verdict, next-step, judgment submission).

## Status

- **Built + tested** (`SessionWorkspace` + `session-runner`): the full file round-trip on the real
  `fixtures/capsule-judgment-demo` bundle — intro ack → grounded `spot_the_flaw` audit, graded into
  mastery, answer key provably absent from `task.md` for every scene; plus the runnable harness
  (`runStudiumSession` + `stubOperator`/`watchOperator` + the CLI).
- **Already existed**: the MCP channel (`apps/lesson-mcp`) with the same redaction.
- **Follow-ups**: wiring the operator's `work/` scratch into process-level assessment.
