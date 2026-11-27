// assistant-connection.ts — « Studium: Connect an Assistant… » and « Studium: Disconnect an Assistant… »: let the
// assistants that read a local MCP configuration file use this extension's own Studium server, with no Node and no
// terminal (spec 2026-11-27-connect-assistants-design). Codex, Claude Code, Claude Desktop, Cursor and OpenCode are edited
// through assistant-config.ts; Mistral Vibe keeps its own path (vibe-connection.ts) and is offered in the same list.
// An entry is written only on the user's pick; once written, it is kept current at each activation (a new Studium
// version moves dist/lesson-mcp.cjs) and removed by « Disconnect » or, best effort, at uninstall (vibe-uninstall.ts).
import * as vscode from "vscode";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import {
  ASSISTANT_IDS, assistantConfigPath, assistantEntryIsCurrent, connectAssistant, disconnectAssistant, studiumState,
  type AssistantId,
} from "./assistant-config.js";
import { hasOurEntry, vibeConfigPath, vibeHome } from "./vibe-config.js";
import { connectVibe, disconnectVibe, readIfPresent, serverEntry, writeConfig, type VibeConnectionDeps } from "./vibe-connection.js";

type Choice = AssistantId | "vibe";
const fr = (): boolean => vscode.env.language.toLowerCase().startsWith("fr");
const say = (en: string, french: string): string => (fr() ? french : en);

const NAMES: Record<Choice, { en: string; fr: string; where: { en: string; fr: string } }> = {
  "vibe": { en: "Mistral Vibe", fr: "Mistral Vibe", where: { en: "its VS Code extension, Vibe Desktop, its CLI", fr: "son extension VS Code, Vibe Desktop, sa ligne de commande" } },
  "codex": { en: "Codex", fr: "Codex", where: { en: "its VS Code extension, its CLI", fr: "son extension VS Code, sa ligne de commande" } },
  "claude-code": { en: "Claude Code", fr: "Claude Code", where: { en: "its VS Code extension, its CLI", fr: "son extension VS Code, sa ligne de commande" } },
  "claude-desktop": { en: "Claude Desktop", fr: "Claude Desktop", where: { en: "the desktop app", fr: "l'application de bureau" } },
  "cursor": { en: "Cursor", fr: "Cursor", where: { en: "its MCP servers for every project", fr: "ses serveurs MCP pour tous les projets" } },
  "opencode": { en: "OpenCode", fr: "OpenCode", where: { en: "its desktop app, its web UI, its terminal UI", fr: "son application de bureau, son interface web, son interface terminal" } },
};
/** VS Code extensions that run the assistant inside the editor, which a window reload restarts. */
const IN_EDITOR: Partial<Record<Choice, string>> = { "vibe": "mistralai.mistral-vibe-code", "codex": "openai.chatgpt", "claude-code": "anthropic.claude-code" };
const name = (id: Choice): string => (fr() ? NAMES[id].fr : NAMES[id].en);

const pathOf = (id: AssistantId): string | null =>
  assistantConfigPath(id, { env: process.env, homedir: homedir(), platform: process.platform, exists: existsSync });

/** Whether the assistant seems installed: its configuration file or folder exists, or its VS Code extension. */
function installed(id: Choice): boolean {
  if (IN_EDITOR[id] && vscode.extensions.getExtension(IN_EDITOR[id]!)) return true;
  if (id === "vibe") return existsSync(vibeHome(process.env, homedir()));
  const path = pathOf(id);
  return !!path && (existsSync(path) || (id !== "claude-code" && existsSync(dirname(path))));
}
function connected(id: Choice): boolean {
  if (id === "vibe") return hasOurEntry(readIfPresent(vibeConfigPath(process.env, homedir())));
  const path = pathOf(id);
  return !!path && !!studiumState(id, readIfPresent(path))?.ours;
}
const available = (): Choice[] => (["vibe", ...ASSISTANT_IDS] as Choice[]).filter((id) => id === "vibe" || pathOf(id as AssistantId) !== null);

/** Connect one assistant other than Vibe; false when the user declined or the file could not be edited. */
async function connectOne(id: AssistantId, context: vscode.ExtensionContext, deps: VibeConnectionDeps): Promise<boolean> {
  const entry = serverEntry(context, deps);
  const path = pathOf(id);
  if (!entry || !path) return false;
  const text = readIfPresent(path);
  let result = connectAssistant(id, text, entry, { replaceHandWritten: false });
  if ("refused" in result && result.refused === "hand-written") {
    const replace = say("Replace", "Remplacer");
    const answer = await vscode.window.showWarningMessage(say(
      `${name(id)} already has a Studium server (${result.command}). Replace it with the one in this extension, which needs no Node?`,
      `${name(id)} a déjà un serveur Studium (${result.command}). Le remplacer par celui de cette extension, qui ne demande pas Node ?`),
      { modal: true }, replace);
    if (answer !== replace) return false;
    result = connectAssistant(id, text, entry, { replaceHandWritten: true });
  }
  if ("refused" in result) {
    void vscode.window.showErrorMessage(say(
      `Studium could not read ${name(id)}'s configuration (${path}); nothing was changed. Fix or move that file, then try again.`,
      `Studium n'a pas pu lire la configuration de ${name(id)} (${path}) ; rien n'a été modifié. Corrigez ou déplacez ce fichier, puis réessayez.`));
    return false;
  }
  try { writeConfig(path, result.text); } catch (e: any) {
    void vscode.window.showErrorMessage(say(`Studium could not write ${path}: ${e?.message ?? e}`, `Studium n'a pas pu écrire ${path} : ${e?.message ?? e}`));
    return false;
  }
  deps.log(`[studium] ${NAMES[id].en} connected: ${path} (${result.replaced === "none" ? "entry added" : "entry replaced"}; backup alongside).`);
  if (id === "claude-code") void keepAfterRewrite(id, path, context, deps);
  return true;
}

/** Claude Code rewrites ~/.claude.json while it runs; a copy it held before our write could drop the entry. Check
 *  once a little later, and write it again if it is gone. */
async function keepAfterRewrite(id: AssistantId, path: string, context: vscode.ExtensionContext, deps: VibeConnectionDeps): Promise<void> {
  await new Promise((done) => setTimeout(done, 3000));
  const entry = serverEntry(context, deps);
  const text = readIfPresent(path);
  if (!entry || studiumState(id, text)?.present) return;
  const again = connectAssistant(id, text, entry, { replaceHandWritten: false });
  if ("text" in again) { writeConfig(path, again.text); deps.log(`[studium] ${NAMES[id].en}'s entry written again: ${path}.`); }
}

function restartAdvice(ids: Choice[]): string {
  const inEditor = ids.filter((id) => IN_EDITOR[id]).map(name);
  const outside = ids.filter((id) => id === "claude-desktop" || id === "cursor" || id === "opencode").map(name);
  const parts: string[] = [];
  if (inEditor.length) parts.push(say(`Reload this window for ${inEditor.join(", ")} in VS Code`, `Rechargez cette fenêtre pour ${inEditor.join(", ")} dans VS Code`));
  if (outside.length) parts.push(say(`quit and reopen ${outside.join(", ")} if open`, `quittez et rouvrez ${outside.join(", ")} s'il est ouvert`));
  return parts.length ? `${parts.join(say("; ", " ; "))}.` : "";
}

/** « Studium: Connect an Assistant… »: pick one or several; `only` skips the list. */
export async function connectAssistants(context: vscode.ExtensionContext, deps: VibeConnectionDeps, only?: Choice[]): Promise<Choice[]> {
  if (vscode.env.remoteName) {
    void vscode.window.showWarningMessage(say(
      "Studium connects assistants on this computer only; this window is remote. Open a local VS Code window and run the command again.",
      "Studium relie les assistants sur cet ordinateur seulement ; cette fenêtre est distante. Ouvrez une fenêtre VS Code locale et relancez la commande."));
    return [];
  }
  let picked = only;
  if (!picked) {
    const items = available().map((id) => ({
      id, label: name(id), picked: false,
      description: connected(id) ? say("connected", "relié") : installed(id) ? "" : say("not found on this computer", "pas trouvé sur cet ordinateur"),
      detail: fr() ? NAMES[id].where.fr : NAMES[id].where.en,
    })).sort((a, b) => Number(installed(b.id)) - Number(installed(a.id)));
    const chosen = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: say("Connect an assistant to Studium", "Relier un assistant à Studium"),
      placeHolder: say("The assistants to give Studium's tools, with no Node (Copilot has them already)",
        "Les assistants à qui donner les outils de Studium, sans Node (Copilot les a déjà)"),
    });
    picked = (chosen ?? []).map((item) => item.id);
  }
  const done: Choice[] = [];
  for (const id of picked) {
    if (id === "vibe") { if (await connectVibe(context, deps)) done.push(id); continue; }
    if (await connectOne(id, context, deps)) done.push(id);
  }
  const others = done.filter((id) => id !== "vibe");
  if (others.length) {
    const reload = say("Reload Window", "Recharger la fenêtre");
    const buttons = others.some((id) => IN_EDITOR[id]) ? [reload] : [];
    void vscode.window.showInformationMessage(say(
      `Studium is connected to ${others.map(name).join(", ")}. ${restartAdvice(others)}`,
      `Studium est relié à ${others.map(name).join(", ")}. ${restartAdvice(others)}`), ...buttons)
      .then((answer) => { if (answer === reload) void vscode.commands.executeCommand("workbench.action.reloadWindow"); });
  }
  return done;
}

/** « Studium: Disconnect an Assistant… »: lists the assistants holding an entry this extension wrote. */
export async function disconnectAssistants(deps: VibeConnectionDeps): Promise<void> {
  const ours = available().filter(connected);
  if (!ours.length) {
    void vscode.window.showInformationMessage(say("No assistant has a Studium server written by this extension.",
      "Aucun assistant n'a de serveur Studium écrit par cette extension."));
    return;
  }
  const chosen = await vscode.window.showQuickPick(ours.map((id) => ({ id, label: name(id) })), {
    canPickMany: true, title: say("Disconnect assistants from Studium", "Délier des assistants de Studium"),
  });
  const gone: Choice[] = [];
  for (const { id } of chosen ?? []) {
    if (id === "vibe") { disconnectVibe(deps); continue; }
    const path = pathOf(id);
    const text = path ? readIfPresent(path) : undefined;
    const next = text === undefined ? null : disconnectAssistant(id, text);
    if (path && next !== null) { writeConfig(path, next); deps.log(`[studium] ${NAMES[id].en} disconnected: ${path}.`); gone.push(id); }
  }
  if (gone.length) void vscode.window.showInformationMessage(say(`Studium is no longer connected to ${gone.map(name).join(", ")}.`,
    `Studium n'est plus relié à ${gone.map(name).join(", ")}.`));
}

/** At activation: register the commands and keep current, silently, every entry this extension wrote. Never throws. */
export function setUpAssistantConnections(context: vscode.ExtensionContext, deps: VibeConnectionDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("studium.connectAssistant", () => connectAssistants(context, deps)),
    vscode.commands.registerCommand("studium.disconnectAssistant", () => disconnectAssistants(deps)),
  );
  if (vscode.env.remoteName) return;
  for (const id of ASSISTANT_IDS) {
    try {
      const path = pathOf(id);
      const text = path ? readIfPresent(path) : undefined;
      if (!path || !text || !studiumState(id, text)?.ours) continue;
      const entry = serverEntry(context, deps);
      if (!entry || assistantEntryIsCurrent(id, text, entry)) continue;
      const result = connectAssistant(id, text, entry, { replaceHandWritten: false });
      if ("text" in result) { writeConfig(path, result.text); deps.log(`[studium] ${NAMES[id].en}'s Studium entry updated: ${path}.`); }
    } catch (e: any) {
      deps.log(`[studium] ${NAMES[id].en} connection check skipped: ${e?.message ?? e}`);
    }
  }
}
