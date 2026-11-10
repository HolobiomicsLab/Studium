English · [Français](panels.fr.md)

# Lesson panels for developers

This page is for contributors who check a panel host, run the local development server or add a host. It also records the resource policy of the panel files. Readers who only want to open a panel use [Lesson panels in your assistant](../start/harness-panels.md).

## Before you start

Build the server file that the probe and the development server start:

```bash
pnpm --filter @studium/lesson-mcp bundle
```

This builds the panel renderers (`@studium/lesson-panel-ui`) and writes `apps/lesson-mcp/dist/studium-mcp.cjs`. Both [`tools/panel-probe.mjs`](../../tools/panel-probe.mjs) and [`tools/panel-http-dev.mjs`](../../tools/panel-http-dev.mjs) start that exact path, not the server file of the VS Code build.

The two server files come from the same entry point, [`lesson-mcp-entry.ts`](../../apps/studium-vscode/src/lesson-mcp-entry.ts), and the same renderers, so they serve the same panels. For an assistant, use `apps/studium-vscode/dist/lesson-mcp.cjs`, as in [Connect your assistant](../start/harnesses.md). The `studium-mcp` binary of the `@studium/lesson-mcp` package is `apps/lesson-mcp/dist/studium-mcp.cjs`.

## How a host gets panels

The Codex stdio entry is `node /absolute/path/to/studium-mcp.cjs`. A host that supports MCP Apps announces `io.modelcontextprotocol/ui` during initialization. Only then does the server expose two `ui://` resources and annotate the three panel tools and `get_workflow_graph`. Without that announcement, the server offers the same 40 tools with no UI metadata and no resources.

## Check a host

Run the probe from the repository root, after the build above:

```bash
STUDIUM_EPHEMERAL=1 node tools/panel-probe.mjs
```

The probe starts the bundled server twice, once without and once with MCP Apps support. It checks that the server offers 40 tools, that 4 of them carry UI metadata and 2 resources exist when the client supports MCP Apps, and that neither exists otherwise. It checks that the view holds no answer key, that each HTML resource stays within 1.5 MB, and that the surface is `panel` for a client that negotiated MCP Apps and `text` otherwise. It then loads the embedded App in a DOM and completes the postMessage handshake and one action round trip.

Two options change the run:

- `--http=http://127.0.0.1:3001/mcp` tests the local HTTP server below instead of a started process.
- `--dom=/absolute/path/panel.html` saves the rendered DOM.

The probe is an automated contract host. It does not replace a trial in a real host. The external `ext-apps/examples/basic-host` needs its own dependencies and build before it can connect to the development server.

## Run the local development server

The remote-connector route for claude.ai and Claude Desktop is separate from the lesson HTTP API. Studium opens no public endpoint, tunnel or connector. To try the route on your machine only, build the bundle as above and run:

```bash
node tools/panel-http-dev.mjs
```

The server listens on `127.0.0.1:3001` at `/mcp`. Set `PANEL_HTTP_PORT` to change the port. For each connection it starts a memory-only bundled server and forwards MCP to it. It accepts only `localhost` and `127.0.0.1` hosts and origins, and has no production authentication or deployment contract. Stop it when you finish.

## Add a host

1. Write a bridge in [`apps/lesson-panel-ui/src`](../../apps/lesson-panel-ui/src/bridge-mcp-app.js) that calls `renderView` and passes the public `PanelAction`s to the server.
2. Keep disk access, grading and answer keys in the server.
3. Follow the host's language and theme, its pending and error states, and its link and size rules.
4. To preview a bridge, set `window.__studiumView` and send `studium:view` events to the standalone bridge.

## Resource policy

| Item | Rule |
|---|---|
| MCP resources | `text/html;profile=mcp-app`, `prefersBorder: true`, one CSP resource domain, `https://cdn.jsdelivr.net` |
| Inline libraries | marked, KaTeX JS and mhchem |
| CDN libraries | KaTeX CSS and fonts, Vega, Vega-Lite, Vega-Embed, 3Dmol, Cytoscape and dagre, loaded from installed-version URLs with SHA-384 integrity; fonts follow the pinned path of the checked KaTeX stylesheet |
| A CDN library is missing | A readable fallback replaces it |
| Remote images in a lesson | Blocked; images the server approves arrive as `data:` URIs |
| VS Code | Keeps its nonce-based CSP and its fully local vendor mode |
| Size | 1.5 MB for each HTML resource; the build fails above it |

Licences are listed in [`VENDOR-LICENSES.md`](../../apps/lesson-panel-ui/VENDOR-LICENSES.md). For the layers around the panels, see [Architecture](architecture.md).
