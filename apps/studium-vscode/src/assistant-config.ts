// assistant-config.ts — the pure parts of connecting other assistants than Copilot and Mistral Vibe to the extension's
// own Studium server, with no Node (spec 2026-11-27-connect-assistants-design, owner's delegation of 26 Nov 2026).
// Each assistant reads its MCP servers from one file the extension edits in place, touching nothing else:
//   - Codex (its VS Code extension and its CLI): <CODEX_HOME or ~/.codex>/config.toml, a [mcp_servers.studium] table;
//   - Claude Code (its VS Code extension and its CLI): <CLAUDE_CONFIG_DIR or ~>/.claude.json, mcpServers.studium;
//   - Claude Desktop: claude_desktop_config.json in Claude's application-data folder, mcpServers.studium;
//   - Cursor: ~/.cursor/mcp.json, mcpServers.studium (the shape of docs/start/cursor.md; not run on this Mac);
//   - OpenCode (its desktop app, its web UI and its terminal UI): <XDG_CONFIG_HOME or ~/.config>/opencode/opencode.json
//     (or .jsonc), mcp.studium (mcp.servers.studium when the file already nests its servers that way, OpenCode 2).
// Shapes measured on 26 Nov 2026 with `codex mcp add` (codex-cli 0.170.0), `claude mcp add -s user` (Claude Code
// 2.1.332) and `opencode mcp add --global` (OpenCode 2.3.0, which reads both mcp.<name> and mcp.servers.<name>).
// The entry the extension wrote is recognised by its env marker (vibe-config.ts), never by a comment. JSON files are
// edited with jsonc-parser, which keeps their comments and layout. No `vscode` import: the drivers test this outside
// the extension host; assistant-connection.ts wires it to the editor.
import { join, resolve } from "node:path";
import { applyEdits, getNodeValue, modify, parseTree, type ParseError } from "jsonc-parser";
import { parse } from "smol-toml";
import { VIBE_MARKER, VIBE_MARKER_KEY, VIBE_SERVER_NAME } from "./vibe-config.js";

export type AssistantId = "codex" | "claude-code" | "claude-desktop" | "cursor" | "opencode";
export const ASSISTANT_IDS: readonly AssistantId[] = ["codex", "claude-code", "claude-desktop", "cursor", "opencode"];

export interface ServerEntry {
  command: string;
  args: string[];
  /** Null or undefined values are left out. */
  env: Record<string, string | null | undefined>;
}

type Env = Record<string, string | undefined>;
const expand = (value: string, homedir: string): string =>
  resolve(value.startsWith("~") ? join(homedir, value.slice(1)) : value);
const configured = (env: Env, key: string): string | undefined => env[key]?.trim() || undefined;

/** Where each assistant reads its MCP servers on this computer; null when it has no such file on this platform.
 *  `exists` tells which of OpenCode's two file names is there (opencode.jsonc wins only when it alone exists). */
export function assistantConfigPath(id: AssistantId, opts: {
  env: Env; homedir: string; platform: string; exists?: (path: string) => boolean;
}): string | null {
  const { env, homedir, platform } = opts;
  switch (id) {
    case "codex": {
      const home = configured(env, "CODEX_HOME");
      return join(home ? expand(home, homedir) : join(homedir, ".codex"), "config.toml");
    }
    case "claude-code": {
      const dir = configured(env, "CLAUDE_CONFIG_DIR");
      return join(dir ? expand(dir, homedir) : homedir, ".claude.json");
    }
    case "claude-desktop": {
      if (platform === "darwin") return join(homedir, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      if (platform === "win32") {
        const appData = configured(env, "APPDATA") ?? join(homedir, "AppData", "Roaming");
        return join(appData, "Claude", "claude_desktop_config.json");
      }
      return null;
    }
    case "cursor":
      return join(homedir, ".cursor", "mcp.json");
    case "opencode": {
      const xdg = configured(env, "XDG_CONFIG_HOME");
      const dir = join(xdg ? expand(xdg, homedir) : join(homedir, ".config"), "opencode");
      const json = join(dir, "opencode.json");
      const jsonc = join(dir, "opencode.jsonc");
      return opts.exists && !opts.exists(json) && opts.exists(jsonc) ? jsonc : json;
    }
  }
}

const marked = (env: ServerEntry["env"]): Record<string, string> => Object.fromEntries(
  Object.entries({ ...env, [VIBE_MARKER_KEY]: VIBE_MARKER }).filter((pair): pair is [string, string] => typeof pair[1] === "string"));

export type ConnectResult =
  | { text: string; replaced: "none" | "ours" | "hand-written" }
  | { refused: "unparsable" }
  | { refused: "hand-written"; command: string };

/** What an assistant's file says about a "studium" server. */
export interface StudiumState { present: boolean; ours: boolean; command: string }

interface Format {
  connect(text: string | undefined, entry: ServerEntry, opts: { replaceHandWritten: boolean }): ConnectResult;
  disconnect(text: string): string | null;
  state(text: string | undefined): StudiumState | null;
  isCurrent(text: string, entry: ServerEntry): boolean;
  /** The names of the other servers in the file that run Studium (a hand-written or development entry under another
   *  name): the assistant would list every Studium tool twice. */
  others(text: string | undefined): string[];
}

/** Whether a server, by its name or its command line, runs Studium: the npm package, the bundled server, a checkout. */
const RUNS_STUDIUM = /studium-mcp|lesson-mcp(\.cjs)?\b|apps\/lesson-mcp|studium-vscode/i;
const looksLikeStudium = (name: string, commandLine: string): boolean => /studium/i.test(name) || RUNS_STUDIUM.test(commandLine);

// ----- JSON files (Claude Code, Claude Desktop, OpenCode) -----

type Json = Record<string, unknown>;
interface JsonShape {
  /** The path of the "studium" server in `doc`. */
  path(doc: Json): (string | number)[];
  value(entry: ServerEntry): Json;
  envOf(server: Json): Json | undefined;
  commandOf(server: Json): string;
}

const commandLine = (parts: unknown[]): string => parts.filter((x) => typeof x === "string").join(" ");
const claudeShape = (stdioType: boolean): JsonShape => ({
  path: () => ["mcpServers", VIBE_SERVER_NAME],
  value: (entry) => ({ ...(stdioType ? { type: "stdio" } : {}), command: entry.command, args: entry.args, env: marked(entry.env) }),
  envOf: (server) => server["env"] as Json | undefined,
  commandOf: (server) => commandLine([server["command"], ...(Array.isArray(server["args"]) ? server["args"] : [])]),
});
const opencodeShape: JsonShape = {
  // OpenCode 2 writes mcp.servers.<name>; OpenCode 1 read mcp.<name>, which 2.3.0 still reads. The flat form, unless
  // the file nests its servers already, works with both.
  path: (doc) => {
    const mcp = doc["mcp"] as Json | undefined;
    const servers = mcp?.["servers"];
    const nested = !!servers && typeof servers === "object" && !Array.isArray(servers) && !("type" in (servers as Json));
    return nested ? ["mcp", "servers", VIBE_SERVER_NAME] : ["mcp", VIBE_SERVER_NAME];
  },
  value: (entry) => ({ type: "local", command: [entry.command, ...entry.args], environment: marked(entry.env), enabled: true }),
  envOf: (server) => server["environment"] as Json | undefined,
  commandOf: (server) => commandLine(Array.isArray(server["command"]) ? server["command"] : [server["command"]]),
};

const FORMATTING = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } };

function readJson(text: string): Json | null {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !tree || tree.type !== "object") return null;
  return getNodeValue(tree) as Json;
}
function serverAt(doc: Json, path: (string | number)[]): Json | undefined {
  let node: unknown = doc;
  for (const key of path) node = node && typeof node === "object" ? (node as Json)[key as string] : undefined;
  return node && typeof node === "object" && !Array.isArray(node) ? node as Json : node === undefined ? undefined : {};
}
const stable = (value: unknown): string => JSON.stringify(value, (_key, v) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);

function jsonFormat(shape: JsonShape): Format {
  const state = (text: string | undefined): StudiumState | null => {
    if (text === undefined || !text.trim()) return { present: false, ours: false, command: "" };
    const doc = readJson(text);
    if (!doc) return null;
    const server = serverAt(doc, shape.path(doc));
    if (!server) return { present: false, ours: false, command: "" };
    return { present: true, ours: shape.envOf(server)?.[VIBE_MARKER_KEY] === VIBE_MARKER, command: shape.commandOf(server) };
  };
  return {
    state,
    connect(text, entry, opts) {
      const source = text === undefined || !text.trim() ? "{}\n" : text;
      const doc = readJson(source);
      if (!doc) return { refused: "unparsable" };
      const before = state(source)!;
      if (before.present && !before.ours && !opts.replaceHandWritten) return { refused: "hand-written", command: before.command };
      const path = shape.path(doc);
      const next = applyEdits(source, modify(source, path, shape.value(entry), FORMATTING));
      const after = state(next);
      if (!after?.present || !after.ours) return { refused: "unparsable" };
      return { text: next, replaced: before.present ? (before.ours ? "ours" : "hand-written") : "none" };
    },
    disconnect(text) {
      const doc = readJson(text);
      if (!doc || !state(text)?.ours) return null;
      return applyEdits(text, modify(text, shape.path(doc), undefined, FORMATTING));
    },
    isCurrent(text, entry) {
      const doc = readJson(text);
      if (!doc) return false;
      const server = serverAt(doc, shape.path(doc));
      return !!server && stable(server) === stable(shape.value(entry));
    },
    others(text) {
      const doc = text && text.trim() ? readJson(text) : null;
      if (!doc) return [];
      const path = shape.path(doc);
      const container = serverAt(doc, path.slice(0, -1));
      if (!container) return [];
      return Object.entries(container)
        .filter(([key, server]) => key !== path.at(-1) && server && typeof server === "object" && !Array.isArray(server))
        .filter(([key, server]) => looksLikeStudium(key, shape.commandOf(server as Json)))
        .map(([key]) => key);
    },
  };
}

// ----- Codex's config.toml -----

const quote = (value: string): string => JSON.stringify(value);
const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const CODEX_TABLE = `mcp_servers.${VIBE_SERVER_NAME}`;

/** The TOML of the extension's Codex entry, ending with a newline. `default_tools_approval_mode = "approve"`: Codex
 *  otherwise asks before every tool not marked read-only (starting a lesson, each answer, each rating), and in
 *  `codex exec` refuses them ("requires approval, but approval policy is never"). Studium's tools write only
 *  Studium's own lessons and progress; the owner allowed them for Codex on 27 Nov 2026. */
export function codexEntryToml(entry: ServerEntry): string {
  return [
    `[${CODEX_TABLE}]`,
    `command = ${quote(entry.command)}`,
    `args = [${entry.args.map(quote).join(", ")}]`,
    `default_tools_approval_mode = "approve"`,
    "",
    `[${CODEX_TABLE}.env]`,
    ...Object.entries(marked(entry.env)).map(([key, value]) => `${BARE_KEY.test(key) ? key : quote(key)} = ${quote(value)}`),
    "",
  ].join("\n");
}

interface Header { at: number; name: string }
/** Table headers ([a.b] or [[a.b]]) at the start of a line, their name without spaces or quotes around plain keys. */
function tomlHeaders(text: string): Header[] {
  const found: Header[] = [];
  const pattern = /^[ \t]*\[\[?[ \t]*([^\]\n]+?)[ \t]*\]\]?[ \t]*(?:#[^\n]*)?$/gm;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    found.push({ at: m.index, name: m[1]!.split(".").map((part) => part.trim().replace(/^"([A-Za-z0-9_-]+)"$/, "$1")).join(".") });
  }
  return found;
}
function codexServers(text: string): Json | null {
  try {
    const servers = (parse(text) as Json)["mcp_servers"];
    if (servers === undefined) return {};
    return servers && typeof servers === "object" && !Array.isArray(servers) ? servers as Json : null;
  } catch {
    return null;
  }
}
const inCodexTable = (name: string): boolean => name === CODEX_TABLE || name.startsWith(`${CODEX_TABLE}.`);
/** The span of the studium tables: from the first [mcp_servers.studium…] header to the next header outside them.
 *  Null when they are not written as one run of such tables (dotted keys, an inline table, a split run). */
function codexSpan(text: string): { start: number; end: number } | null {
  const all = tomlHeaders(text);
  const first = all.findIndex((h) => inCodexTable(h.name));
  if (first < 0) return null;
  let last = first;
  while (last + 1 < all.length && inCodexTable(all[last + 1]!.name)) last++;
  if (all.slice(last + 1).some((h) => inCodexTable(h.name))) return null;
  return { start: all[first]!.at, end: last + 1 < all.length ? all[last + 1]!.at : text.length };
}

const codexFormat: Format = {
  state(text) {
    if (text === undefined || !text.trim()) return { present: false, ours: false, command: "" };
    const servers = codexServers(text);
    if (!servers) return null;
    const server = servers[VIBE_SERVER_NAME] as Json | undefined;
    if (!server) return { present: false, ours: false, command: "" };
    return {
      present: true,
      ours: (server["env"] as Json | undefined)?.[VIBE_MARKER_KEY] === VIBE_MARKER,
      command: commandLine([server["command"], ...(Array.isArray(server["args"]) ? server["args"] : [])]),
    };
  },
  connect(text, entry, opts) {
    const block = codexEntryToml(entry);
    if (text === undefined || !text.trim()) return { text: block, replaced: "none" };
    const before = codexFormat.state(text);
    if (!before) return { refused: "unparsable" };
    if (before.present && !before.ours && !opts.replaceHandWritten) return { refused: "hand-written", command: before.command };
    let next: string;
    if (before.present) {
      const span = codexSpan(text);
      if (!span) return { refused: "unparsable" };
      const tail = text.slice(span.end);
      next = text.slice(0, span.start) + block + (tail && !tail.startsWith("\n") ? "\n" : "") + tail;
    } else {
      next = text + (text.endsWith("\n") ? "" : "\n") + "\n" + block;
    }
    const after = codexFormat.state(next);
    if (!after?.present || !after.ours) return { refused: "unparsable" };
    return { text: next, replaced: before.present ? (before.ours ? "ours" : "hand-written") : "none" };
  },
  disconnect(text) {
    if (!codexFormat.state(text)?.ours) return null;
    const span = codexSpan(text);
    if (!span) return null;
    return text.slice(0, span.start).replace(/\n\n$/, "\n") + text.slice(span.end);
  },
  others(text) {
    const servers = text && text.trim() ? codexServers(text) : null;
    if (!servers) return [];
    return Object.entries(servers)
      .filter(([key, server]) => key !== VIBE_SERVER_NAME && server && typeof server === "object")
      .filter(([key, server]) => looksLikeStudium(key, commandLine([(server as Json)["command"], ...(Array.isArray((server as Json)["args"]) ? (server as Json)["args"] as unknown[] : [])])))
      .map(([key]) => key);
  },
  isCurrent(text, entry) {
    const span = codexSpan(text);
    return !!span && !!codexFormat.state(text)?.ours && text.slice(span.start, span.end).trim() === codexEntryToml(entry).trim();
  },
};

const FORMATS: Record<AssistantId, Format> = {
  "codex": codexFormat,
  "claude-code": jsonFormat(claudeShape(true)),
  "claude-desktop": jsonFormat(claudeShape(false)),
  "cursor": jsonFormat(claudeShape(true)),
  "opencode": jsonFormat(opencodeShape),
};

/** The file's text with the extension's entry in it, added or in place of the "studium" server. A "studium" server
 *  the extension did not write is replaced only with `replaceHandWritten`. Refused when the file cannot be read, or
 *  when the result would not hold the extension's entry. Absent or blank text gives a file with the entry alone. */
export function connectAssistant(id: AssistantId, text: string | undefined, entry: ServerEntry, opts: { replaceHandWritten: boolean }): ConnectResult {
  return FORMATS[id].connect(text, entry, opts);
}
/** The file's text without the extension's entry, or null when it holds no entry of the extension's. */
export function disconnectAssistant(id: AssistantId, text: string): string | null {
  return FORMATS[id].disconnect(text);
}
/** What the file says about a "studium" server; null when the file cannot be read. */
export function studiumState(id: AssistantId, text: string | undefined): StudiumState | null {
  return FORMATS[id].state(text);
}
/** The other servers in the file that run Studium, by name; empty when there are none or the file cannot be read. */
export function otherStudiumServers(id: AssistantId, text: string | undefined): string[] {
  return FORMATS[id].others(text);
}
/** Whether the file holds the extension's entry exactly as it would be written now (nothing to refresh). */
export function assistantEntryIsCurrent(id: AssistantId, text: string, entry: ServerEntry): boolean {
  return FORMATS[id].isCurrent(text, entry);
}
