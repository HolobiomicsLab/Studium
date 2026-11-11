import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SessionHost, resolvePersistence, type PersistenceConfig } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";
import { SERVER_VERSION } from "./build-info.js";
import { REPOSITORY_URL } from "./feedback.js";

export const MCP_SERVER_NAME = "studium-lesson";

/** The host the stdio server runs. The C6 defaults apply here, at the entry point only (decision
 * D4): lessons in ~/.studium/library, durable progress in ~/.studium/data; BUNDLES_ROOT,
 * STUDIUM_DATA_DIR, STUDIUM_HOME, STUDIUM_LEARNER_ID and STUDIUM_EPHEMERAL=1 override them
 * (persistence.ts). */
export function hostFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir(),
): { host: SessionHost; config: PersistenceConfig; live: boolean } {
  const config = resolvePersistence(env, home);
  const live = env["LITELLM_BASE_URL"] !== undefined && env["LITELLM_BASE_URL"] !== "";
  const host = new SessionHost({
    bundlesRoot: config.bundlesRoot, libraryRoot: config.libraryRoot, dataDir: config.dataDir,
    defaultLearnerId: config.learnerIdDefault, live,
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
  const answer = cliAnswer(argv);
  if (answer !== null) { process.stdout.write(answer); return; }
  const { host, config, live } = hostFromEnvironment();
  const server = buildMcpServer(host);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers communicate over stdio — do NOT write logs to stdout (it corrupts the JSON-RPC stream). Use stderr.
  process.stderr.write(`lesson-mcp started (bundlesRoot=${config.bundlesRoot}, library=${config.libraryRoot}, ` +
    `data=${config.dataDir ?? "memory only"}, live=${live})\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { process.stderr.write(`${String(e)}\n`); process.exit(1); });
}
