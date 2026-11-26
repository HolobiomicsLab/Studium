// vibe-connection.ts — the commands that connect Mistral Vibe (its CLI, its VS Code extension, Vibe Desktop) to this
// extension's own Studium server, without Node or a terminal (spec 2026-11-26-vibe-connect, approved for A and B).
// The pure parts are in vibe-config.ts. The entry is written only on the user's click; once written, it is kept
// current at each activation (a new Studium version moves dist/lesson-mcp.cjs), and removed by « Disconnect » or,
// best effort, when the extension is uninstalled (vibe-uninstall.ts).
import * as vscode from "vscode";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { openLinkPrefix, registeredServerEnv } from "./mcp-provider.js";
import {
  connectEntry, disconnectEntry, editorInstallRoot, entryIsCurrent, hasOurEntry, hasStudiumServer, otherStudiumServer,
  studiumEntryToml, vibeConfigPath, vibeHome, type VibeEntry,
} from "./vibe-config.js";

const EXTENSION_ID = "holobiomicslab.studium-vscode";
const OFFERED_KEY = "studium.vibeConnectionOffered";

export interface VibeConnectionDeps {
  /** The pane server's places: lessons folder, data folder, consent (shared with the Copilot server). */
  locations: () => { bundlesRoot: string; storageDir: string; telemetryConsent: boolean };
  learnerId: () => string;
  studiumHome: string;
  log: (line: string) => void;
}

const fr = (): boolean => vscode.env.language.toLowerCase().startsWith("fr");
const say = (en: string, french: string): string => (fr() ? french : en);

export function readIfPresent(path: string): string | undefined {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

/** Write an assistant's configuration, keeping the previous file as <name>.studium-backup, readable by its owner only
 *  (a state file such as ~/.claude.json may hold more than servers). */
export function writeConfig(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) { copyFileSync(path, `${path}.studium-backup`); chmodSync(`${path}.studium-backup`, 0o600); }
  writeFileSync(path, text, "utf8");
}

/** The server entry this extension writes (for Vibe and the assistants of assistant-connection.ts): VS Code's own executable run as Node on the server it carries, with the pane's
 *  places and learner, the pane link kept only under this editor (STUDIUM_OPEN_LINK_UNDER). Null when the server
 *  file is missing (a checkout that was never built). */
export function serverEntry(context: vscode.ExtensionContext, deps: VibeConnectionDeps): VibeEntry | null {
  const script = join(context.extensionPath, "dist", "lesson-mcp.cjs");
  if (!existsSync(script)) return null;
  const env = registeredServerEnv({
    launchEnv: { ELECTRON_RUN_AS_NODE: "1" }, ...deps.locations(), hostEnv: process.env, learnerId: deps.learnerId(),
    studiumHome: deps.studiumHome, openLink: openLinkPrefix(vscode.env.uriScheme, context.extension?.id ?? EXTENSION_ID),
  });
  return { command: process.execPath, args: [script], env: { ...env, STUDIUM_OPEN_LINK_UNDER: editorInstallRoot(process.execPath) } };
}

function entryBlock(context: vscode.ExtensionContext, deps: VibeConnectionDeps): string | null {
  const entry = serverEntry(context, deps);
  return entry ? studiumEntryToml(entry) : null;
}

/** « Studium: Connect Mistral Vibe ». */
export async function connectVibe(context: vscode.ExtensionContext, deps: VibeConnectionDeps): Promise<boolean> {
  if (vscode.env.remoteName) {
    void vscode.window.showWarningMessage(say(
      "Studium connects Mistral Vibe on this computer only; this window is remote. Open a local VS Code window and run the command again.",
      "Studium relie Mistral Vibe sur cet ordinateur seulement ; cette fenêtre est distante. Ouvrez une fenêtre VS Code locale et relancez la commande."));
    return false;
  }
  const block = entryBlock(context, deps);
  if (!block) {
    void vscode.window.showErrorMessage(say("The Studium server is missing from this extension (dist/lesson-mcp.cjs). Reinstall the extension.",
      "Le serveur Studium manque dans cette extension (dist/lesson-mcp.cjs). Réinstallez l'extension."));
    return false;
  }
  const path = vibeConfigPath(process.env, homedir());
  const text = readIfPresent(path);
  let result = connectEntry(text, block, { replaceHandWritten: false });
  if ("refused" in result && result.refused === "hand-written") {
    const replace = say("Replace", "Remplacer");
    const answer = await vscode.window.showWarningMessage(say(
      `Mistral Vibe already has a Studium server (${result.command}). Replace it with the one in this extension, which needs no Node?`,
      `Mistral Vibe a déjà un serveur Studium (${result.command}). Le remplacer par celui de cette extension, qui ne demande pas Node ?`),
      { modal: true }, replace);
    if (answer !== replace) return false;
    result = connectEntry(text, block, { replaceHandWritten: true });
  }
  if ("refused" in result) {
    void vscode.window.showErrorMessage(say(
      `Studium could not read Mistral Vibe's configuration (${path}) as TOML; nothing was changed. Fix or move that file, then run the command again.`,
      `Studium n'a pas pu lire la configuration de Mistral Vibe (${path}) comme du TOML ; rien n'a été modifié. Corrigez ou déplacez ce fichier, puis relancez la commande.`));
    return false;
  }
  try { writeConfig(path, result.text); } catch (e: any) {
    void vscode.window.showErrorMessage(say(`Studium could not write ${path}: ${e?.message ?? e}`, `Studium n'a pas pu écrire ${path} : ${e?.message ?? e}`));
    return false;
  }
  deps.log(`[studium] Mistral Vibe connected: ${path} (${result.replaced === "none" ? "entry added" : "entry replaced"}; backup alongside).`);
  const other = text ? otherStudiumServer(text) : null;
  // Measured 26 Nov 2026: the Vibe extension for VS Code reads its configuration when its engine starts, with the
  // window; a new conversation does not read it again. Reloading the window restarts it.
  const reload = say("Reload Window", "Recharger la fenêtre");
  void vscode.window.showInformationMessage(say(
    `Studium is connected to Mistral Vibe. Reload this window so that Vibe in VS Code sees it (restart Vibe Desktop too, if it is open).${other ? ` Vibe also has "${other}", which runs Studium: remove it to avoid two.` : ""}`,
    `Studium est relié à Mistral Vibe. Rechargez cette fenêtre pour que Vibe dans VS Code le voie (relancez aussi Vibe Desktop s'il est ouvert).${other ? ` Vibe a aussi « ${other} », qui lance Studium : supprimez-le pour ne pas en avoir deux.` : ""}`),
    reload).then((answer) => { if (answer === reload) void vscode.commands.executeCommand("workbench.action.reloadWindow"); });
  return true;
}

/** « Studium: Disconnect Mistral Vibe »: removes the entry this extension wrote, never a hand-written one. */
export function disconnectVibe(deps: VibeConnectionDeps): void {
  const path = vibeConfigPath(process.env, homedir());
  const text = readIfPresent(path);
  const next = text === undefined ? null : disconnectEntry(text);
  if (next === null) {
    void vscode.window.showInformationMessage(say("Mistral Vibe has no Studium server written by this extension.",
      "Mistral Vibe n'a pas de serveur Studium écrit par cette extension."));
    return;
  }
  writeConfig(path, next);
  deps.log(`[studium] Mistral Vibe disconnected: ${path}.`);
  void vscode.window.showInformationMessage(say("Studium is no longer connected to Mistral Vibe.", "Studium n'est plus relié à Mistral Vibe."));
}

/** At activation: keep the extension's entry current (silently), or offer the connection once when Vibe is installed
 *  and has no Studium server. Never throws. */
export function setUpVibeConnection(context: vscode.ExtensionContext, deps: VibeConnectionDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("studium.connectVibe", () => connectVibe(context, deps)),
    vscode.commands.registerCommand("studium.disconnectVibe", () => disconnectVibe(deps)),
  );
  if (vscode.env.remoteName) return;
  try {
    const path = vibeConfigPath(process.env, homedir());
    const text = readIfPresent(path);
    if (hasOurEntry(text)) {
      const block = entryBlock(context, deps);
      if (block && !entryIsCurrent(text!, block)) {
        const result = connectEntry(text, block, { replaceHandWritten: false });
        if ("text" in result) { writeConfig(path, result.text); deps.log(`[studium] Mistral Vibe's Studium entry updated: ${path}.`); }
      }
      return;
    }
    const offer = vscode.workspace.getConfiguration("studium").get<boolean>("offerVibeConnection", true) !== false;
    if (!offer || hasStudiumServer(text) || context.globalState.get<boolean>(OFFERED_KEY)) return;
    if (!existsSync(vibeHome(process.env, homedir()))) return;
    void context.globalState.update(OFFERED_KEY, true);
    const connect = say("Connect", "Relier");
    const never = say("Don't ask again", "Ne plus demander");
    void vscode.window.showInformationMessage(say(
      "Mistral Vibe is installed on this computer. Let Vibe use Studium's tools? Nothing to install; Studium writes one entry in Vibe's configuration.",
      "Mistral Vibe est installé sur cet ordinateur. Laisser Vibe utiliser les outils de Studium ? Rien à installer ; Studium écrit une entrée dans la configuration de Vibe."),
      connect, say("Not now", "Plus tard"), never).then((answer) => {
      if (answer === connect) void connectVibe(context, deps);
      else if (answer === never) void vscode.workspace.getConfiguration("studium").update("offerVibeConnection", false, vscode.ConfigurationTarget.Global);
    });
  } catch (e: any) {
    deps.log(`[studium] Mistral Vibe connection check skipped: ${e?.message ?? e}`);
  }
}
