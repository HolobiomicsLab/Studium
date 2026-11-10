# Changelog

All notable changes to Studium are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). A release takes the version of `apps/studium-vscode/package.json`. The sections below 0.2.0 are development lines, grouped by month, from before the first tagged release.

## Unreleased

### Changed

- **A calmer lesson panel for narrow side panels.** At 380 px the first screen of a quiz now holds the question, its choices and the button to answer: one compact session line (step, detour, time left, reviews due) replaces the two-line status and voice lines, who signs the lesson is a short chip that opens to the full sentence, and the confidence scale, « Submit » and a single « Help » button sit in a bar that stays at the bottom of the panel while the scene scrolls. « Help » opens the help ladder in place; a hint appears under the question and the question field opens in the ladder. The settings wait behind a closed section, which the « ⋯ » menu also opens. The feedback screen keeps the session line and shows the learner's answer beside the key the view carries, labelled with whose key it is; a written answer is quoted above the key points.

### Fixed

- **The panel's settings work in MCP Apps hosts.** « Quiet », the language buttons and « Replan » now reach the server: the bridge carries every action type of a list that `@studium/lesson-panel` exports from the action schema, and an action the view does not offer is refused without asking to try again.
- **The panel's keyboard and screen-reader defects found by the 10 November audit.** The focused control keeps the focus while an action is pending; the erase confirmation is a named dialog inside the panel, with « Cancel » first and Escape to cancel; the course picker and the question form are drawn inside the panel; a formula wider than the panel can be scrolled from the keyboard; the panel is the page's main region with a first-level heading; the confidence scale says what its two ends mean.
- **Feedback that says what it holds.** An answer nobody assessed no longer says « compare it with what follows » when nothing follows; a replayed question shows the key-free feedback the server returned and counts its attempts; a contest's check is announced in a card at the top of the scene; « Choose another course » is in the menu whenever the view offers it; after a question was sent, the notice says it went to the conversation.

- **The concept-map page can be built again.** `tools/concept_map_report.py export` refused every record written by the 0.3.0 server, because the record had gained the `evidence` and `contest` fields after the reader was written. The reader now validates both, including that each evidence entry names a step of the path and each contest a concept of the map. A record written by the server is kept as a test fixture, and a server-side test fails when the record's shape drifts from it.

## 0.3.0 — 2026-11-09

This release adds a two-lane lesson interface, an inspectable concept map, faster ways to play and review, and fixes found in the 5 November learner trial.

### Added

- **Two ways to play one lesson.** Three MCP tools, `open_lesson_panel`, `get_panel_view` and `panel_action`, share a public lesson view across VS Code, MCP Apps and a native Claude Code pane. The server chooses an MCP Apps panel or native pane, forms, or the conversation according to what the client can render. `packages/lesson-panel` holds the shared contract, `apps/lesson-panel-ui` the HTML renderer and bridges, and `apps/claude-code-mod` the Claude Code plugin; [Lesson panels in AI harnesses](docs/start/harness-panels.md) explains setup and limits. The two-lane interface has automated contract checks, but no learner has tried it yet: a formative trial is planned.
- **Answers without a model turn.** The prototype MCP tool `play_in_forms` uses MCP elicitation to show reading, quiz, confidence and concept-map forms, including a verdict after each answer, and hands back to the conversation when a scene needs written words or the learner wants to talk. `get_companion_brief` tells the assistant what happened on the panel, pane or forms lane since it last looked, without sending scene text, answer keys or references. `tools/latency_bench.py` times conversation, agent, forms and panel routes; only its explicitly requested `--live` mode makes paid model calls.
- **A concept map with evidence.** Lessons expose concept states, prerequisites and the path travelled. `get_workflow_graph` returns the map for the conversation, and the new MCP tool `export_concept_map` writes a local record with no learner identifier or learner words. `tools/concept_map_report.py export` turns that record into a self-contained interactive page with learner and teacher viewpoints, sources, ASTRA provenance and an ARA trace; `verify` checks it. In panels and forms, a learner can contest a concept they have reached: Studium asks check questions, and the claim alone never changes mastery or skips a scene. See [Concept map](docs/learn/concept-map.md).
- **Lessons from an existing AI conversation.** `tools/conversation_sources.py` converts a Claude Code transcript or text export into `prepare_sources` input, with credential-looking strings redacted and tool results excluded by default. The `studium-from-conversation` skill drives the authoring route, while `studium-concept-map` operates the map and `studium-suggest` notices when an existing Studium feature would help.
- **A dedicated fast lesson agent.** `.claude/agents/studium-lesson.md` plays a lesson or review as a strict relay on Claude Code's fast model, and `.claude/agents/studium-explainer.md` supplies a clearly labelled deeper explanation on request. Run `claude --agent studium-lesson`, or link the two definitions into `~/.claude/agents/`; do not place the agent between another model and every answer.
- **Orientation, voices and progressive help.** Panels, panes and conversation screens show the current step, time, due reviews and what is expected; who wrote or validated the lesson; and who assessed an answer. A help ladder lets the learner try first, then ask for a reread, hint, explanation or reference. Attention, presentation-language and available-time settings, a question hand-off, due-review and map proposals, and a resume notice work across the supported surfaces. `tools/studium_statusline.mjs` prints the current status for a Claude Code status line from the durable session's local `status.json`.
- **Teacher review receipts and interaction reports.** `tools/experience_packet.py approve` gains per-scene `--opened`, `--verdict`, `--note` and `--lang` options and writes a receipt of what was actually reviewed. The new `receipt --decision returned` records a return without approving the lesson. The teacher dashboard gains a consequence-sorted review inbox, verdict and lint details, and a preview of the voice learners will read. `tools/interaction_report.py` aggregates consented panel, forms, conversation, help, contest, resume and prompt events, behind the same minimum of five learners; `--single-stream` inspects one file without that floor.
- **Development probes for panels.** `node tools/panel-probe.mjs` exercises the panel contract, and `node tools/panel-http-dev.mjs` serves a loopback-only development adapter on `127.0.0.1:3001`. The latter is not an authenticated remote deployment. `experience_packet.py approve` and `receipt` use `STUDIUM_LANG=fr` or `en` when `--lang` is absent, then the system locale; recorded files stay identical in either language.

### Changed

- **Forty MCP tools, with explicit 0.x contract changes.** The server now registers 40 tools: the six named above (`play_in_forms`, `open_lesson_panel`, `get_panel_view`, `panel_action`, `get_companion_brief` and `export_concept_map`) in addition to the 34 in 0.2.0. `submit_response` accepts two new input kinds, `prompt {id, outcome: "accepted" | "dismissed"}` and `contest {concept_id, claim: "known" | "unsure"}`, and returns the corresponding prompt or check-question payload. Panel views use `studium/panel-view/2`, adding orientation, voices, help, prompts, attention and surface fields while retaining version-1 fields. `panel_action` accepts the new `ask`, `setAttention`, `setLanguage`, `replan`, `openMap`, `closeMap`, `contest` and `prompt` actions and optional `client_ms`; `get_companion_brief` accepts optional `peek`. `play_in_forms` now also returns the companion `brief` on hand-back, and orientation `reviews_due` counts due concepts across the learner's lessons without double-counting shared concepts. Conversation replies include orientation, voices and server proposals; form hand-backs include the companion brief.
- **The local HTTP API can record self-ratings.** It now exposes the 25 lesson operations plus `rate_recall` (26 operations), so an HTTP learner can complete the requested `again`, `hard`, `good` or `easy` rating after an ungraded production answer. Other study, authoring and teacher tools remain MCP-only.
- **Teacher commands record more of the decision.** `approve` keeps its existing bundle and reviewer inputs, adds review-receipt options and refuses a `to_fix` verdict; use `receipt --decision returned` instead. Per-item verdicts reach the receipt, a `review_receipt` event is recorded under the `reviewer` role, and viewing a verdict no longer counts as opening its grading item.
- **Lesson routing avoids repeated or skipped work.** A scene with several prerequisites evaluates each one on its own answer, an item answered correctly on a detour is not asked again when reached later, and an alternate item further down the lesson resumes after the scene just left rather than skipping intervening scenes. A due review can be proposed at the first pause even when the session opened on a question, and concepts not yet shown cannot be contested.

### Fixed

- **Retry feedback stays honest.** A same-scene retry no longer exposes the answer before the learner responds, notation reminders and recall items support prerequisite gates, and scientific-asset legends remain available on the affected viewers.
- **Panels fail safely.** A lost session offers to reopen instead of leaving stale controls; verdict chips name whose key assessed the answer; a conversation or forms surface no longer draws playable controls in the MCP Apps panel; and a concept map on an opening screen no longer reports that the lesson is finished.

## 0.2.0 — 2026-10-30

The first tagged release, from the production sprint: learning on your own from a conversation, durable study over days, honest feedback, a redesigned VS Code pane, teacher tools, a visual identity and a production pipeline.

### Added

- **Learn a topic from a conversation.** Three MCP tools, `get_authoring_guide`, `prepare_sources` and `create_lesson`, let an AI assistant turn sources the learner chose into a playable lesson without a shell. `prepare_sources` accepts up to 20 sources and 200 000 characters; every quote must match a source passage character for character (no-break spaces, whitespace runs and typographic apostrophes are folded). The draft is validated and linted before it is written, and the lesson is marked as agent-drafted and not teacher-validated.
- **Study over days.** MCP tools `list_lessons`, `get_study_plan`, `start_review_session` and `rate_recall`. The study plan lists due reviews, "To relearn" (graded and weak) and "Due for review" (self-rated only, never measured); a concept that no lesson can replay is listed but never proposed. The server declares connection instructions and two prompts, `learn` and `review`. The MCP server now has 34 tools.
- **Teacher tools.** MCP tools `review_lesson` and `class_report` (aggregated, with a floor of five learners that cannot be lowered from the tool). `tools/experience_packet.py approve` writes `approval.json`, bound to the SHA-256 of the exact `lesson.json`, and refuses a bundle with placeholders or lint errors. Teacher dashboard library and review pages; Observatory restyled.
- **VS Code.** Redesigned lesson pane: design tokens bridged to the editor theme, WCAG 2.2 AA (contrast, visible focus, live regions, labels, language), keyboard and screen-reader support, feedback as its own step, a completion screen with review actions, self-rating buttons. New command **Studium: Open this lesson** and a `vscode://` link to open a lesson, restore on reload, due reviews in the status bar, **Studium: Forget my data**, a confirmation before a reproduction runs code, and a time limit on landmark patterns.
- **Visual identity.** `design/` (tokens, VS Code bridge, components, preview), logo and hero under `docs/assets/`, four light and dark diagrams, screenshots.
- **Python tools.** `experience_packet.py` gains `approve`, structured `check` findings (`--json`) and self-study passages.
- **Production.** VSIX and standalone MCP server built and checked in CI; a release workflow that attaches both to a draft GitHub release when a `vX.Y.Z` tag matches the extension version, and publishes to the Visual Studio Marketplace, Open VSX and npm (`studium-mcp`) for each registry whose token is configured.
- **Licence.** Apache-2.0 for the code; CC BY 4.0 for the documentation, the visual identity and the lessons written by the project (`LICENSE`, `LICENSES/`, `NOTICE`). Lesson sources record their licence, and each source line shows it.
- **Documentation.** English and French sibling pages, a portal by role, contributing, code of conduct, security policy and citation files.

### Changed

- Learner state is durable by default under `~/.studium` (`STUDIUM_HOME`): lessons in `library/`, progress in `data/`. `STUDIUM_EPHEMERAL=1` keeps state in memory. In VS Code, state is kept in the extension's storage independently of the telemetry consent, which only governs sending.
- On-disk learner folders are HMAC pseudonyms keyed by `STUDIUM_PSEUDO_SECRET` or a per-install `<data dir>/.studium-secret` (mode 0600) created on a fresh data directory; an existing data directory keeps its earlier secret.
- A graded verdict carries its reference as data (`key_points`, `key_points_missing` when a judge measured coverage, `model_answer`, `reference_kind`). Cited passages and the reference are released only when the learner leaves the scene for good.
- Without a judge model, open answers are shown with the reference to compare, never with a keyword "X/Y covered" count. Self-rating (again, hard, good, easy) schedules reviews with FSRS and never moves mastery. The notice says who wrote the key (teacher, learner or agent) and whether a judge assessed.
- CI runs on Node 22 with a blocking audit of critical advisories. Dependencies upgraded (MCP SDK 1.32 or later, Next 14.2.35, Fastify 5).
- The planner answers 503 when no model is configured; the deterministic mock runs only with `STUDIUM_LLM_MODE=mock`.
- Surfaces and maturity declared: harnesses and the VS Code extension are supported; lesson-server, teacher dashboard and Observatory are maintained; the Tauri app is frozen and built on manual request only; `author-web` is legacy.

### Security

- No answer key before an answer on any host: the cited source passages of graded scenes are released after the answer, and `lesson-server` redacts answer keys.
- A reproduction command runs only after the learner confirms it, and the consent is tied to the exact bundle.

## 2026-10 — October line

### Added

- Self-study from your own references: `experience_packet.py passages` captures a URL, HTML page, PDF or text as passages; `bundle --self-study` builds an open-book lesson; an authoring block (`mode`, `author_is_learner`, `validated`, `judge`, `notice`) reaches every presentation; new lint rules for self-study lessons; the `studium-self-learner` skill and its tutorial (`7ad27cf`).
- `list_community_bundles` MCP tool (`7ad27cf`).
- Full Markdown in the lesson pane (GFM through a vendored marked and an allowlist sanitizer), KaTeX and mhchem in prose, code colouring (`62a9646`).
- `forget_session` separates erasure from `end_session`, which now closes and keeps progress; `get_next_reinforcement` accepts a session or a learner and returns due reviews in priority order; a lesson resumes at the first unfinished scene (`cac18ba`).
- `get_server_info` reports name, version, build origin, build time and git revision; a lesson picker and first-run choice in VS Code (`eb5b1e1`).
- French and English manifests for the extension's commands, views and settings (`77b3368`).

### Changed

- Public scenes no longer carry feedback or hints; transitions carry a `verdict` and a `navigation` record (kind, rule, reason, return target) (`eb5b1e1`).
- `tools/bundle_lint.mjs` rewritten without dependencies, with `--root` and graph rules (edge direction, cycles, locked first concept, unassessable prerequisite) (`eb5b1e1`).
- The engine announces a prerequisite gate once, gives feedback on non-quiz graded scenes, records confidence before and after quiz items, and resolves its French or English phrases from the lesson language (`3e701f8`).
- The September line was merged into the October line; the MCP surface became the union of both (25 lesson tools) (`ef33b4f`).

### Fixed

- Spaced-review reads use an injected clock instead of the wall clock; durable stores keep paired confidence checkpoints (`77b3368`).
- A reproduction scene cannot be acknowledged without a recorded run (`3e701f8`).

## 2026-09 — September line

### Added

- Local HTTP API exposing the operations shared with MCP, with local authentication, request identifiers for retries and refusal of answers aimed at a previous scene (`3dcf246`).
- Five interactive activity templates and standardised learner reports for ASTRA, ARA and MySTRA (`3223f70`, `7dee0cc`).
- Private experiment journal (prediction, observation, conclusion) preserved across harnesses (`0fbcc9c`).
- Reviewed plans bound to synthesis and MySTRA evidence; linked spectrum and candidate views (`5a5c58d`, `416971f`).
- Teacher and reviewer MySTRA viewer, literature drafts and harness-built viewers, grounded exploration records (`1a32942`, `0949131`, `bc438df`).
- Presentation language chosen and changed from the harness; optional scientific supports (Mermaid, KaTeX, SMILES structures, figures with provenance); sourced and generated media; shared contextual help (`afbd0e3`, `3c6ca1e`, `639e8d5`, `6351212`).
- A shared accessible visual system for viewers and adaptive visual support (`b772e00`, `d26cf6c`).
- Portable teacher and student onboarding skills and tutorials (`7f2d1f4`, `33bf561`); a harness-neutral `AGENTS.md` (`bb3036a`).
- Observatory Review and Sessions pages and its Harness tab (`8ff6046`, `4d3c82f`, `b36245a`).

### Changed

- Keyword scores no longer certify an answer; telemetry records which grader produced a critique score (`97cf72f`, `d9b1b1e`).
- Class-level surfaces apply one k-anonymity floor over learners and never narrow to a person chosen by the caller; every published number names its population (`a900b57`, `2815bca`, `e0f9bc2`).
- Toolchain pinned (pnpm 9.15.9, Python 3.12) and the tester onboarding path run in CI (`d8ba6e9`, `f37905d`).

### Fixed

- Remediation loops are bounded so a lesson always ends (`74f74e5`).
- The prerequisite gate says when it opens (`1470199`).
- An unmeasured calibration is absent from the adaptation context rather than counted as zero (`b6891d6`).

The dated September note, in French, is kept in [design records](docs/design-records/updates/2026-09-12.md).
