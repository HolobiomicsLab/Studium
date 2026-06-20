# Studium — session handoff (2026-06-20)

Resume point for continuing in **Claude Code desktop**. This repo is `~/git/prototype-build`
(remote `github.com/HolobiomicsLab/studium`). Everything below is **on `origin/main`** as of
this session unless noted.

---

## 1. What landed on `main` this session

`origin/main`: `15f16c6 → 9c64a00` (3 commits):

| commit | what |
|---|---|
| `3b70921` | **fix:** quiz answer-position leak — choices shuffled + re-lettered at bundle load |
| `5748196` | **feat:** discussion live Socratic tutor wired into host deps; `submit_turn` returns signal + tutor move |
| `9c64a00` | **chore:** consolidated ~89 files of prior-session WIP that were uncommitted (eval scale-up, capsule runner, render manifest / `get_scene_artifacts`, consent telemetry, FSRS, `studium-vscode`, `scene-assets`) + this session's test-fix + per-learner shuffle |

> ⚠️ `9c64a00` bundles a lot of **prior-session work not authored/reviewed this session** — worth a skim.
> Pre-existing reds (unchanged by this session): repo-wide `tsc -b` (`fsrs.ts` strict-null, `lesson-schema` JSON `assert` imports) and `pnpm lint`. CI never compiles, runtime uses `tsx`.

**Tests green for what we touched:** `lesson-session-host` 62/62 · `lesson-mcp` 12/12 · `lesson-session` tutor/discussion 58/58.

---

## 2. The 7 interaction modes (`packages/lesson-bundle-schema/src/scenes.ts`)

| mode | interaction | free text? | status |
|---|---|---|---|
| intro / concept | read markdown (+image, +cited evidence) | — | ✅ |
| **quiz** | MCQ 2–6 choices | — | ✅ leak fixed (shuffled) |
| meta_checkpoint | confidence 0–4 → calibration loop | — | ✅ |
| reproduction | run a capsule, see graded reference run | — | ✅ (`tools/capsule_runner.py`) |
| **ai_critique** | critique planted flawed claims | ✅ one-shot | ✅ |
| **discussion** | multi-turn Socratic dialogue | ✅ narrative | ✅ live-tested w/ LLM this session |

Grading: `packages/lesson-session/src/grading/graders.ts`. Adaptive engine: `packages/adaptation-engine`.

---

## 3. Live testing — how to drive each mode

All drivers spawn the **same** `apps/lesson-mcp` stdio server VS Code connects to. Course =
`/tmp/studium_live/11-enriched.json` (authored from Nothias 2020 FBMN paper; carries live artifacts).
`11-discuss.json` = same course + a discussion scene.

```bash
cd ~/git/prototype-build

# Quiz/adaptive loop (deterministic replay; pass answers a/b/c, "hint")
node apps/lesson-mcp/studium_try.mjs            # turn 1: shows first quiz
node apps/lesson-mcp/studium_try.mjs a a a      # replays answers, stops at next quiz

# Discussion — OFFLINE (mechanics only: StubReasoningScorer returns constant justification/0.5)
node apps/lesson-mcp/studium_discuss.mjs        # shows seed claim + turn 1 prompt

# Discussion — LIVE LLM (real classification + content-aware Socratic tutor):
PORT=8799 zsh -lic 'node apps/lesson-mcp/anthropic_shim.mjs' &   # OpenAI-compat shim → Claude Haiku; reads ANTHROPIC_API_KEY from ~/.zshrc
LITELLM_BASE_URL=http://127.0.0.1:8799 LITELLM_API_KEY=shim \
  STUDIUM_PSEUDO_SECRET=studium-live-demo-secret STUDIUM_LLM_TIMEOUT_MS=20000 \
  node apps/lesson-mcp/studium_discuss.mjs "<turn 1>" "<turn 2>" ... [done]
# kill the shim when done:  pkill -f anthropic_shim.mjs
```

**Why the shim:** the runtime LLM client is OpenAI-`/v1/chat/completions`-only (no Anthropic-direct).
The shim maps the alias `studium/runtime-tutor` → a Claude model. Live mode (`LITELLM_BASE_URL` set)
also REQUIRES `STUDIUM_PSEUDO_SECRET` ≠ dev-secret (RGPD fail-closed) and a bumped LLM timeout
(the 2 s default is too tight for a real round-trip).

### VS Code visualization (artifact pane) — F5
1. `code ~/git/prototype-build/apps/studium-vscode` (open that folder).
2. **F5** → "Run Studium Extension" → an Extension Development Host window opens.
3. In it: **Cmd+Shift+P → "Studium: Open Lesson"**.
4. Walk the FBMN course; the pane renders: cosine **equation** (KaTeX) on Introduction, a **Vega
   peak-area plot** on Two-Inputs, and the **executed reproduction** card (real `decay.png`, graded
   checks, k_fit≈0.4212). Answer quizzes / request hints in the pane.
   Prereqs already satisfied locally: `dist/extension.js` built, `media/vendor/` present, course exists,
   `.vscode/launch.json` added. If you edit `extension.ts`: `pnpm --filter studium-vscode build`.

---

## 4. MCP server (for Claude Code / Copilot to call the tools directly)

Registered (local scope) as `studium-lesson` → `claude mcp get studium-lesson` (✔ Connected).
9 tools: `start_lesson_session, get_current_scene, submit_response, get_scene_artifacts,
request_hint, submit_turn, explain_last_adaptation, get_session_state, end_session`.
Tools appear as `mcp__studium-lesson__*` **after a window reload** (server binds at session start).
`submit_turn` now returns `{accepted, reasoning, tutor}`.

---

## 5. Env vars

| var | effect |
|---|---|
| `BUNDLES_ROOT` | dir the server resolves `bundle_ref` against (`/tmp/studium_live`) |
| `STUDIUM_PER_LEARNER_SHUFFLE` | **new** — on → per-learner quiz answer order (salts shuffle by learnerId). default off → same order for all (item analytics aligned) |
| `STUDIUM_DATA_DIR` | durable mode: pseudonymized per-learner state/telemetry on disk |
| `STUDIUM_TELEMETRY_CONSENT` | with durable mode → writes pseudonymized telemetry.jsonl (ADR-006) |
| `STUDIUM_PSEUDO_SECRET` | required (≠dev-secret) in live mode; salts RGPD pseudonym |
| `LITELLM_BASE_URL` / `LITELLM_API_KEY` | set → live LLM (reasoning scorer + tutor) |
| `STUDIUM_LLM_TIMEOUT_MS` | **new** — runtime LLM timeout (default 20 s) |

---

## 6. Key seams touched this session

- `packages/lesson-session-host/src/shuffle-choices.ts` — the leak fix (deterministic per-scene; optional per-learner salt).
- `packages/lesson-session-host/src/bundle-resolver.ts` — applies the shuffle on load.
- `packages/lesson-session-host/src/host.ts` — per-learner salt gate; `lastTutorMove()`/`lastReasoning()` accessors.
- `packages/lesson-session-host/src/deps.ts` — wires `StubSocraticTutor` (offline) / `LiteLLMSocraticTutor` (live) + LLM timeout.
- `packages/lesson-session/src/session.ts` — `getLastReasoning()` (+ MASTERY_CLAIM_THRESHOLD 0.85 from prior work).
- `apps/lesson-mcp/src/server.ts` — enriched `submit_turn` return.
- Demo drivers: `apps/lesson-mcp/*.mjs` (now committed).

### Build gotcha (important)
`.ts` files have committed/loaded `.js` siblings; `tsx` **and** vitest load the `.js` shadow if present.
After editing a `.ts`, regenerate its `.js`:
`node_modules/.pnpm/node_modules/.bin/esbuild <file>.ts --format=esm --platform=node --outfile=<file>.js --allow-overwrite`
(`packages/*/src/**/*.js` and `apps/*/src/**/*.js` are gitignored — local-only.)

---

## 7. Open items / suggested next steps

1. **Answer key leaks to the client:** presented quiz scenes still include `correct: true` per choice;
   real student clients shouldn't receive it. Move correctness server-side (grade by index without
   shipping the flag). *(High value before any real classroom use.)*
2. **Offline reasoning scorer is a constant** (`StubReasoningScorer` → `justification`/0.5). For
   offline discussion that reacts to content without an LLM, write a heuristic scorer (counterexample
   / hypothesis / question / synthesis markers). The accurate path is the live LLM (shim above).
3. **Live tutor wiring is demo-grade** (the `anthropic_shim` + `.mjs` drivers). Productionizing means a
   real LiteLLM proxy or a first-class Anthropic adapter in `packages/llm-client` (currently litellm/mock only).
4. **Pre-existing reds:** `tsc -b` (`fsrs.ts` strict-null; `lesson-schema` JSON assert imports) and `pnpm lint`.
5. **`generate_variants`** (per-student *different questions*, not just order) — still unbuilt.
6. Consider deleting merged local branches `fix/quiz-choice-shuffle`, `feat/discussion-live-tutor`.

---

## 8. Pointers
- Memory: `studium-hub-install` (install + MCP + this session's recipes), `studium-eval-scaleup`, `studium-manuscript-state`.
- Manuscript: `~/git/studium_manuscript` (paper-spec-only).
- Constellation/dev hub: `~/git/studium_dev`.
