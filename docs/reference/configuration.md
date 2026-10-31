English · [Français](configuration.fr.md)

# Configuration

Studium needs no configuration to start: the MCP server keeps lessons and progress under
`~/.studium` and works without any model. This page lists every environment variable the servers
and services read, with its default, and the VS Code extension's settings. A commented template of
all of them is in [.env.example](../../.env.example); nothing loads that file automatically, so copy
the lines you need into your shell, your harness configuration or your service manager.

An empty value (`VAR=`) counts as unset for the variables of the MCP server.

## Where lessons and progress live

| Variable | Default | Read by | Purpose |
|---|---|---|---|
| `STUDIUM_HOME` | `~/.studium` | lesson-mcp, VS Code extension, teacher dashboard | Root of the learner's library (`<STUDIUM_HOME>/library`) and data (`<STUDIUM_HOME>/data`). |
| `BUNDLES_ROOT` | lesson-mcp: `<STUDIUM_HOME>/library`; see the other components below | lesson-mcp and every server | Folder a `bundle_ref` is looked up in first. lesson-mcp also searches the library. `prepare_sources` and `create_lesson` never write here: they always write to `<STUDIUM_HOME>/library`. |
| `STUDIUM_DATA_DIR` | `<STUDIUM_HOME>/data` | lesson-mcp, lesson-server, HTTP API | Durable learner state. Set it to choose another folder; it is kept even with `STUDIUM_EPHEMERAL=1`. lesson-server and the HTTP API keep state in memory unless it is set. |
| `STUDIUM_EPHEMERAL` | unset | lesson-mcp | `1` (or `true`, `yes`, `on`) keeps learner state in memory, lost at restart. Use it for tests, demos and CI. |
| `STUDIUM_LEARNER_ID` | `anonymous` | lesson-mcp | Learner id used when a call names none. |

Dates in tool results and in the text shown to the learner are calendar days in the time zone of the
process, reported as `get_server_info.time_zone`. There is no Studium variable for it; Node.js follows the
system setting, or `TZ` when it is set.

## Privacy and pseudonyms

| Variable | Default | Read by | Purpose |
|---|---|---|---|
| `STUDIUM_PSEUDO_SECRET` | per-install file `<data dir>/.studium-secret` (mode 0600) | lesson-mcp, lesson-server, HTTP API | HMAC secret behind the pseudonyms that name learner folders on disk. A fresh data folder gets its own random secret; an older folder that already holds learners keeps the legacy secret so nobody loses progress. In-memory servers use `dev-secret`. |
| `NODE_ENV`, `STUDIUM_ENV` | unset | lesson-mcp, lesson-server, HTTP API | `production` refuses to start a session without a real pseudonym secret (as does a configured model). |
| `STUDIUM_TELEMETRY_CONSENT` | unset (off) | lesson-mcp, lesson-server, HTTP API | `1`, `true`, `granted` or `yes` writes pseudonymised class telemetry (`telemetry.jsonl`, no free text) next to the learner's state. Needs a durable data folder. The VS Code extension sets it from its setting only. |
| `STUDIUM_PER_LEARNER_SHUFFLE` | unset | lesson-mcp, lesson-server, HTTP API | Any value gives each learner their own, reproducible order of quiz choices. By default every learner sees the same order. |
| `STUDIUM_MASTERY_DIR` | unset | lesson-mcp, lesson-server, HTTP API | In memory-only mode, a folder to write mastery claims to. A durable data folder overrides it. |

Keep a copy of `.studium-secret` with the data folder: without it, existing learner folders cannot
be matched to their learners again.

## Judge model (optional)

Without a model, open answers get the reference to compare with and self-rating schedules reviews;
nothing claims a coverage no judge measured. A model is reached through an OpenAI-compatible
endpoint such as a [LiteLLM](https://docs.litellm.ai/) proxy.

| Variable | Default | Read by | Purpose |
|---|---|---|---|
| `LITELLM_BASE_URL` | empty (no model) | lesson-mcp, lesson-server, planner | Model endpoint. Non-empty turns on the judge, the Socratic tutor and the audit judge. The planner defaults to `http://localhost:4000` but only calls it with `STUDIUM_LLM_MODE=litellm`. |
| `LITELLM_API_KEY` | unset | lesson-mcp, lesson-server, planner | Bearer key for the endpoint. |
| `LITELLM_MODEL` | `studium/audit-judge` | lesson-mcp, lesson-server | Model name of the audit judge. The scorer and tutor use the alias `studium/runtime-tutor`. |
| `STUDIUM_LLM_TIMEOUT_MS` | `20000` | lesson-mcp, lesson-server | Timeout of a scoring or tutoring call, in milliseconds. |

## HTTP API of lesson-mcp

See [HTTP API](http-api.md). Started with `pnpm --filter @studium/lesson-mcp api`.

| Variable | Default | Read by | Purpose |
|---|---|---|---|
| `STUDIUM_API_TOKEN` | none (required) | HTTP API and its client | Bearer token, at least 32 characters. |
| `STUDIUM_API_PORT` | `8130` | HTTP API | Port, on 127.0.0.1 only. |
| `STUDIUM_API_LIVE` | unset | HTTP API | `1` enables the model of `LITELLM_BASE_URL`; otherwise the API never calls a model. |
| `STUDIUM_API_URL` | `http://127.0.0.1:8130` | `api:call` client | Loopback origin of the API. |
| `BUNDLES_ROOT` | `../../fixtures` (from `apps/lesson-mcp`) | HTTP API | Lessons served. |

## lesson-server

The REST server of the teacher dashboard's peer rooms and course pages (`pnpm --filter @studium/lesson-server start`).

| Variable | Default | Read by | Purpose |
|---|---|---|---|
| `BUNDLES_ROOT` | the current directory | lesson-server | Lessons served. |
| `PORT` | `8010` | lesson-server | Port, on 127.0.0.1. |
| `LITELLM_BASE_URL` | empty | lesson-server | As above. |

## Teacher dashboard and analytics

| Variable | Default | Read by | Purpose |
|---|---|---|---|
| `BUNDLES_ROOT` | `<STUDIUM_HOME>/library` | teacher dashboard | Lessons shown in the library and review pages. |
| `ANALYTICS_BASE_URL` | `http://localhost:8003` | teacher dashboard | analytics-collector service. |
| `SCENE_SYNTH_BASE_URL` | `http://localhost:8002` | teacher dashboard | scene-synth service (learner contributions). |
| `LESSON_SERVER_BASE_URL` | `http://localhost:8010` | teacher dashboard | lesson-server (peer rooms, courses). |
| `OBSERVATORY_BASE_URL` | `http://localhost:8004` | teacher dashboard | Observatory, linked from a lesson when it answers. |
| `ANALYTICS_DATA_DIR` | `data` (relative to the working directory) | analytics-collector | Where collected telemetry is stored. |
| `ANALYTICS_MIN_LEARNERS` | `5` | analytics-collector | Smallest cohort a class figure is computed over. Server-side only, never a query parameter. |

The dashboard's end-to-end tests also read `DASHBOARD_PORT` (default `3001`),
`DASHBOARD_PORT_EXTERNAL`, `PLAYWRIGHT_CHANNEL` and `CI`. The Observatory has its own variables
(`STUDIUM_OBS_*`), described in [services/observatory/observatory_config.py](../../services/observatory/observatory_config.py).

## scene-synth

| Variable | Default | Read by | Purpose |
|---|---|---|---|
| `BUNDLES_ROOT` | the repository's `fixtures/` | scene-synth | One folder per course, each with its `lesson.json`. |
| `COMMUNITY_BUNDLES_ROOT` | `BUNDLES_ROOT` | scene-synth | Where approved learner contributions are written (`<root>/<course>/community/`). |
| `LEARNER_DATA_ROOT` | `/tmp/studium-learner-items` | scene-synth | Store of submitted learner items. |
| `LEARNER_PSEUDONYM_SECRET` | `dev-insecure-secret` | scene-synth | HMAC secret of author pseudonyms. Set it in any real deployment. |
| `BUNDLE_DIR` | the demo's default folder | `demo_fresh.py` | Where the demo bundle is staged. |

## Planner

The planner answers 503 until a model is configured.

| Variable | Default | Read by | Purpose |
|---|---|---|---|
| `STUDIUM_LLM_MODE` | unset | planner | `litellm` calls the model; `mock` uses the deterministic mock (tests and demos only). |
| `STUDIUM_LWG_BUILD` | unset | planner | `on` builds the learning workflow graph of each plan. |
| `STUDIUM_LWG_OUT_DIR` | `.lwg` | planner, Observatory | Output folder of those graphs. |
| `STUDIUM_EVIDENCE_ENRICH` | unset | planner | `on` enriches plans with literature evidence. |
| `STUDIUM_PERSPICACITE_ENABLED` | unset | planner | `on` enables the Perspicacité literature client. |
| `STUDIUM_PERSPICACITE_MODE` | unset | planner | `mock` uses a mock client. |
| `PERSPICACITE_MCP_URL` | `http://localhost:8000/mcp` | planner | Perspicacité MCP endpoint. |
| `PERSPICACITE_DOMAIN_KB` | empty | planner | Default knowledge base. |
| `STUDIUM_PERSPICACITE_CACHE` | `on` | planner | `off` disables the on-disk search cache. |
| `STUDIUM_PERSPICACITE_CACHE_DIR` | `.cache/perspicacite` | planner | Cache folder. |

## Build identity

| Variable | Default | Read by | Purpose |
|---|---|---|---|
| `STUDIUM_BUILD_INFO` | unset | lesson-mcp run from sources | JSON `{origin, built_at, git_sha}` that `get_server_info` reports instead of asking git. A bundled server reports its compiled identity and ignores it. |

## VS Code extension settings

Set in VS Code's settings (`studium.*`). The extension starts its own MCP server with `BUNDLES_ROOT`
from `studium.bundlesRoot`, `STUDIUM_DATA_DIR` set to its VS Code storage folder, and
`STUDIUM_TELEMETRY_CONSENT` from `studium.telemetryConsent`; the rest of its environment is inherited.

| Setting | Default | Purpose |
|---|---|---|
| `studium.repoRoot` | the folder two levels above the extension | A Studium checkout; when found, the server runs from its sources. Otherwise the embedded `dist/lesson-mcp.cjs` runs. |
| `studium.bundlesRoot` | empty: the checkout's `fixtures/`, else `<STUDIUM_HOME>/library` | Lessons folder. |
| `studium.bundleRef` | `atomistique-l1/lesson.json` | Lesson opened by default. |
| `studium.communityBundlesRoot` | empty: `studium.bundlesRoot` | Root of approved learner contributions. |
| `studium.assets` | `vendor` | `vendor` (offline viewers) or `cdn`. |
| `studium.learnerId` | `vscode-learner` | Learner id. |
| `studium.telemetryConsent` | `false` | Consented, pseudonymised class telemetry. |
| `studium.showGraph` | `true` | Companion learning workflow graph panel. |
| `studium.graphView` | `student` | `student` (around the current concept) or `teacher` (whole graph). |
| `studium.showMastery` | `false` | Live mastery bar; a teacher signal that can leak answers during a quiz. |
| `studium.modalityPreference` | `balanced` | `visual`, `textual` or `balanced` ordering of a scene's supports. |

Progress made in the VS Code pane is kept in the extension's storage, separate from
`<STUDIUM_HOME>/data` used by a terminal assistant. "Studium: Forget my data" erases only the
extension's own data.
