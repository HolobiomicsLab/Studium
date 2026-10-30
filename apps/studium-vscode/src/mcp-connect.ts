// mcp-connect.ts — spawn lesson-mcp over stdio and expose a typed call() + close(). Shared by the lesson
// panel (extension.ts) and the @studium chat participant (chat.ts) so the connection logic lives once.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
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

const GIT_TIMEOUT_MS = 1_000;
export type RepoHeadReader = (repoRoot: string) => string | null;

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

/** Read a checkout's HEAD identity in the same format as the bundle command. */
export function readRepoHead(repoRoot: string): string | null {
  try {
    return execFileSync("git", ["describe", "--always", "--abbrev=7"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

/** Explain a dirty or stale lesson-mcp build; return null when identities agree. */
export function serverBuildWarning(
  info: ServerInfo,
  repoRoot: string,
  readHead: RepoHeadReader = readRepoHead,
): string | null {
  const serverSha = info.build.git_sha;
  if (!serverSha) return null;
  if (serverSha.endsWith("-dirty")) {
    return `[studium] WARNING: lesson-mcp reports dirty build identity ${serverSha}.`;
  }
  const repoHead = readHead(repoRoot);
  if (!repoHead || repoHead === serverSha) return null;
  return `[studium] WARNING: lesson-mcp sha=${serverSha} differs from repoRoot HEAD=${repoHead}.`;
}

/** The environment for a lesson-mcp subprocess (ENG-03). Learner state (progress, FSRS memory) is always
 * written to `storageDir` (the extension's globalStorageUri) so reviews survive a restart; the telemetry
 * setting decides ONLY whether pseudonymised class telemetry is sent: STUDIUM_TELEMETRY_CONSENT is set
 * from the setting alone, never inherited from the shell. Pure: `baseEnv` is copied, not mutated. */
export function lessonMcpEnv(opts: {
  baseEnv: Record<string, string | undefined>;
  bundlesRoot: string;
  storageDir: string | undefined;
  telemetryConsent: boolean;
}): Record<string, string> {
  const env: Record<string, string | undefined> = { ...opts.baseEnv, BUNDLES_ROOT: opts.bundlesRoot };
  delete env["STUDIUM_TELEMETRY_CONSENT"];
  if (opts.storageDir) env["STUDIUM_DATA_DIR"] = opts.storageDir;
  if (opts.telemetryConsent) env["STUDIUM_TELEMETRY_CONSENT"] = "granted";
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined));
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
/** A live lesson-mcp connection. `close` resolves once the subprocess has exited (callers may ignore it);
 * `isClosed` turns true as soon as it is closed, by its owner or by closeAllLessonMcp. */
export interface LessonMcp { call: McpCall; close: () => Promise<void>; isClosed: () => boolean; }

// SEC-4: every lesson-mcp this extension starts (lesson panes, the @studium chat, notebook sessions, a status
// refresh) is registered here from the moment its subprocess is spawned, so erasing the learner's data can close
// all of them first: a server left running would write its profile, study record and state straight back.
const liveConnections = new Set<{ close: () => Promise<void> }>();
let paused: Promise<void> | null = null;

/** How many lesson-mcp subprocesses this extension currently owns (connecting or connected). */
export function liveLessonMcpCount(): number {
  return liveConnections.size;
}

/**
 * Run `action` with no lesson-mcp running: close every connection this extension owns (waiting until each
 * subprocess has exited), keep new connections waiting while `action` runs, then let them through. Used to
 * erase the learner's data (forgetMyData): nothing can write it back while it is deleted.
 */
export async function withLessonMcpPaused<T>(action: () => Promise<T> | T): Promise<T> {
  while (paused) await paused.catch(() => {});
  let release!: () => void;
  paused = new Promise<void>((resolve) => { release = resolve; });
  try {
    await Promise.all([...liveConnections].map((connection) => connection.close().catch(() => {})));
    return await action();
  } finally {
    paused = null;
    release();
  }
}

/** Connect an SDK client and close partial resources if startup fails. */
export async function connectOrClose<TTransport>(
  client: { connect: (transport: TTransport) => Promise<unknown>; close: () => Promise<unknown> },
  transport: TTransport,
): Promise<void> {
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

/** Connect to a fresh lesson-mcp subprocess. `call` throws on a tool error; `close` tears the transport
 *  down. The server's stderr is piped to `opts.log` (default: the Studium output channel) — never
 *  discarded, so a server that dies at startup is diagnosable. */
export async function connectLessonMcp(opts: { launch: ServerLaunch; env: Record<string, string>; log?: LogSink }): Promise<LessonMcp> {
  while (paused) await paused.catch(() => {}); // the learner's data is being erased: start after it is gone
  const log = resolveLogSink(opts.log);
  const { launch } = opts;
  const transport = new StdioClientTransport({ command: launch.command, args: launch.args, cwd: launch.cwd,
    env: { ...launch.env, ...opts.env }, stderr: "pipe" });
  forwardStderr(transport.stderr, log); // piped stderr is readable BEFORE start(): no early output lost
  const client = new Client({ name: "studium-vscode", version: "0.1.0" });
  let closing: Promise<void> | null = null;
  const entry = {
    close: (): Promise<void> => {
      closing ??= client.close().catch(() => {}).finally(() => { liveConnections.delete(entry); });
      return closing;
    },
  };
  liveConnections.add(entry);
  try {
    await connectOrClose(client, transport);
  } catch (error) {
    liveConnections.delete(entry);
    throw error;
  }
  if (closing) throw new Error("lesson-mcp: closed while connecting (the learner's data was being erased)");
  const call: McpCall = async (name, args) => parseToolResult(name, await client.callTool({ name, arguments: args }));
  return { call, close: entry.close, isClosed: () => closing !== null };
}
