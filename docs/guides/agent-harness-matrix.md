# Driving Studium from an AI harness

`lesson-mcp` is a standard MCP stdio server. The VS Code extension is one client;
other clients use the same tools with their own configuration and authentication.

The maintained user recipes are now:

- [Installation](../getting-started/installation.md).
- [VS Code / Copilot Student and teacher setup](../getting-started/copilot.md).
- [Claude Code, Codex, Cursor, OpenCode v2 and backend API](../getting-started/harnesses-and-api.md).
- [First lesson](../tutorials/first-lesson.md) and [agentic experiments](../tutorials/agentic-experiment.md).

After building the extension, the portable server launch is `node` with the
absolute path to `apps/studium-vscode/dist/lesson-mcp.cjs`, plus an absolute
`BUNDLES_ROOT` environment value. This avoids a global `tsx` dependency. Config
formats differ across clients; use the linked examples rather than copying a
Claude-shaped object into every application.

`tools/list` is authoritative. Learner-time science follows `get_run_manifest`
→ actual harness execution → `submit_run_result`. The
[Studium harness skill](../../skills/studium-harness/SKILL.md) defines the exact
contracts, the `.studium-session` file channel and recovery procedures.
Do not confuse an exploration receipt with a run result or a learner response.

`list_community_bundles({course_id?})` returns `{bundles: [{bundle_ref, course_id, item_id}]}`
for the community bundles emitted under `<BUNDLES_ROOT>/<course_id>/community/`; each
`bundle_ref` is passed unchanged to `start_lesson_session`. `start_lesson_session`,
`get_operator_context` (and `task.md`) and `presentation` carry an
`authoring: {mode, author_is_learner, validated, judge, notice}` block: relay a
non-null `notice` to the learner. `judge` is false without a judge model
(`LITELLM_BASE_URL` empty); production scenes then give keyword feedback with no
certified assessment and move no mastery. Self-study lessons are covered by the
[self-learner skill](../../skills/studium-self-learner/SKILL.md).

The independent client proof is `node apps/lesson-mcp/scripts/headless_smoke.mjs`.
Passing it verifies the server, not every provider's authenticated UI. A pane and
an independently configured MCP client do not share live session IDs.
