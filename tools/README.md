English · [Français](README.fr.md)

# Tools

Command-line tools and scripts that sit beside the apps: prepare and check a lesson, approve it,
export reports, run the test suites, and reproduce audits and demonstrations. Run them from the
repository root; Python tools use the repository's virtual environment (`.venv`).

| | |
|---|---|
| Status | **maintained** (the authoring and approval CLIs are part of the supported route) |
| Setup | `pnpm install`; `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt` |
| Tests | `.venv/bin/python -m pytest tools` and `bash tools/bundle_lint.test.sh` |

The [CLI reference](../docs/reference/cli.md) documents the options of the main commands.

## Prepare, check and approve a lesson

| Command | What it does |
|---|---|
| `.venv/bin/python tools/conversation_sources.py` | turn a Claude Code transcript (`.jsonl`) or a text export of a conversation into `prepare_sources` input, kind `conversation`; local, tool results off by default, credential-looking strings redacted (`--focus`, `--last`, `--include-tool-results`, `--language`, `--out`) |
| `.venv/bin/python tools/concept_map_report.py export` / `verify` | turn the record `export_concept_map` wrote into a self-contained interactive page of the concept map with its ASTRA document, ARA trace and MySTRA page, then verify it (`--class-report`, `--expect-sha256`, `--language`); see [Concept map](../docs/learn/concept-map.md) |
| `.venv/bin/python tools/experience_packet.py passages` | capture a learner-chosen URL, HTML page, PDF or text file as a passage envelope (`--url`, `--html`, `--pdf`, `--text`, `--out`) |
| `.venv/bin/python tools/experience_packet.py prepare` | turn passages into an offline authoring packet (`--passages`, `--out`, `--title`) |
| `.venv/bin/python tools/experience_packet.py check` | validate an author response against the packet (`--packet`, `--response`, `--out`; `--json` for structured findings) |
| `.venv/bin/python tools/experience_packet.py bundle` | build a playable lesson bundle from a checked course (`--course`, `--out`) |
| `.venv/bin/python tools/experience_packet.py approve` | record a teacher's review of a lesson as `approval.json`, bound to the exact bytes of `lesson.json` (`--bundle`, `--validated-by`) |
| `node tools/bundle_lint.mjs <lesson.json>` | dependency-free lint of an authored bundle; `--root <dir>` lints a folder of bundles |
| `node_modules/.pnpm/node_modules/.bin/tsx tools/bundle_validate.ts <lesson.json>` | validate a bundle against the TypeScript schema |
| `.venv/bin/python tools/self_study_passages.py` | the passage capture behind `experience_packet.py passages` |
| `.venv/bin/python tools/experience_approval.py` | `import`, `approve`, `verify`, `attach`, `synthesize`: local review of an exact lesson-plan revision |
| `.venv/bin/python tools/experience_review.py <checked dir>` | render a checked draft as an ASTRA/MySTRA provenance view (not an approval) |
| `.venv/bin/python tools/compose_lesson.py` | chain a corpus and a capsule into a graded judgment bundle |

`prompts/` holds the author task texts these tools hand to an assistant; `fixtures/` holds the test
inputs of the lint and report tools.

## Reports and analytics

| Command | What it does |
|---|---|
| `.venv/bin/python tools/class_report.py <run_dir>` | class analytics over telemetry streams, behind a floor of five learners |
| `.venv/bin/python tools/learner_report.py export` / `verify` | export a learner-selected activity report, or verify one |
| `.venv/bin/python tools/learner_trace.py validate` / `schema` | validate a learner-action file, or write its JSON Schema |
| `.venv/bin/python tools/astra_render.py <course_dir>` | render a course's provenance as one MyST page (MySTRA) |
| `.venv/bin/python tools/astra_validate_check.py` | build the planner's ASTRA set and run the real validator (CI runs it) |
| `.venv/bin/python tools/ontology_report.py` | regenerate the ontology conformance page from the schemas on disk |

## Activities, media and capsules

| Command | What it does |
|---|---|
| `.venv/bin/python tools/experience_templates.py list` / `prepare` | list and prepare the activity templates of [`examples/activity-templates`](../examples/activity-templates) |
| `.venv/bin/python tools/activity_presentation.py`, `tools/activity_support.py` | presentation preferences and render-asset sidecars for activity viewers |
| `.venv/bin/python tools/media_workflow.py prepare` / `attach` | write a provider-neutral media request; attach a checked local result |
| `.venv/bin/python tools/experience_exploration.py` | capture a harness exploration for review, without executing it |
| `.venv/bin/python tools/capsule_runner.py <capsule_dir>` | run an ASB reproduction capsule and capture its artifacts (light tier only unless `--allow-heavy`) |
| `.venv/bin/python tools/ground_judgment.py` | attach a real capsule execution to a judgment scene |
| `.venv/bin/python tools/funmooc_ingest.py` | read a FUN-MOOC (Open edX) course you can access, with your own session cookie, into a corpus |

## Tests and quality

| Command | What it does |
|---|---|
| `.venv/bin/python tools/pytest_all.py` | every Python suite of the repository, one pytest process per suite |
| `bash tools/bundle_lint.test.sh` | contract tests of the bundle lint |
| `node tools/docs/check.mjs` | the documentation gate: links, language pairs, generated reference pages |
| `node tools/docs/gen-mcp-tools.mjs`, `node tools/docs/gen-lesson-bundle.mjs` | regenerate the MCP tools and lesson bundle references (`--check` to verify) |
| `.venv/bin/python tools/latency_bench.py --live` | time a learner turn when an assistant relays a lesson: a headless Claude Code session, the server of this checkout, a labelled synthetic learner; compares a relay (`--mode relay --model`), the lesson agent (`--mode agent --agent-file`) and a hand-over on every answer (`--mode delegate`); `--probe` also asks for the answer and for a deep explanation. Paid: nothing runs without `--live` |
| `.venv/bin/python tools/latency_bench.py --mode forms` (or `--mode panel`) | time the two lanes that need no model, with no paid call and no `--live`: the script is the MCP client. `forms` answers the forms `play_in_forms` sends and times each answer up to the form that shows its verdict; `panel` calls `panel_action` directly. It reports the median, the 95th centile and the maximum in milliseconds: the server's work and the transport over stdio, not what a client takes to draw the screen. `--durable` makes the server save the learner's state to a temporary folder, as on a learner's machine; `--turns` caps the answers (40 by default) |
| `node tools/audit-*.mjs`, `.venv/bin/python tools/audit-*.py` | browser and accessibility audits of the learner, teacher, VS Code and Observatory surfaces; each names its inputs in its header |

## End-to-end and demonstrations

| Command | What it does |
|---|---|
| `bash tools/e2e-demo-m6.sh` | two-session demo with the analytics collector and the teacher dashboard (also a manual CI job) |
| `bash tools/e2e-c2.sh`, `bash tools/e2e-m5.sh`, `bash tools/e2e-a10.sh` | older end-to-end pipelines (telemetry, cross-session, plan to bundle); some need the frozen Tauri app |
| `.venv/bin/python tools/demo-literature-experience.py <new dir>` | captured paper to draft to MySTRA to external viewer |
| `.venv/bin/python tools/demo-grounded-exploration.py <new dir>`, `tools/demo-template-reports.py` | exploration and template-report demonstrations, without a model call |
| `.venv/bin/python tools/bake_demo_fresh.py`, `tools/build_capsule_judgment_demo.py` | rebuild demonstration bundles |
| `.venv/bin/python tools/memory_cli.py` | append entries and decisions to the agent memory in `.memory/` |

## Releases

| Command | What it does |
|---|---|
| `node tools/release/version.mjs --check` / `X.Y.Z` | check that every place carries the product version, or write a new one everywhere and open its changelog section |
| `tools/release/build.sh <out-dir>` | build and test the files of a release (VSIX, MCP server, checksums, npm package); `--untagged` for a trial of the working tree |
| `node tools/release/registries.mjs status [version]` | say whether a version is on npm, the MCP Registry, the Marketplace and Open VSX; read-only |
| `tools/release/send.sh <out-dir>` | the maintainer sends a built release to the registries, one question per registry; `--plan` sends nothing |
| `node --test tools/release/*.test.mjs`, `bash tools/release/send.test.sh` | tests of these tools; no network, nothing sent |

See [Release](../docs/develop/release.md).

## See also

- [Author a lesson](../docs/teach/author-a-lesson.md)
- [Review and approve](../docs/teach/review-and-approve.md)
- [Testing](../docs/develop/testing.md)
