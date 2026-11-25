// mcp-provider.ts — INT-STUDIUM-064: the pure parts of offering the extension's own lesson server to the editor's
// chat (Copilot agent mode) through the MCP server definition provider API. No `vscode` import, so the drivers
// test it outside the extension host; mcp-registration.ts wires it to the editor.
import { join } from "node:path";

/** The provider id, declared under contributes.mcpServerDefinitionProviders in package.json. */
export const MCP_PROVIDER_ID = "studium.lessonServer";
/** The name the editor shows for the server (MCP: List Servers). */
export const MCP_SERVER_LABEL = "Studium";

/** The two pieces of the editor's API the registration needs. */
export interface McpServerApi {
  register: (id: string, provider: unknown) => { dispose(): unknown };
  Definition: new (label: string, command: string, args?: string[], env?: Record<string, string | number | null>, version?: string) => any;
}

/** Feature detection. The API is stable since VS Code 1.101; an older VS Code, Cursor, VSCodium or another fork may
 *  lack it, or expose a proposed version that throws when touched. Input: the `vscode` module (or a fake).
 *  Output: the API, or null when it cannot be used. Never throws. */
export function mcpServerApi(vscodeLike: unknown): McpServerApi | null {
  try {
    const api = vscodeLike as { lm?: { registerMcpServerDefinitionProvider?: unknown }; McpStdioServerDefinition?: unknown };
    const lm = api.lm;
    const register = lm?.registerMcpServerDefinitionProvider;
    const Definition = api.McpStdioServerDefinition;
    if (typeof register !== "function" || typeof Definition !== "function") return null;
    return { register: (id, provider) => register.call(lm, id, provider), Definition: Definition as McpServerApi["Definition"] };
  } catch {
    return null;
  }
}

/** D2 (owner decision 1): the start of the link that opens a lesson in the pane, which the URI handler opens
 *  (lesson-uri.ts): the editor's own scheme (vscode, vscode-insiders, ...) and the extension's id. The server
 *  appends the lesson file's path, percent-encoded. Pure. */
export function openLinkPrefix(uriScheme: string | undefined, extensionId: string): string {
  return `${uriScheme?.trim() || "vscode"}://${extensionId}/open?bundle=`;
}

/** The environment the editor gives the registered server, ON TOP OF the extension host's own (a null value
 *  removes an inherited variable). Same places as the lesson pane's server (lessonMcpEnv): BUNDLES_ROOT from the
 *  lessons folder setting, progress in the extension's storage, telemetry consent from the setting alone. No judge
 *  unless one is configured where VS Code was started (a non-blank LITELLM_BASE_URL, as for the pane). Owner
 *  decision 1: the pane's learner (STUDIUM_LEARNER_ID, so the chat and the pane share progress; blank removes it)
 *  and the pane link (STUDIUM_OPEN_LINK, lessons offered in the pane first). Review finding 3: the STUDIUM_HOME the
 *  extension resolved once, so the server's library is the folder the extension watches. Nothing else is copied
 *  from `hostEnv`: a definition may be forwarded to a Copilot session, and an inherited key (LITELLM_API_KEY
 *  included) must not travel in it. Pure. */
export function registeredServerEnv(opts: {
  launchEnv?: Record<string, string>;
  bundlesRoot: string;
  storageDir: string;
  telemetryConsent: boolean;
  hostEnv: Record<string, string | undefined>;
  learnerId?: string;
  openLink?: string;
  studiumHome?: string;
}): Record<string, string | null> {
  const judge = opts.hostEnv["LITELLM_BASE_URL"]?.trim() ?? "";
  return {
    BUNDLES_ROOT: opts.bundlesRoot,
    STUDIUM_DATA_DIR: opts.storageDir,
    STUDIUM_TELEMETRY_CONSENT: opts.telemetryConsent ? "granted" : null,
    LITELLM_BASE_URL: judge,
    ...(opts.studiumHome !== undefined ? { STUDIUM_HOME: opts.studiumHome } : {}),
    ...(opts.learnerId !== undefined ? { STUDIUM_LEARNER_ID: opts.learnerId.trim() || null } : {}),
    ...(opts.openLink !== undefined ? { STUDIUM_OPEN_LINK: opts.openLink } : {}),
    ...opts.launchEnv,
  };
}

/** The files where a Studium server may already have been added by hand, most common first: the user profile's
 *  mcp.json (`code --add-mcp` writes there; it sits next to globalStorage), each workspace folder's
 *  .vscode/mcp.json and .mcp.json, and Copilot's own mcp-config.json (COPILOT_HOME, default ~/.copilot). A profile
 *  other than the default keeps its mcp.json elsewhere; it is not looked at. Pure. */
export function mcpConfigFiles(opts: {
  globalStorageDir: string | undefined;
  workspaceFolders: readonly string[];
  env: Record<string, string | undefined>;
  homedir: string;
}): string[] {
  const copilotHome = opts.env["COPILOT_HOME"]?.trim() || join(opts.homedir, ".copilot");
  return [
    ...(opts.globalStorageDir ? [join(opts.globalStorageDir, "..", "..", "mcp.json")] : []),
    ...opts.workspaceFolders.flatMap((folder) => [join(folder, ".vscode", "mcp.json"), join(folder, ".mcp.json")]),
    join(copilotHome, "mcp-config.json"),
  ];
}

/** Remove // and /* *\/ comments from JSONC, leaving strings (a URL's //) intact, then trailing commas. */
function stripJsonc(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else {
      out += ch;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const RUNS_STUDIUM = /studium-mcp|lesson-mcp/i;

/** The name of a server in a servers map that is Studium: named "studium" (any case), or running studium-mcp or a
 *  lesson-mcp build under another name. Null when none is. */
function studiumInServers(servers: unknown): string | null {
  if (!servers || typeof servers !== "object") return null;
  for (const [name, server] of Object.entries(servers as Record<string, unknown>)) {
    if (name.toLowerCase() === "studium") return name;
    const s = (server ?? {}) as { command?: unknown; args?: unknown };
    const line = [s.command, ...(Array.isArray(s.args) ? s.args : [])].filter((x) => typeof x === "string").join(" ");
    if (RUNS_STUDIUM.test(line)) return name;
  }
  return null;
}

/** Read one MCP configuration file's text (VS Code's `servers`, or the `mcpServers` of .mcp.json and Copilot)
 *  and return the name of the Studium server it declares, or null. A file that does not parse (half-written) is
 *  read by its text, comments removed: a false "found" only means the extension adds no second server. */
export function studiumServerIn(text: string): string | null {
  const plain = stripJsonc(text);
  if (!plain.trim()) return null;
  try {
    const parsed = JSON.parse(plain) as { servers?: unknown; mcpServers?: unknown };
    return studiumInServers(parsed?.servers) ?? studiumInServers(parsed?.mcpServers);
  } catch {
    const named = plain.match(/"(studium)"\s*:/i);
    if (named) return named[1]!;
    return RUNS_STUDIUM.test(plain) ? "studium" : null;
  }
}

/** The first place that already declares a Studium server: one of `files` (text undefined = absent or unreadable),
 *  else the older `mcp.servers` setting. Output: where it is and its name, or null. Pure. */
export function findHandAddedStudium(
  files: ReadonlyArray<{ path: string; text: string | undefined }>,
  settingServers: unknown,
): { where: string; name: string } | null {
  for (const f of files) {
    if (f.text === undefined) continue;
    const name = studiumServerIn(f.text);
    if (name) return { where: f.path, name };
  }
  const name = studiumInServers(settingServers);
  return name ? { where: "settings (mcp.servers)", name } : null;
}
