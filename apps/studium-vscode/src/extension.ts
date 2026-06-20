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

type Json = Record<string, any>;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("studium.openLesson", () => openLesson(context)),
  );
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
  const bundlesRoot = cfg<string>("bundlesRoot", "/tmp/studium_live");
  const bundleRef = cfg<string>("bundleRef", "11-bundle.zip");
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
  panel.onDidDispose(() => client.close().catch(() => {}));

  const call = async (name: string, args: Json): Promise<Json> => {
    const res: any = await client.callTool({ name, arguments: args });
    const data = JSON.parse(res.content?.[0]?.text ?? "{}");
    if (res.isError) throw new Error(`${name}: ${data.error}`);
    return data;
  };

  // Resolve a figure path on disk into a webview-safe data URI so <img> renders under the CSP.
  const inlineImage = (a: Json) => {
    if (!a.path || a.kind !== "image" && a.kind !== "executed_result") return a;
    try {
      const b64 = readFileSync(a.path).toString("base64");
      const ext = (a.path.split(".").pop() || "png").toLowerCase();
      return { ...a, dataUri: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${b64}` };
    } catch { return a; }
  };

  let sid = "";
  const pushScene = async (presentation: Json, explanation?: Json) => {
    const artifacts = (await call("get_scene_artifacts", { session_id: sid })).scene_assets || [];
    panel.webview.postMessage({
      type: "render",
      scene: presentation.scene,
      scene_assets: artifacts.map(inlineImage),
      progress: { index: (presentation.index ?? 0) + 1, total: presentation.total },
      mastery: presentation.learnerSnapshot?.conceptMastery ?? {},
      explanation: explanation ?? presentation.explanation ?? null,
    });
  };

  // 2) learner actions from the pane → MCP calls → next render (pair by pair)
  panel.webview.onDidReceiveMessage(async (msg: Json) => {
    try {
      if (msg.type === "hint") {
        const h = (await call("request_hint", { session_id: sid })).hint;
        panel.webview.postMessage({ type: "hint", hint: h?.hint ?? null, remaining: h?.remaining });
        return;
      }
      if (msg.type === "respond") {
        const t = (await call("submit_response", { session_id: sid, input: msg.input })).transition;
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
       "https://cdn.jsdelivr.net/npm/vega@5", "https://cdn.jsdelivr.net/npm/vega-lite@5", "https://cdn.jsdelivr.net/npm/vega-embed@6"]
    : [media("vendor/katex/katex.min.js"), media("vendor/vega.min.js"), media("vendor/vega-lite.min.js"), media("vendor/vega-embed.min.js")]
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
