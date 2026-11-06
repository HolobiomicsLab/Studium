English · [Français](harness-panels.fr.md)

# Lesson panels in AI harnesses

Studium separates the public lesson view from its host. The same HTML renderer supplies lesson
content, answer controls, feedback, review dates and completion in VS Code and MCP Apps. The
Claude Code mod presents the same public view with native components. These are implementation
routes; real Codex Desktop and Claude host trials remain deferred, not certified by unit tests.

| Host | Panel route | Current validation |
|---|---|---|
| VS Code Studium extension | Shared renderer with the VS Code bridge | Existing DOM and extension drivers |
| Codex Desktop with MCP Apps support | `ui://` resources over the existing stdio connection | Embedded SDK handshake and action probe; native trial deferred |
| Claude Code CLI, Code tab and extension | `apps/claude-code-mod` plugin | Mod contract tests; native trial deferred |
| claude.ai / Claude Desktop remote connector | MCP Apps over Streamable HTTP | Remote service and exposure require an owner decision |
| Text-only MCP client | Existing tools plus public panel tools | No UI metadata or accessible UI resources |

## Connect

The Codex stdio entry remains `node /absolute/path/to/studium-mcp.cjs`. Rebuild with
`pnpm --filter @studium/lesson-mcp bundle`, then use the resulting file at
`apps/lesson-mcp/dist/studium-mcp.cjs` in the existing connector configuration. Open a lesson through
`open_lesson_panel`. A supporting host advertises `io.modelcontextprotocol/ui` during initialization;
only then does the server expose two resources and annotate the three panel tools and
`get_workflow_graph`. The model should wait for the learner while an interactive panel is open.

The MCP pane includes course selection and an explicit erasure confirmation. Capsule reproduction
requires the VS Code terminal; the panel explains this when selected. The graph shows the learner's
current neighborhood, and selecting a node displays its label locally.

The Claude remote-connector route is separate from the existing lesson HTTP API. No public
endpoint, tunnel or connector is installed by this change. For local development only, build the
bundle and run `node tools/panel-http-dev.mjs`. It binds to `127.0.0.1:3001`, forwards MCP to a fresh
memory-only bundled server per connection, and permits only loopback hosts and origins. Stop it
when finished. It has no production authentication or deployment contract.

## Verify and extend

`STUDIUM_EPHEMERAL=1 node tools/panel-probe.mjs` checks 39 tools, the 2/4 UI resource/tool counts,
capability isolation, HTML sizes, answer-key redaction and the exact embedded App's postMessage
handshake and action round trip in a DOM. Optional `--http=http://127.0.0.1:3001/mcp` exercises the
local HTTP adapter; `--dom=/absolute/path/panel.html` saves the rendered DOM. This automated contract
host does not replace a native host trial. The external `ext-apps/examples/basic-host` requires
its own dependencies and build before connecting it to this development endpoint.

To add a host, implement a bridge under
[`apps/lesson-panel-ui/src`](../../apps/lesson-panel-ui/src/bridge-mcp-app.js) that calls `renderView`
and transports public `PanelAction`s. Keep disk access, grading and answer keys in the server.
Follow host locale/theme changes, pending/error state and link/size APIs. Use the standalone bridge
for previews by setting `window.__studiumView` and sending `studium:view` events.

## Resource policy

MCP resources use `text/html;profile=mcp-app`, `prefersBorder: true` and the single CSP resource
domain `https://cdn.jsdelivr.net`. marked, KaTeX JS and mhchem are inline; KaTeX CSS/fonts, Vega,
Vega-Lite, Vega-Embed, 3Dmol, Cytoscape and dagre use installed-version URLs and SHA-384 integrity.
Fonts inherit the checked KaTeX stylesheet's pinned path. Missing CDN libraries degrade to readable
fallbacks. Remote lesson images are blocked; server-approved images arrive as `data:` URIs.
VS Code retains nonce-based CSP and its fully local vendor mode. Each HTML resource is limited to
1.5 MB during the build. Licenses are listed in
[`VENDOR-LICENSES.md`](../../apps/lesson-panel-ui/VENDOR-LICENSES.md).
