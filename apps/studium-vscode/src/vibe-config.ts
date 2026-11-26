// vibe-config.ts — the pure parts of connecting Mistral Vibe to the extension's own Studium server (spec
// 2026-11-26-vibe-connect-design, approved for A and B). Vibe (its CLI, its VS Code extension and Vibe Desktop)
// reads MCP servers from <VIBE_HOME or ~/.vibe>/config.toml, one [[mcp_servers]] table each. The extension writes one
// table, name = "studium", and touches nothing else in the file: the edit is a text splice, the TOML parser only
// checks the file before and after. Vibe rewrites the file without comments when it adds a server itself
// (`vibe mcp add`, tomli_w), so the extension's entry is recognised by an env key, never by a comment. No `vscode`
// import: the drivers test this outside the extension host; vibe-connection.ts wires it to the editor.
import { dirname, join, resolve } from "node:path";
import { parse } from "smol-toml";

/** The env key and value that mark the entry the extension wrote. */
export const VIBE_MARKER_KEY = "STUDIUM_WRITTEN_BY";
export const VIBE_MARKER = "studium-vscode";
/** The server name the extension writes. */
export const VIBE_SERVER_NAME = "studium";

/** Vibe's home: VIBE_HOME (with ~ expanded) when set, else ~/.vibe (Vibe 3.1.3, vibe/utils/vibe_home.py). */
export function vibeHome(env: Record<string, string | undefined>, homedir: string): string {
  const configured = env["VIBE_HOME"]?.trim();
  if (!configured) return join(homedir, ".vibe");
  return resolve(configured.startsWith("~") ? join(homedir, configured.slice(1)) : configured);
}

/** The file Vibe reads its MCP servers from. */
export function vibeConfigPath(env: Record<string, string | undefined>, homedir: string): string {
  return join(vibeHome(env, homedir), "config.toml");
}

/** The folder of the editor's installation, which every process of that editor runs from: the .app bundle on macOS
 *  (with a trailing slash), else the folder of the executable. The server keeps its pane link only when one of its
 *  ancestor processes runs from there (lesson-mcp index.ts, STUDIUM_OPEN_LINK_UNDER). */
export function editorInstallRoot(execPath: string): string {
  const app = execPath.match(/^(.*?\.app)\//);
  return app ? `${app[1]}/` : dirname(execPath);
}

export interface VibeEntry {
  command: string;
  args: string[];
  /** Null values are left out (TOML has no null). */
  env: Record<string, string | null | undefined>;
}

const quote = (value: string): string => JSON.stringify(value);
const BARE_KEY = /^[A-Za-z0-9_-]+$/;

/** The TOML of the extension's entry, ending with a newline, the marker included. */
export function studiumEntryToml(entry: VibeEntry): string {
  const env = Object.entries({ ...entry.env, [VIBE_MARKER_KEY]: VIBE_MARKER })
    .filter((pair): pair is [string, string] => typeof pair[1] === "string")
    .map(([key, value]) => `${BARE_KEY.test(key) ? key : quote(key)} = ${quote(value)}`);
  return [
    "[[mcp_servers]]",
    `name = ${quote(VIBE_SERVER_NAME)}`,
    'transport = "stdio"',
    // A list, not a string: Vibe splits a string command on spaces (shlex), and "Visual Studio Code.app" has some.
    `command = [${quote(entry.command)}]`,
    `args = [${entry.args.map(quote).join(", ")}]`,
    "",
    "[mcp_servers.env]",
    ...env,
    "",
  ].join("\n");
}

interface Header { at: number; lineEnd: number; name: string; array: boolean }

/** The table headers of a TOML text, in order: [name] or [[name]] at the start of a line. A header-looking line
 *  inside a multi-line string would be taken too; the parser checks every result, so such a file is refused. */
function headers(text: string): Header[] {
  const found: Header[] = [];
  const pattern = /^[ \t]*(\[\[?)[ \t]*([^\]\n]+?)[ \t]*\]\]?[ \t]*(?:#[^\n]*)?$/gm;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    found.push({ at: m.index, lineEnd: m.index + m[0].length, name: m[2]!.replace(/\s+/g, ""), array: m[1] === "[[" });
  }
  return found;
}

type Servers = Array<Record<string, unknown>>;
function serversOf(text: string): Servers | null {
  try {
    const doc = parse(text) as Record<string, unknown>;
    const servers = doc["mcp_servers"];
    if (servers === undefined) return [];
    return Array.isArray(servers) ? servers as Servers : null;
  } catch {
    return null;
  }
}
const isOurs = (server: Record<string, unknown>): boolean =>
  (server["env"] as Record<string, unknown> | undefined)?.[VIBE_MARKER_KEY] === VIBE_MARKER;

export interface StudiumTable { start: number; end: number; ours: boolean; command: string }

/** Where the "studium" [[mcp_servers]] table lies in `text`: from its header to the next header that is not one of
 *  its own sub-tables ([mcp_servers.env], …). Null when there is none, or when the file cannot be read that way (it
 *  does not parse, or its servers are not written as [[mcp_servers]] tables). */
export function findStudiumTable(text: string): StudiumTable | null {
  const servers = serversOf(text);
  if (!servers) return null;
  const index = servers.findIndex((s) => s["name"] === VIBE_SERVER_NAME);
  if (index < 0) return null;
  const all = headers(text);
  const tables = all.filter((h) => h.array && h.name === "mcp_servers");
  if (tables.length !== servers.length) return null;
  const header = tables[index]!;
  const next = all.find((h) => h.at > header.at && !(!h.array && h.name.startsWith("mcp_servers.")) );
  const server = servers[index]!;
  return { start: header.at, end: next ? next.at : text.length, ours: isOurs(server), command: commandLine(server) };
}

/** A server's command and arguments as one line; Vibe takes `command` as a string or a list. */
function commandLine(server: Record<string, unknown>): string {
  const command = Array.isArray(server["command"]) ? server["command"] : [server["command"]];
  return [...command, ...(Array.isArray(server["args"]) ? server["args"] : [])].filter((x) => typeof x === "string").join(" ");
}

const RUNS_STUDIUM = /studium-mcp|lesson-mcp/i;
/** Another server than "studium" that runs a Studium build (studium-mcp, lesson-mcp), by name; null if none. */
export function otherStudiumServer(text: string): string | null {
  for (const server of serversOf(text) ?? []) {
    if (server["name"] === VIBE_SERVER_NAME) continue;
    if (RUNS_STUDIUM.test(commandLine(server))) return typeof server["name"] === "string" ? server["name"] : "?";
  }
  return null;
}

export type ConnectResult =
  | { text: string; replaced: "none" | "ours" | "hand-written" }
  | { refused: "unparsable" }
  | { refused: "hand-written"; command: string };

/** The file's text with the extension's entry `block` in it: appended, or in place of the "studium" table. A
 *  "studium" table the extension did not write is replaced only with `replaceHandWritten`. Refused when the file
 *  does not parse, or cannot be edited table by table, or the result would not hold exactly one "studium" server,
 *  the extension's. Absent or blank text gives the block alone. */
export function connectEntry(text: string | undefined, block: string, opts: { replaceHandWritten: boolean }): ConnectResult {
  if (text === undefined || !text.trim()) return { text: block, replaced: "none" };
  const servers = serversOf(text);
  if (!servers) return { refused: "unparsable" };
  let next: string;
  let replaced: "none" | "ours" | "hand-written" = "none";
  if (servers.some((s) => s["name"] === VIBE_SERVER_NAME)) {
    const table = findStudiumTable(text);
    if (!table) return { refused: "unparsable" };
    if (!table.ours && !opts.replaceHandWritten) return { refused: "hand-written", command: table.command };
    const tail = text.slice(table.end);
    next = text.slice(0, table.start) + block + (tail && !tail.startsWith("\n") ? "\n" : "") + tail;
    replaced = table.ours ? "ours" : "hand-written";
  } else {
    next = text + (text.endsWith("\n") ? "" : "\n") + "\n" + block;
  }
  const after = serversOf(next);
  const studium = after?.filter((s) => s["name"] === VIBE_SERVER_NAME) ?? [];
  if (!after || studium.length !== 1 || !isOurs(studium[0]!)) return { refused: "unparsable" };
  return { text: next, replaced };
}

/** The file's text without the extension's entry, or null when the file holds no entry of the extension's. */
export function disconnectEntry(text: string): string | null {
  const table = findStudiumTable(text);
  if (!table || !table.ours) return null;
  const before = text.slice(0, table.start).replace(/\n\n$/, "\n");
  return before + text.slice(table.end);
}

/** Whether the file holds the extension's entry exactly as `block` writes it (nothing to refresh). */
export function entryIsCurrent(text: string, block: string): boolean {
  const table = findStudiumTable(text);
  return !!table && table.ours && text.slice(table.start, table.end).trim() === block.trim();
}

/** Whether the file holds the extension's entry (to refresh it, or to say it is connected). */
export function hasOurEntry(text: string | undefined): boolean {
  return !!text && !!findStudiumTable(text)?.ours;
}

/** Whether the file holds any "studium" server (ours or hand-written). */
export function hasStudiumServer(text: string | undefined): boolean {
  return !!text && (serversOf(text) ?? []).some((s) => s["name"] === VIBE_SERVER_NAME);
}
