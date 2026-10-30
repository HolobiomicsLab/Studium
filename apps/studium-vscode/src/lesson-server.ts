// lesson-server.ts — how the @studium chat and the notebook start their lesson-mcp: the same launch, bundles
// root and learner storage as the lesson pane (extension.ts lessonServerEnv). Learner state always goes to
// VS Code's own storage (globalStorageUri), whatever the telemetry setting says (ENG-03), so a lesson studied
// in the chat or the notebook is the same durable learner as in the pane, and « Oublier mes données » erases it.
import * as vscode from "vscode";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { lessonMcpEnv, resolveServerLaunch, type ServerLaunch } from "./mcp-connect.js";
import { defaultBundlesRoot } from "./data-paths.js";

export interface LessonServerConfig {
  serverLaunch: ServerLaunch;
  env: Record<string, string>;
  bundlesRoot: string;
  bundleRef: string;
  learnerId: string;
}

/** Read the lesson-mcp launch from the studium.* settings (defaults run zero-config from the clone). */
export function lessonServerConfig(context: vscode.ExtensionContext): LessonServerConfig {
  const get = <T>(key: string, fallback: T): T => {
    const value = vscode.workspace.getConfiguration("studium").get<T>(key);
    return value === undefined || value === "" ? fallback : value;
  };
  const repoRoot = get<string>("repoRoot", resolve(context.extensionPath, "..", ".."));
  const bundlesRoot = get<string>("bundlesRoot", defaultBundlesRoot({ repoRoot, exists: existsSync, env: process.env, homedir: homedir() }));
  const storageDir = context.globalStorageUri.fsPath;
  try { mkdirSync(storageDir, { recursive: true }); } catch { /* the server reports an unwritable dir itself */ }
  return {
    serverLaunch: resolveServerLaunch(context.extensionPath, repoRoot),
    env: lessonMcpEnv({ baseEnv: process.env, bundlesRoot, storageDir, telemetryConsent: get<boolean>("telemetryConsent", false) }),
    bundlesRoot,
    bundleRef: get<string>("bundleRef", "atomistique-l1/lesson.json"),
    learnerId: get<string>("learnerId", "vscode-learner"),
  };
}
