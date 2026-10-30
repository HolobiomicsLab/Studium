import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionHost } from "@studium/lesson-session-host";
import { lessonOperations, TOOL_NAMES } from "./operations.js";
import { getBuildInfo, SERVER_VERSION } from "./build-info.js";
export { TOOL_NAMES } from "./operations.js";

let hasLoggedStartup = false;

function logStartup(): void {
  if (hasLoggedStartup) return;
  const build = getBuildInfo();
  process.stderr.write(
    `[studium-lesson] v${SERVER_VERSION} ${build.origin} ${build.built_at ?? "unbuilt"} tools=${TOOL_NAMES.length}\n`,
  );
  hasLoggedStartup = true;
}


/** Bind the common lesson operations to MCP without changing their public results. */
export function buildMcpServer(host: SessionHost): McpServer {
  const server = new McpServer({ name: "studium-lesson", version: SERVER_VERSION });
  logStartup();
  for (const operation of lessonOperations(host)) {
    server.registerTool(operation.name, {
      description: operation.description, inputSchema: operation.inputSchema,
    }, async args => operation.invoke(args));
  }
  return server;
}
