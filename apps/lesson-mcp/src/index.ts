import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SessionHost, resolvePersistence, type PersistenceConfig } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

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

export async function main(): Promise<void> {
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
