// mcp-connect.ts — spawn lesson-mcp over stdio and expose a typed call() + close(). Shared by the lesson
// panel (extension.ts) and the @studium chat participant (chat.ts) so the connection logic lives once.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** Shown to the learner when a tool fails without saying anything at all — never "undefined". */
const UNKNOWN_TOOL_ERROR = "l'outil lesson-mcp a échoué sans message";
const STDERR_CHANNEL = "Studium — lesson-mcp";

/** Where a server diagnostic line goes (an output channel in VS Code, the console in tests). */
export type LogSink = (line: string) => void;

/** How to launch lesson-mcp: the executable, its args, its cwd, extra env. */
export interface ServerLaunch { command: string; args: string[]; cwd: string; env?: Record<string, string>; }

export interface ServerInfo {
  name: string;
  version: string;
  build: { origin: "source" | "bundled"; built_at: string | null; git_sha: string | null };
  tools: string[];
  bundles_root: string;
  data_dir: string | null;
  model_backend: "none" | "configured";
}

/** Describe whether a launch uses live TypeScript sources or the VSIX bundle. */
export function describeServerLaunch(launch: ServerLaunch): string {
  const entry = launch.args[0] ?? "";
  if (entry.endsWith("lesson-mcp.cjs")) return "bundled (dist/lesson-mcp.cjs)";
  return `source (${resolve(launch.cwd, entry)})`;
}

/** Format get_server_info for the Studium output channel. */
export function serverInfoLine(info: ServerInfo): string {
  const sha = info.build.git_sha ? ` sha=${info.build.git_sha}` : "";
  return `[${info.name}] v${info.version} ${info.build.origin} ${info.build.built_at ?? "unbuilt"}${sha} ` +
    `tools=${info.tools.length} bundles_root=${info.bundles_root} data_dir=${info.data_dir ?? "none"} ` +
    `model_backend=${info.model_backend}`;
}

/** Decide how to launch lesson-mcp, in order of preference:
 *  1. a repo checkout (live sources via tsx) — dev mode, keeps edits hot;
 *  2. the server bundled INSIDE the extension (dist/lesson-mcp.cjs, produced by `pnpm build`),
 *     run with the extension host's own executable as node (ELECTRON_RUN_AS_NODE) — this is what
 *     makes a packaged VSIX work on a machine that has no monorepo and no global tsx;
 *  3. otherwise throw an actionable error naming both places and the setting that fixes it. */
export function resolveServerLaunch(extensionPath: string, repoRoot: string): ServerLaunch {
  const mcpDir = resolve(repoRoot, "apps/lesson-mcp");
  if (existsSync(resolve(mcpDir, "src/index.ts"))) {
    return { command: resolveTsx(repoRoot), args: ["src/index.ts"], cwd: mcpDir };
  }
  const bundled = resolve(extensionPath, "dist/lesson-mcp.cjs");
  if (existsSync(bundled)) {
    return { command: process.execPath, args: [bundled], cwd: dirname(bundled),
             env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  throw new Error(
    `lesson-mcp introuvable : ni un checkout du dépôt (${mcpDir}), ni le serveur embarqué ` +
    `(${bundled}). Pointez le réglage « studium.repoRoot » vers un clone de prototype-build, ` +
    `ou réinstallez le VSIX (pnpm package).`);
}

/** Resolve the `tsx` runner used to launch lesson-mcp, tolerant of the package manager. The old hardcoded
 *  pnpm path broke on a packaged VSIX / npm / yarn; try the common layouts, else fall back to PATH. */
export function resolveTsx(repoRoot: string): string {
  const candidates = [
    resolve(repoRoot, "node_modules/.pnpm/node_modules/.bin/tsx"), // pnpm
    resolve(repoRoot, "node_modules/.bin/tsx"), // npm / yarn (hoisted)
    resolve(repoRoot, "apps/lesson-mcp/node_modules/.bin/tsx"), // installed at the package
  ];
  return candidates.find((p) => existsSync(p)) ?? "tsx"; // last resort: rely on PATH
}

/** Parse one text content block as a JSON object. Returns {} for an absent/empty block (a tool that
 *  answers with no content has an empty payload) and null when the text is not a JSON object. */
function asJsonObject(text: string): Record<string, any> | null {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Turn a raw MCP tool result into the tool's payload, or throw the tool's REAL message.
 *  Inputs: the tool name and the raw result. Output: the parsed payload object.
 *  A plain-text block (a crashing server, a stack trace) is reported verbatim instead of surfacing as
 *  "Unexpected token", and an error payload with no `error` field never degrades to "undefined" —
 *  extension.ts pipes these messages straight into showErrorMessage. */
export function parseToolResult(name: string, res: any): Record<string, any> {
  const text = String(res?.content?.[0]?.text ?? "");
  const data = asJsonObject(text);
  if (data && !res?.isError) return data;
  const reason = (typeof data?.error === "string" && data.error) || text.trim() || UNKNOWN_TOOL_ERROR;
  throw new Error(`${name}: ${reason}`);
}

/** Pipe the server's stderr into a log sink, so a crashing lesson-mcp leaves a diagnostic somewhere.
 *  Inputs: the stderr stream (null when the transport did not pipe it) and the sink. No output. */
export function forwardStderr(stream: { on(event: string, listener: (chunk: any) => void): unknown } | null, log: LogSink): void {
  if (!stream) return;
  stream.on("data", (chunk: Buffer | string) => log(String(chunk).trimEnd()));
}

let installedLog: LogSink | undefined;

/** Install the process-wide sink server diagnostics go to (extension.ts activate() hands over the
 *  "Studium — lesson-mcp" output channel). Keeps this module free of the `vscode` import, so the
 *  driver test can import it outside the extension host. */
export function setLessonMcpLog(log: LogSink): void {
  installedLog = log;
}

/** The sink a connection logs to: the caller's, else the installed channel, else the console.
 *  Input: an optional explicit sink. Output: the sink to use — never undefined. */
export function resolveLogSink(explicit?: LogSink): LogSink {
  return explicit ?? installedLog ?? ((line: string) => console.error(`[${STDERR_CHANNEL}] ${line}`));
}

export type McpCall = (name: string, args: Record<string, any>) => Promise<Record<string, any>>;
export interface LessonMcp { call: McpCall; close: () => void; }

/** Connect to a fresh lesson-mcp subprocess. `call` throws on a tool error; `close` tears the transport
 *  down. The server's stderr is piped to `opts.log` (default: the Studium output channel) — never
 *  discarded, so a server that dies at startup is diagnosable. */
export async function connectLessonMcp(opts: { launch: ServerLaunch; env: Record<string, string>; log?: LogSink }): Promise<LessonMcp> {
  const log = resolveLogSink(opts.log);
  const { launch } = opts;
  const transport = new StdioClientTransport({ command: launch.command, args: launch.args, cwd: launch.cwd,
    env: { ...launch.env, ...opts.env }, stderr: "pipe" });
  forwardStderr(transport.stderr, log); // piped stderr is readable BEFORE start(): no early output lost
  const client = new Client({ name: "studium-vscode", version: "0.1.0" });
  await client.connect(transport);
  const call: McpCall = async (name, args) => parseToolResult(name, await client.callTool({ name, arguments: args }));
  return { call, close: () => { client.close().catch(() => {}); } };
}
