# Changelog

All notable changes to Studium are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). A release takes the version of `apps/studium-vscode/package.json`. The sections below 0.2.0 are development lines, grouped by month, from before the first tagged release.

## Unreleased

### Fixed

- **A chat reply is read more carefully.** At a verdict deck, « aucune idée », « rien compris » or « none of them look right » no longer count as « no claim is wrong »; « none flagged » is accepted only when the whole reply says so, and a list of numbers only when it is plainly that list, so a doubt (« pas sûr »), an exception or a reason with other numbers is refused in one line instead of being graded. An empty written answer is refused instead of recording an answer, revealing the key and passing the gate. A confidence sent with `reply` is kept. « Après 3, avant 1 » is read by its labels, not the order of the digits. A quiz accepts « la b je crois », « plutôt b », « d'après moi a » or the text of one choice; « je ne sais pas » points to `request_hint` instead of asking for a letter, and a question or « attends » on a reading screen no longer counts as « continue ».
- **The Claude Code pane no longer shows a verdict twice, and says what the HTML panel says.** It draws the structured feedback and reference (labelled by `reference_kind`, so « The right answer » is no longer « Key points ») or `display_markdown`, never both; it gives the reason for a detour or a replay in one line over the scene; and it shows the reviews due, the next review date and the calibration mirror that the view carried but the pane dropped.
- **The concept-map page can be built again.** `tools/concept_map_report.py export` refused every record written by the 0.3.0 server, because the record had gained the `evidence` and `contest` fields after the reader was written. The reader now validates both, including that each evidence entry names a step of the path and each contest a concept of the map. A record written by the server is kept as a test fixture, and a server-side test fails when the record's shape drifts from it.
- **A duplicate or late answer no longer answers the next scene.** `submit_response` and the panel's `respond` action take `expected_scene_id`; when another scene is on screen the answer is refused in one line and changes nothing. A typed answer sent to a reading scene (intro, concept) is refused instead of skipping it; `ack` and the learner's words still move it on.
- **Starting a lesson the learner already has open returns that session.** A second `start_lesson_session` (or `open_lesson_panel`) for the same learner and lesson in one server returns the open session where it was, with `resume.kind: "already_open"` and a line saying so, instead of a second session that saved over the first.
- **A restart during a prerequisite detour resumes on the remediation.** The detour under way is saved with the lesson state, so a learner who failed a gate comes back to the remediation question, not past the gate. A state saved by an earlier version resumes as before.
- **The end of a contest is said in the conversation.** The answer that settles a contest opens its text with the outcome and how many check answers were right; during the check questions the status line counts the minutes left from where the lesson resumes.
- **`forget_session` answers in the learner's language.** It takes an optional `language` and otherwise uses the learner's last lesson language, then the server default, so « nothing to erase » is no longer said in English to a French-speaking learner.
- **A pane granted to a client that shows none says how to go on**, and a prompt's outcome is taken in either spelling (`accept`/`accepted`, `dismiss`/`dismissed`) by `submit_response` and `panel_action`.
- **The usage report reads the streams the server writes.** `tools/interaction_report.py` refuses a stream without a `consent_granted` event, and no server code wrote one, so the report was always suppressed. The server now opens each new consented stream with one `consent_granted` event (scope B, pedagogical telemetry for the teacher), which records that the operator declared consent through `STUDIUM_TELEMETRY_CONSENT`, not that the learner clicked anything. A resumed learner's stream does not receive a second one; a stream written before this version receives none and stays refused. Five synthetic learners' streams written by the server are kept as a test fixture, and a server-side test fails when the streams' shape drifts from it. The report's `reason` names the data folder by its name and a fingerprint, not its path.
- **Telemetry of a session that is never closed is kept.** Under consent, each telemetry event is appended to the learner's stream when it is emitted, rather than at the end of the lesson, `end_session` or forget. A learner who closes the assistant mid-lesson now leaves a stream, so completion counts them as started, and a resumed learner keeps the events of the first part. Lesson-end and `end_session` writes add no duplicate lines. Completion, in `class_report` and `tools/class_report.py` alike, now counts distinct learners who completed over distinct learners who started, so a learner who resumed (and wrote `lesson_started` twice) counts once.
- **Teacher Python tools read what the server and their siblings write.** The public-context check of `experience_templates.py`, `experience_exploration.py` and `demo-grounded-exploration.py` accepts the `notation`, `authoring` and `exploration.journal` fields `get_operator_context` returns (checked against saved server replies), so the documented activity routes run again. `concept_map_report.py` reads the JSON `class_report.py` writes as well as the MCP tool's, says on the page whether a lesson is approved for this exact version, changed since its approval, or without a record, and shows the number of graded answers beside a success rate computed over them. The analytics collector starts from a checkout in the environment `requirements.txt` builds. `class_report.py` says on stderr when its rows are named by scene id, and `media_workflow.py prepare` says the request already exists.
- **An AI critique shows what to critique.** The learner side of an `ai_critique` scene carried no text at all: the claims were removed with the answer key. The scene now publishes each claim's position ("1", "2"…) and `text` as `claims_to_critique`, never its expected flaws, and the conversation, the panel, the file channel's `task.md` and the `review_lesson` preview and plan all show it.
- **`prepare_sources` refuses an HTML page.** A source that starts with `<!DOCTYPE html` or `<html`, or in which at least five tags make up a fifth of the characters, was cut into passages of markup and JavaScript. It is now refused in one line asking for the text of the page; a text with a few inline tags or with LaTeX angle brackets is still accepted.
- **A scene that reaches no concept is warned about.** `node tools/bundle_lint.mjs` (and so `review_lesson`) reports `scene_reaches_no_concept` for each scene that takes a graded answer (quiz, spot_the_flaw, ai_critique, explain_back, comparison, summary_audit, prompt_practice, communication_sim) without `concept_refs`, in the words of `experience_packet.py check`. It stays a warning.
- **The literature tutorial's example measures something.** `examples/literature-experience/author-response.json` gave three scenes no concept and one legacy `simulation` scene. Each scene now has `concept_refs`, and the matching scene is a `comparison`.
- **A question whose answer the learner was shown is not asked again as a graded question.** The lesson state records each scene whose reference a verdict released (`reference_shown`, kept across a restart; a state without it loads empty). A prerequisite gate takes another item of the concept, or opens as `gate_unassessable` when none is left, instead of asking from memory; a contest leaves those scenes out of its check questions and, with none left, the concept cannot be contested. Reviews on a later day are not affected. `bundle_lint` warns `concept_not_recheckable` for a gate or contest target with a single key-graded scene.
- **The orientation says what the screen asks.** `waiting` is `self_rating` only on the screen that served the request (a held-back or left-behind request is no longer announced, after a restart neither, and can still be rated), so the help ladder no longer opens the explanation and the reference over a quiz not answered. During a prerequisite detour the minutes left count from the scene the lesson returns to, and the view's `progress.detour` names that main-path step. `help.explains` says whether the explanation is of the last answer or of the screen.
- **Forms name their options** (`enumNames`: a quiz choice's text, a concept's title, the claim in words; the values sent are unchanged), and the panel view carries `content_language`, the lesson's own language.

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
