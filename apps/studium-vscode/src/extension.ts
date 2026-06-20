// extension.ts — Studium in VS Code.
//
// The extension host is an MCP client to the lesson-mcp server (the same server VS Code Copilot
// would connect to). A WebviewPanel renders the ARTIFACT PANE (media/artifact-pane.*). The two
// move in lockstep, pair by pair: every time the learner advances, the extension pulls the next
// scene + get_scene_artifacts and posts them to the pane; the pane posts the learner's responses
// back, which the extension feeds to submit_response / request_hint.
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { toCytoscape, buildStylesheet, egoFilter, type GraphView } from "@studium/typed-graph-lens";
import { registerStudiumNotebook } from "./notebook.js";

type Json = Record<string, any>;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("studium.openLesson", () => openLesson(context)),
  );
  registerStudiumNotebook(context);
}
export function deactivate() {}

function cfg<T>(key: string, fallback: T): T {
  const v = vscode.workspace.getConfiguration("studium").get<T>(key);
  return v === undefined || v === "" ? fallback : v;
}

async function openLesson(context: vscode.ExtensionContext) {
  // The extension ships inside the monorepo (apps/studium-vscode); default repoRoot = ../../ .
  const repoRoot = cfg<string>("repoRoot", resolve(context.extensionPath, "..", ".."));
  const tsx = resolve(repoRoot, "node_modules/.pnpm/node_modules/.bin/tsx");
  const mcpDir = resolve(repoRoot, "apps/lesson-mcp");
  // Default to the repo's own fixtures/ + the atomistique bundle, so it runs zero-config from any
  // clone. Override studium.bundlesRoot / studium.bundleRef to point elsewhere.
  const bundlesRoot = cfg<string>("bundlesRoot", join(repoRoot, "fixtures"));
  const bundleRef = cfg<string>("bundleRef", "atomistique-l1/lesson.json");
  const learnerId = cfg<string>("learnerId", "vscode-learner");
  const consent = cfg<boolean>("telemetryConsent", false);

  const assets = cfg<"vendor" | "cdn">("assets", "vendor");
  const panel = vscode.window.createWebviewPanel(
    "studiumLesson", "Studium — Lesson", vscode.ViewColumn.Beside,
    { enableScripts: true, localResourceRoots: [vscode.Uri.file(join(context.extensionPath, "media"))], retainContextWhenHidden: true },
  );
  panel.webview.html = paneHtml(panel.webview, context.extensionPath, assets);

  // 1) connect to lesson-mcp over stdio
  const env: Record<string, string> = { ...process.env as any, BUNDLES_ROOT: bundlesRoot };
  if (consent) { env["STUDIUM_DATA_DIR"] = join(bundlesRoot, "data"); env["STUDIUM_TELEMETRY_CONSENT"] = "granted"; }
  const transport = new StdioClientTransport({ command: tsx, args: ["src/index.ts"], cwd: mcpDir, env, stderr: "ignore" });
  const client = new Client({ name: "studium-vscode", version: "0.1.0" });
  await client.connect(transport);
  // Track disposal so async callbacks (which may resume after the user closes the panel) never
  // postMessage to a dead webview.
  let panelDisposed = false;
  panel.onDidDispose(() => { panelDisposed = true; client.close().catch(() => {}); });

  const call = async (name: string, args: Json): Promise<Json> => {
    const res: any = await client.callTool({ name, arguments: args });
    const data = JSON.parse(res.content?.[0]?.text ?? "{}");
    if (res.isError) throw new Error(`${name}: ${data.error}`);
    return data;
  };

  let sid = "";

  // Companion live GRAPH panel (typed-graph-lens). The extension turns the GraphView from
  // get_workflow_graph into Cytoscape elements + a stylesheet (same package the host used to build
  // it) and posts them; graph-pane.js just lays out + renders. Repainted each turn, in lockstep.
  const showGraph = cfg<boolean>("showGraph", true);
  const graphMode = cfg<"student" | "teacher">("graphView", "student");
  let graphPanel: vscode.WebviewPanel | undefined;
  if (showGraph) {
    const gp = vscode.window.createWebviewPanel(
      "studiumGraph", "Studium — Graph", vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [vscode.Uri.file(join(context.extensionPath, "media"))], retainContextWhenHidden: true },
    );
    gp.webview.html = graphHtml(gp.webview, context.extensionPath, assets);
    gp.onDidDispose(() => { if (graphPanel === gp) graphPanel = undefined; });
    graphPanel = gp;
  }
  panel.onDidDispose(() => { try { graphPanel?.dispose(); } catch { /* already gone */ } });
  const pushGraph = async () => {
    if (!graphPanel || !sid) return;
    try {
      const g = (await call("get_workflow_graph", { session_id: sid })).graph as GraphView | null;
      if (!g || !graphPanel) return; // graphPanel may have been disposed during the await
      const view = graphMode === "student" ? egoFilter(g) : g;
      graphPanel.webview.postMessage({
        type: "graph", elements: toCytoscape(view), style: buildStylesheet(),
        title: g.title ?? "", legend: g.legend ?? [], focus: g.focus ?? null, mode: graphMode,
      });
    } catch { /* the graph is best-effort; never let it break the lesson */ }
  };

  // Resolve a figure path on disk into a webview-safe data URI so <img> renders under the CSP.
  // (Text artifacts — orbital .cube, spectrum, molecule — are inlined server-side by get_scene_artifacts.)
  const inlineImage = (a: Json) => {
    if (!a.path || a.kind !== "image" && a.kind !== "executed_result") return a;
    try {
      const b64 = readFileSync(a.path).toString("base64");
      const ext = (a.path.split(".").pop() || "png").toLowerCase();
      return { ...a, dataUri: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${b64}` };
    } catch { return a; }
  };

  const pushScene = async (presentation: Json, explanation?: Json) => {
    const artifacts = (await call("get_scene_artifacts", { session_id: sid })).scene_assets || [];
    if (panelDisposed) return;
    panel.webview.postMessage({
      type: "render",
      scene: presentation.scene,
      scene_assets: artifacts.map(inlineImage),
      progress: { index: (presentation.index ?? 0) + 1, total: presentation.total },
      mastery: presentation.learnerSnapshot?.conceptMastery ?? {},
      explanation: explanation ?? presentation.explanation ?? null,
    });
    await pushGraph();
  };

  // 2) learner actions from the pane → MCP calls → next render (pair by pair)
  panel.webview.onDidReceiveMessage(async (msg: Json) => {
    try {
      if (msg.type === "hint") {
        const h = (await call("request_hint", { session_id: sid })).hint;
        if (!panelDisposed) panel.webview.postMessage({ type: "hint", hint: h?.hint ?? null, remaining: h?.remaining });
        return;
      }
      if (msg.type === "respond") {
        const t = (await call("submit_response", { session_id: sid, input: msg.input })).transition;
        if (panelDisposed) return;
        if (t.kind === "complete") {
          panel.webview.postMessage({ type: "done", message: `Lesson complete — ${t.summary.scenesCompleted} scenes, autonomy ${t.summary.autonomyRatio.toFixed(2)}` });
          return;
        }
        await pushScene(t.presentation, t.kind === "replay" || t.kind === "remediate_alt"
          ? { rule_id: t.kind, explanation_short: t.reason } : undefined);
      }
    } catch (e: any) { vscode.window.showErrorMessage(`Studium: ${e.message}`); }
  });

  // 3) start
  try {
    const started = await call("start_lesson_session", { bundle_ref: bundleRef, learner_id: learnerId });
    sid = started.session_id;
    await pushScene(started.presentation);
    vscode.window.showInformationMessage(`Studium: lesson started (${bundleRef}).`);
  } catch (e: any) {
    vscode.window.showErrorMessage(`Studium: could not start lesson — ${e.message}`);
  }
}

function nonce() { return Array.from({ length: 16 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join(""); }

function paneHtml(webview: vscode.Webview, extPath: string, assets: "vendor" | "cdn"): string {
  const media = (f: string) => webview.asWebviewUri(vscode.Uri.file(join(extPath, "media", f)));
  const n = nonce();
  // KaTeX + Vega(-Lite/-Embed) make equations + plots rich; if neither loads, the renderer
  // degrades to styled code + an inline-SVG bar chart (same code path). `vendor` ships the libs
  // inside media/vendor (air-gap safe); `cdn` pulls them from jsdelivr.
  const cdn = assets === "cdn";
  const origin = cdn ? "https://cdn.jsdelivr.net" : "";
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} ${origin} 'unsafe-inline'`,
    `font-src ${webview.cspSource} ${origin}`,
    `script-src 'nonce-${n}' ${origin}`,
  ].join("; ");
  const katexCss = cdn ? "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" : media("vendor/katex/katex.min.css");
  const libs = (cdn
    ? ["https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
       "https://cdn.jsdelivr.net/npm/vega@5", "https://cdn.jsdelivr.net/npm/vega-lite@5", "https://cdn.jsdelivr.net/npm/vega-embed@6",
       "https://cdn.jsdelivr.net/npm/3dmol@2.5.5/build/3Dmol-min.js"]
    : [media("vendor/katex/katex.min.js"), media("vendor/vega.min.js"), media("vendor/vega-lite.min.js"), media("vendor/vega-embed.min.js"),
       media("vendor/3Dmol-min.js")]
  ).map((src) => `<script defer nonce="${n}" src="${src}"></script>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${media("artifact-pane.css")}">
<link rel="stylesheet" href="${katexCss}">
${libs}
</head><body><div id="pane"></div>
<script nonce="${n}" src="${media("artifact-pane.js")}"></script>
</body></html>`;
}

// The companion GRAPH webview: Cytoscape + dagre (+ the cytoscape-dagre adapter). The elements and
// stylesheet are computed host-side from the GraphView; graph-pane.js only lays out + renders.
function graphHtml(webview: vscode.Webview, extPath: string, assets: "vendor" | "cdn"): string {
  const media = (f: string) => webview.asWebviewUri(vscode.Uri.file(join(extPath, "media", f)));
  const n = nonce();
  const cdn = assets === "cdn";
  const origin = cdn ? "https://cdn.jsdelivr.net" : "";
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${n}' ${origin}`,
  ].join("; ");
  const libs = (cdn
    ? ["https://cdn.jsdelivr.net/npm/cytoscape@3.34.0/dist/cytoscape.min.js",
       "https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js",
       "https://cdn.jsdelivr.net/npm/cytoscape-dagre@4.0.0/dist/cytoscape-dagre.js"]
    : [media("vendor/cytoscape.min.js"), media("vendor/dagre.min.js"), media("vendor/cytoscape-dagre.js")]
  ).map((src) => `<script defer nonce="${n}" src="${src}"></script>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${media("graph-pane.css")}">
${libs}
</head><body><div id="graph"></div><div id="legend"></div>
<script nonce="${n}" src="${media("graph-pane.js")}"></script>
</body></html>`;
}
