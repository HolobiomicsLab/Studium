// mcp-registration.ts — INT-STUDIUM-064: offer the extension's own lesson server to the editor's chat (Copilot in
// agent mode), so that building a lesson in VS Code needs no Node install and no terminal command. The server is
// the one the lesson pane starts (dist/lesson-mcp.cjs run by the editor's own runtime, ELECTRON_RUN_AS_NODE), with
// the pane's lessons folder and data folder. The pure parts are in mcp-provider.ts.
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import { describeServerLaunch, resolveServerLaunch, type LogSink } from "./mcp-connect.js";
import {
  MCP_PROVIDER_ID, MCP_SERVER_LABEL, findHandAddedStudium, mcpConfigFiles, mcpServerApi, registeredServerEnv,
} from "./mcp-provider.js";

export interface McpRegistrationDeps {
  /** Where the pane's server keeps things: the lessons folder, the data folder (created), the consent setting. */
  locations: () => { bundlesRoot: string; storageDir: string; telemetryConsent: boolean };
  /** The studium.repoRoot setting, or its default: a checkout there runs the server from its sources. */
  repoRoot: () => string;
  /** The studium.registerMcpServer setting. */
  enabled: () => boolean;
  log: LogSink;
}

function readIfPresent(path: string): string | undefined {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

/**
 * Register the provider. Returns false, after one line in the output channel, when the editor has no usable API
 * (VS Code before 1.101, a fork) or refuses the registration; activation goes on either way. The provider offers
 * no server when the setting is off, or when a Studium server is already configured by hand (the editor would
 * otherwise list two, each with all of Studium's tools); it says why in the output channel.
 */
export function registerStudiumMcpServer(context: vscode.ExtensionContext, deps: McpRegistrationDeps): boolean {
  const api = mcpServerApi(vscode);
  if (!api) {
    deps.log("[studium] this editor has no MCP server API (VS Code 1.101 or later): Copilot does not get the built-in " +
      "Studium server; add it by hand as docs/start/copilot.md says.");
    return false;
  }
  const globalStorageDir = context.globalStorageUri?.fsPath;
  const configFiles = (): string[] => mcpConfigFiles({
    globalStorageDir,
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    env: process.env, homedir: homedir(),
  });
  let lastNote = "";
  const note = (line: string) => { if (line !== lastNote) { lastNote = line; deps.log(line); } };
  const changed = new vscode.EventEmitter<void>();

  const provider = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: () => {
      if (!deps.enabled()) {
        note("[studium] studium.registerMcpServer is off: Copilot does not get the built-in Studium server.");
        return [];
      }
      const files = configFiles().map((path) => ({ path, text: readIfPresent(path) }));
      const handAdded = findHandAddedStudium(files, vscode.workspace.getConfiguration("mcp").get<unknown>("servers"));
      if (handAdded) {
        note(`[studium] a Studium server is already configured ("${handAdded.name}" in ${handAdded.where}): the extension ` +
          "does not add a second one. Remove that entry to use the built-in server instead.");
        return [];
      }
      let launch;
      try {
        launch = resolveServerLaunch(context.extensionPath, deps.repoRoot());
      } catch (e: any) {
        note(`[studium] the built-in Studium server cannot be offered to Copilot: ${e?.message ?? e}`);
        return [];
      }
      const where = deps.locations();
      const env = registeredServerEnv({ launchEnv: launch.env, ...where, hostEnv: process.env });
      const version: string | undefined = context.extension?.packageJSON?.version;
      const definition = new api.Definition(MCP_SERVER_LABEL, launch.command, launch.args, env, version);
      definition.cwd = vscode.Uri.file(launch.cwd);
      note(`[studium] Copilot gets the built-in Studium server: ${describeServerLaunch(launch)}, lessons ${where.bundlesRoot}, ` +
        `progress ${where.storageDir}, judge ${env["LITELLM_BASE_URL"] ? "configured" : "none"}.`);
      return [definition];
    },
  };

  try {
    context.subscriptions.push(api.register(MCP_PROVIDER_ID, provider));
  } catch (e: any) {
    changed.dispose();
    deps.log(`[studium] the editor refused the built-in Studium server for Copilot: ${e?.message ?? e}`);
    return false;
  }
  // Re-offer when what the definition depends on changes: a Studium setting (the lessons folder, the switch),
  // the older mcp.servers setting, the workspace folders, or a file where a server may be added by hand.
  const refresh = () => changed.fire();
  const watchers = configFiles().map((path) =>
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dirname(path)), basename(path))));
  for (const watcher of watchers) {
    context.subscriptions.push(watcher, watcher.onDidCreate(refresh), watcher.onDidChange(refresh), watcher.onDidDelete(refresh));
  }
  context.subscriptions.push(
    changed,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("studium") || e.affectsConfiguration("mcp")) refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
  );
  return true;
}
