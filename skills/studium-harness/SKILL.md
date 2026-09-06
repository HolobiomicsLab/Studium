---
name: studium-harness
description: Drive a Studium lesson as an AI harness — start the lesson-mcp stdio server, run the scene loop over MCP or the .studium-session file channel, execute learner-time capsule runs honestly, verify with the headless smoke, and run the eval harness. Use when asked to run, test or demo a Studium lesson from Claude Code, Cursor, OpenCode or a headless script.
---

# studium-harness — Studium as the lesson brain, this harness as the hands

Studium (`~/git/prototype-build`, GitHub `HolobiomicsLab/studium`) is a standard MCP
stdio server (`apps/lesson-mcp`). The harness renders scenes, executes any code, and
submits the learner's answers; Studium presents, grades, adapts, attests and records.
Two invariants shape every step below:

- **Studium never executes science.** Learner-time runs are yours (run manifest in,
  run result out). Report what actually happened.
- **The answer key never reaches the learner side.** `publicScene` redaction strips
  `claims` / `flaws_expected` from MCP responses and from `task.md` alike. Do not go
  and read them from the bundle while playing a lesson.

`docs/guides/agent-harness-matrix.md` is the short reference; `tools/list` on the
running server is the authoritative tool surface.

## 1. Prerequisites (this checkout)

| Need | Where |
| --- | --- |
| Repo | `/Users/nothiasl/git/prototype-build` (`pnpm install` already run; Node 20+) |
| `tsx` | `apps/lesson-mcp/node_modules/.bin/tsx` (app-local, present on any pnpm checkout); the smoke falls back to `node_modules/.pnpm/node_modules/.bin/tsx`. There is no root `node_modules/.bin/tsx` here |
| Bundles | `fixtures/` — refs are paths relative to `BUNDLES_ROOT` (below) |
| Python (eval only) | `.venv/bin/python` (3.13); never the system `python3` |
| Capsule runs | `python3` + `uv` for `tools/capsule_runner.py` (the operator demo) |

Bundle refs available: `atomistique-l1/lesson.json` (validated L1 chemistry),
`capsule-judgment-demo/lesson.json` (reproduction run + verdict deck),
`capsule-run-demo/lesson.json`, `capsule-loop-demo/lesson.json`,
`m3/demo-metabolomics/lesson.json`; `m6/demo-atomistique/lesson.json` fails schema
parse and is quarantined in the bundle lint — do not use it.

## 2. Start the server (identical for every harness)

```
command: /Users/nothiasl/git/prototype-build/apps/lesson-mcp/node_modules/.bin/tsx
args:    ["src/index.ts"]
cwd:     /Users/nothiasl/git/prototype-build/apps/lesson-mcp
env:     BUNDLES_ROOT=/Users/nothiasl/git/prototype-build/fixtures
         # optional, only with consent: STUDIUM_TELEMETRY_CONSENT=granted STUDIUM_DATA_DIR=<dir>
```

Claude Code: put this in `.mcp.json` at the workspace root and restart the session:

```json
{"mcpServers": {"studium": {
  "command": "/Users/nothiasl/git/prototype-build/apps/lesson-mcp/node_modules/.bin/tsx",
  "args": ["src/index.ts"],
  "cwd": "/Users/nothiasl/git/prototype-build/apps/lesson-mcp",
  "env": {"BUNDLES_ROOT": "/Users/nothiasl/git/prototype-build/fixtures"}}}}
```

Cursor: same object in `.cursor/mcp.json`. OpenCode: same command/args/env under
`mcp` in `opencode.json`. A packaged VSIX ships the server as `dist/lesson-mcp.cjs`;
`command: node`, `args: [<ext>/dist/lesson-mcp.cjs]` reuses one install.

Without a consent variable nothing is persisted; `end_session` emits
`forget_requested` and drops the session (right to be forgotten).

## 3. The scene loop over MCP

1. `start_lesson_session {bundle_ref, learner_id?}` → `session_id` + first presentation.
2. `get_current_scene {session_id}` — scene type, prompt, choices, hints available.
   `get_scene_artifacts {session_id}` — the render manifest (`scene_assets[]`: image,
   svg, equation_latex, plot_spec, code, data_csv, protocol_md, executed_result).
   Render or describe them; that is the harness's job.
3. Answer with `submit_response {session_id, input}`. `input.kind` by scene type:

   | Scene | `input` |
   | --- | --- |
   | intro, concept, reproduction (no run), discussion | `{"kind":"ack"}` |
   | quiz | `{"kind":"quiz_choice","choiceId":"a","confidence":0-4}` |
   | meta_checkpoint | `{"kind":"confidence","value":0-4}` |
   | ai_critique | `{"kind":"critique","text":"…","confidence":0-4}` |
   | spot_the_flaw (free text) | `{"kind":"flaw_report","text":"…","confidence":0-4}` |
   | spot_the_flaw (verdict deck) | `{"kind":"flaw_verdicts","verdicts":[{"token":"…","flagged":true}],"confidence":0-4}` |

   The reply carries the transition: `next`, `replay`, `calibration` or `complete`.
   `confidence` is the learner's calibration signal (0 = guessing, 4 = certain); give
   the value you actually hold, it feeds the calibration and trust metrics.
4. Discussion scenes: `submit_turn {session_id, text}` per turn (Socratic tutor reply
   comes back with the scored reasoning signal), then `submit_response` with `ack`.
5. `request_hint {session_id}` on a quiz returns the next authored hint (each hint
   discounts mastery; the per-visit cap ends with `hint: null`).
6. `explain_last_adaptation {session_id}` — rule id + modulator + explanation, or
   null. `get_workflow_graph {session_id}` — live per-concept state
   (mastered / current / available / locked). `get_session_state {session_id}` —
   mastery, completed scenes, history. `get_next_reinforcement {session_id, now_ms?}` —
   FSRS router: the most urgent decaying concept, or null.
7. Repeat 2–3 until `complete`, then `end_session {session_id}`.

Peer tools (`open_peer_room`, `join_peer_room`, `submit_peer_rating`,
`get_peer_room_state`, `close_peer_room`) are teacher/learner room mechanics with a
3-rater k-suppression; they are not part of a single-learner run.

## 4. Learner-time runs (the run protocol)

When a scene carries a run, `get_run_manifest {session_id}` returns
`{capsule_ref, cmd, working_dir?, timeout_s?, requirements?, expected_outputs[],
verify_checks[], research_question?}`. Then:

1. Provision (venv, requirements) and run `cmd` in `working_dir` in **your**
   workspace, with the timeout.
2. Evaluate every `verify_checks` entry and collect `expected_outputs`.
3. `submit_run_result {session_id, run_result}` with
   `{"ran":bool,"passed":bool,"landmark":str|null,"artifacts":[paths],
   "checks":[{"check":"…","passed":bool}],"stdout_tail":"…","provenance":{"cmd":[…],"env":"…"}}`.

Advance is gated on `ran && passed`; a passing run records the learner's **own**
executed result, which a later judgment scene is grounded on. Honesty rules: `ran:false`
when nothing ran; `passed` only when the checks passed; never invent a landmark; a
failed run is a legitimate result and yields a corrective step, not a wedge. The file
fallback is `run_result.json` next to the bundle (section 5), also the recovery path
when a submit fails.

## 5. The file channel (`.studium-session/`) — no MCP session needed

Start the operator harness from the repo root; it writes the first task and waits:

```bash
cd /Users/nothiasl/git/prototype-build && cd /Users/nothiasl/git/prototype-build && apps/lesson-mcp/node_modules/.bin/tsx apps/lesson-mcp/src/session-runner-cli.ts capsule-judgment-demo/lesson.json --dir=/absolute/dir/.studium-session
```

Flags: `--bundles-root=DIR` (default `<cwd>/fixtures`), `--dir=DIR` (default
`<cwd>/.studium-session`), `--stub` (a key-free placeholder operator self-drives the
loop; use it as a smoke). Files in the directory:

| File | Direction | Content |
| --- | --- | --- |
| `task.md` | Studium → operator | the current step, redacted, with the real artifact ref |
| `response.json` | operator → Studium | `{"text":"…"}` or a typed input from section 3 |
| `run.json` / `run_result.json` | Studium → operator / operator → Studium | run manifest / run result (section 4 shape) |
| `feedback.md` | Studium → operator | graded outcome and whether the lesson advanced |
| `index.json` | shared log | one entry per step `{step, scene_id, scene_type, status}` |

Operator loop: read `task.md`; do the work in the workspace; write `response.json`
**atomically** (`response.json.tmp`, then rename); read `feedback.md`; continue while a
new `task.md` appears. A mismatched response is consumed and answered with a
corrective `feedback.md`; retry. Never look for the answer key.

The LLM-backed operator demo runs the capsule for real and judges its own run:
`tsx apps/lesson-mcp/src/llm-operator-demo.ts [bundleRef] [--dir=DIR] [--bundles-root=DIR] [--live]`
(default LLM is a deterministic placeholder; `--live` needs `LITELLM_BASE_URL`,
optional `LITELLM_API_KEY`, `LITELLM_MODEL`, and is a paid run — owner's go first).

## 6. Verify before claiming anything works

```bash
cd /Users/nothiasl/git/prototype-build && node apps/lesson-mcp/scripts/headless_smoke.mjs
```

The smoke is the reference MCP client (bare `@modelcontextprotocol/sdk`, no VS Code
code): start → scene → ack → artifacts → workflow graph → end; 14 assertions, about
a second. Run it after any change to the server, a bundle or this skill. For the file
channel, a `--stub` run of the session-runner CLI on `capsule-judgment-demo/lesson.json`
must end with `complete ✔` (3 steps). The stub cannot answer quizzes: on a quiz-bearing
bundle such as `atomistique-l1` it replays until the 100-step cap and exits 0 with
`stopped after 100 steps` — that is not a pass. Read the last line, not the exit code.

## 7. The evaluation harness (personas, corpora, judges)

```bash
cd /Users/nothiasl/git/prototype-build && .venv/bin/python eval/run_eval.py --list
.venv/bin/python eval/run_eval.py --smoke
.venv/bin/python eval/run_eval.py --corpus 04
.venv/bin/python eval/run_eval.py --corpus 04 --author claude --live --audit-llm
.venv/bin/python eval/run_eval.py --all
```

Outputs land in `eval/reports/<corpus>-<mode>-<ts>/` (gitignored): `report.md`,
`audit.json`, `author_provenance.json`, the bundle zip and one `sessions/<persona>/`
directory per persona. `--live`
and `--audit-llm` call paid models (`LITELLM_*`, scene-synth `/scenes/critique-eval`)
and need the owner's go; everything else is offline. The scene-judge review pass is
`eval/harness/scene_judge.py <bundle/lesson.json> [--out DIR]` (verdicts per scene,
worst case first, written as ASTRA decisions under `review/`).

## 8. Gotchas

- `cwd` must be `apps/lesson-mcp` and `BUNDLES_ROOT` absolute, or `start_lesson_session`
  cannot resolve the bundle. `tsx` is app-local: `apps/lesson-mcp/node_modules/.bin/tsx`.
- The server logs to stderr only; anything printed to stdout corrupts the MCP stream.
- `pnpm build` no longer writes into `packages/*/src` (INT-STUDIUM-015). On a tree
  built before that fix the stale `.js`/`.d.ts` there still shadow the sources under
  vitest and double every suite; clear them with
  `git status --ignored --porcelain packages apps | awk '/^!! /{print $2}' | grep -E '/src/.*\.(js|d\.ts|js\.map|d\.ts\.map)$' | xargs rm -f`
  (the earlier form of this line missed the two `.map` extensions).
- One operator session per `.studium-session/` directory; stale files from a previous
  run are read as responses.
- The session-runner CLI exits 0 both on `complete` and at its 100-step cap.
- Telemetry without `STUDIUM_TELEMETRY_CONSENT=granted` is dropped, by design; the
  teacher dashboard (`apps/teacher-dashboard`, collector on :8003) only sees consented,
  k-suppressed aggregates.
- Do not edit fixtures or tests while a run is in progress; file a bundle change
  separately and re-run the bundle lint (`node tools/bundle_lint.mjs`).

## 9. Pointers

`docs/guides/agent-harness-matrix.md` · `docs/agentic-session-protocol.md` ·
`apps/lesson-mcp/scripts/headless_smoke.mjs` · `apps/lesson-mcp/src/session-runner-cli.ts` ·
`apps/lesson-mcp/src/llm-operator-demo.ts` · `eval/README.md` · `docs/adr/0001-astra-analyses-shape-and-ara-trace.md`.
