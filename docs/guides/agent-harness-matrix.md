# Driving Studium from any AI harness

`lesson-mcp` is a standard MCP stdio server. Anything that speaks MCP can run a
lesson — the VS Code extension is one client among several, not a requirement.
The executable proof is `apps/lesson-mcp/scripts/headless_smoke.mjs` (run in CI):
a bare `@modelcontextprotocol/sdk` client starts a real lesson, submits a
response, and reads the render manifest with zero VS Code code.

## Server invocation (identical for every harness)

```
command: <repo>/node_modules/.bin/tsx        # or node <ext>/dist/lesson-mcp.cjs from a VSIX install
args:    ["src/index.ts"]
cwd:     <repo>/apps/lesson-mcp
env:     BUNDLES_ROOT=<repo>/fixtures        # + STUDIUM_TELEMETRY_CONSENT=granted STUDIUM_DATA_DIR=… if consented
```

Core tools: `start_lesson_session · get_current_scene · submit_response ·
get_scene_artifacts · request_hint · explain_last_adaptation · get_run_manifest ·
submit_run_result` (plus session/peer/community tools — `tools/list` is authoritative).

## Per-harness configuration

| Harness | Where | Shape |
|---|---|---|
| Claude Code | `.mcp.json` at the workspace root | `{"mcpServers": {"studium": {"command": "…/tsx", "args": ["src/index.ts"], "cwd": "…/apps/lesson-mcp", "env": {"BUNDLES_ROOT": "…/fixtures"}}}}` |
| Cursor | `.cursor/mcp.json` | same `mcpServers` shape |
| OpenCode | `opencode.json` → `mcp` | same command/args/env fields |
| Anything else | its MCP config | any MCP-capable harness works — the smoke script is the reference client |

## Two channels for the run protocol

Learner-time runs never execute inside Studium (pure agentic delegation): the
harness executes, Studium attests and ingests. Both channels are equivalent:

- **MCP**: `get_run_manifest` → harness runs the operation → `submit_run_result`.
- **File**: write `run_result.json` next to the bundle — used by harnesses with no
  MCP session at run time, and as the recovery path when a submit fails (the VS
  Code client persists the RunResult there on error).

## Notes

- The `@studium` chat participant is VS-Code-specific sugar; other harnesses get
  the same behaviour by calling the tools directly.
- A packaged VSIX ships the server as `dist/lesson-mcp.cjs`; point `command` at
  `node` with that file to reuse one install across harnesses.
