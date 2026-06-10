import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

export const MCP_SERVER_NAME = "studium-lesson";

export async function main(): Promise<void> {
  const bundlesRoot = process.env["BUNDLES_ROOT"] ?? process.cwd();
  const live = process.env["LITELLM_BASE_URL"] !== undefined && process.env["LITELLM_BASE_URL"] !== "";
  const host = new SessionHost({ bundlesRoot, live });
  const server = buildMcpServer(host);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers communicate over stdio — do NOT write logs to stdout (it corrupts the JSON-RPC stream). Use stderr.
  process.stderr.write(`lesson-mcp started (bundlesRoot=${bundlesRoot}, live=${live})\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { process.stderr.write(`${String(e)}\n`); process.exit(1); });
}
