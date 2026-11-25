import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SessionHost, resolvePersistence, type PersistenceConfig } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";
import { SERVER_VERSION } from "./build-info.js";
import { REPOSITORY_URL } from "./feedback.js";
import { runPlay } from "./play.js";
import { browserPlayerWanted, servedPlayer } from "./served-player.js";

export const MCP_SERVER_NAME = "studium-lesson";

/** The folder of the lessons shipped with Studium, beside the server: `shipped-lessons/` next to the bundled
 * script (dist/lesson-mcp.cjs in the VS Code extension, studium-mcp.cjs in the npm package), or
 * apps/lesson-mcp/shipped-lessons when the server runs from its sources (src/index.ts). The npm bin is a
 * link, so the script's real path is used. STUDIUM_SHIPPED_LESSONS names another folder, or `off` for none.
 * Null when there is none: a lone lesson-mcp.cjs copied elsewhere ships no lesson. */
export function shippedLessonsRoot(opts: {
  scriptPath: string | undefined;
  env?: Readonly<Record<string, string | undefined>>;
  exists?: (path: string) => boolean;
  realpath?: (path: string) => string;
}): string | null {
  const exists = opts.exists ?? existsSync;
  const configured = opts.env?.["STUDIUM_SHIPPED_LESSONS"]?.trim();
  if (configured) return ["off", "none", "0", "false"].includes(configured.toLowerCase()) ? null : resolve(configured);
  if (!opts.scriptPath) return null;
  let script: string;
  try { script = (opts.realpath ?? realpathSync)(opts.scriptPath); } catch { script = resolve(opts.scriptPath); }
  const dir = dirname(script);
  const candidate = script.endsWith(".ts") && basename(dir) === "src" ? join(dir, "..", "shipped-lessons") : join(dir, "shipped-lessons");
  return exists(candidate) ? resolve(candidate) : null;
}

/** The host the stdio server runs. The C6 defaults apply here, at the entry point only (decision
 * D4): lessons in ~/.studium/library, durable progress in ~/.studium/data; BUNDLES_ROOT,
 * STUDIUM_DATA_DIR, STUDIUM_HOME, STUDIUM_LEARNER_ID and STUDIUM_EPHEMERAL=1 override them
 * (persistence.ts). STUDIUM_OPEN_LINK says the VS Code extension serves it (D1, D2). `browserLink`: the address of
 * the server's browser player (served-player.ts), which main gives when STUDIUM_OPEN_LINK is unset (owner decision 4). */
export function hostFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir(),
  opts: { shippedRoot?: string | null; browserLink?: (learnerId: string, bundleRef: string) => Promise<string | null> } = {},
): { host: SessionHost; config: PersistenceConfig; live: boolean } {
  const config = resolvePersistence(env, home);
  const live = env["LITELLM_BASE_URL"] !== undefined && env["LITELLM_BASE_URL"] !== "";
  // D1/D2 (waiting review 2026-11-25): the Studium VS Code extension starts the server it offers to Copilot with
  // STUDIUM_OPEN_LINK (how to open a lesson in its pane) and the pane's STUDIUM_LEARNER_ID: that learner is then the
  // only one, and the lessons are offered in the pane first.
  const openLink = env["STUDIUM_OPEN_LINK"]?.trim() || undefined;
  const editorNamesLearner = openLink !== undefined && !!env["STUDIUM_LEARNER_ID"]?.trim();
  const host = new SessionHost({
    bundlesRoot: config.bundlesRoot, libraryRoot: config.libraryRoot, dataDir: config.dataDir,
    defaultLearnerId: config.learnerIdDefault, live,
    ...(opts.shippedRoot ? { shippedRoot: opts.shippedRoot } : {}),
    ...(openLink ? { openLink } : {}),
    ...(editorNamesLearner ? { editorNamesLearner } : {}),
    ...(opts.browserLink && !openLink ? { browserLink: opts.browserLink } : {}),
  });
  return { host, config, live };
}

const HELP = `studium-mcp ${SERVER_VERSION}

The Studium lesson server. It is started by an AI assistant over stdio (Model Context Protocol):
you add it to your assistant once, then ask the assistant to learn or review with Studium.

Add it to an assistant
  Claude Code     claude mcp add --scope user studium -- npx -y studium-mcp
  Codex           codex mcp add studium -- npx -y studium-mcp
  VS Code         code --add-mcp '{"name":"studium","command":"npx","args":["-y","studium-mcp"]}'
  Other clients   command "npx", arguments ["-y", "studium-mcp"], transport stdio
  If your shell defines LITELLM_BASE_URL, give the server an empty one so that it calls no model.

Play lessons in a web browser, without an assistant (experimental)
  npx -y studium-mcp play [folder]     opens the browser on 127.0.0.1; studium-mcp play --help

Options
  -v, --version   print the version and exit
  -h, --help      print this help and exit
  (none)          start the server on stdio; it then waits for an MCP client

Environment
  STUDIUM_HOME        where lessons and progress live (default ~/.studium)
  BUNDLES_ROOT        a folder of lessons looked up first, for example a teacher's course
  STUDIUM_DATA_DIR    where progress and reviews are kept (default <STUDIUM_HOME>/data)
  STUDIUM_EPHEMERAL   1 keeps everything in memory: nothing is written
  STUDIUM_LEARNER_ID  the learner id used when a call names none (default anonymous)
  STUDIUM_OPEN_LINK   set by the Studium VS Code extension: the start of a link that opens a lesson
                      in its pane; lessons are then offered there first, and with STUDIUM_LEARNER_ID
                      that learner is the only one (a learner_id passed is ignored)
  STUDIUM_SHIPPED_LESSONS  the lessons shipped with Studium (default: shipped-lessons/ beside
                      the server); off for none
  STUDIUM_BROWSER_PLAYER  off: never start the browser player. Otherwise, without STUDIUM_OPEN_LINK,
                      the server starts it on 127.0.0.1 the first time it offers a lesson, and the
                      assistant shows its address; the address lives as long as this server
  LITELLM_BASE_URL    a judge model endpoint; empty (the default) calls no model

Guide and issues  ${REPOSITORY_URL}
`;

/** What the command answers without starting the server: the version, the help, or null to start.
 * An unknown argument starts the server, as before: harness configurations pass none. */
export function cliAnswer(argv: readonly string[]): string | null {
  if (argv.includes("--version") || argv.includes("-v")) return `${SERVER_VERSION}\n`;
  if (argv.includes("--help") || argv.includes("-h")) return HELP;
  return null;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (argv[0] === "play") { await runPlay(argv.slice(1)); return; }
  const answer = cliAnswer(argv);
  if (answer !== null) { process.stdout.write(answer); return; }
  const shipped = shippedLessonsRoot({ scriptPath: process.argv[1], env: process.env });
  // Owner decision 4: no VS Code pane, the server's own browser player, started on first need (served-player.ts).
  // The player reads the host when it starts, after the host exists: on the first lesson offered.
  const served: { host?: SessionHost } = {};
  const player = browserPlayerWanted(process.env)
    ? servedPlayer({ host: () => served.host!, log: (line) => process.stderr.write(line) }) : null;
  const { host, config, live } = hostFromEnvironment(process.env, homedir(), {
    shippedRoot: shipped, ...(player ? { browserLink: (learnerId: string, bundleRef: string) => player.linkFor(learnerId, bundleRef) } : {}),
  });
  served.host = host;
  const server = buildMcpServer(host);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers communicate over stdio — do NOT write logs to stdout (it corrupts the JSON-RPC stream). Use stderr.
  process.stderr.write(`lesson-mcp started (bundlesRoot=${config.bundlesRoot}, library=${config.libraryRoot}, ` +
    `data=${config.dataDir ?? "memory only"}, shipped=${shipped ?? "none"}, live=${live}, browser=${player ? "on first need" : "off"})\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { process.stderr.write(`${String(e)}\n`); process.exit(1); });
}
