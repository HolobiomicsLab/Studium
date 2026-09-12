# Driving Studium from an AI harness

Studium offers a [local HTTP API](api-and-harness.md), a standard MCP stdio server and a file channel. The VS Code extension is one client;
other clients use the same tools with their own configuration and authentication.

The maintained user recipes are now:

- [Installation](../getting-started/installation.md).
- [VS Code / Copilot Student and teacher setup](../getting-started/copilot.md).
- [Claude Code, Codex, Cursor, OpenCode v2 and backend API](../getting-started/harnesses-and-api.md).
- [First lesson](../tutorials/first-lesson.md) and [agentic experiments](../tutorials/agentic-experiment.md).
- [Practical use cases](../tutorials/use-cases.md), [capability map](../features.md)
  and [10–12 September development update](../updates/2026-09-12.md).

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

The independent client proof is `node apps/lesson-mcp/scripts/headless_smoke.mjs`.
Passing it verifies the server, not every provider's authenticated UI. A pane and
an independently configured MCP client do not share live session IDs.

HTTP clients share a live session only while connected to the same server. Discovery at `/v1/operations` supplies the common operation schemas. The API guide covers retry IDs, stale scenes, exports and explicit forgetting.
