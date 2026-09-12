import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionHost } from "@studium/lesson-session-host";
import { lessonOperations } from "./operations.js";

/** Bind the common lesson operations to MCP without changing their public results. */
export function buildMcpServer(host: SessionHost): McpServer {
  const server = new McpServer({ name: "studium-lesson", version: "0.1.0" });
  for (const operation of lessonOperations(host)) {
    server.registerTool(operation.name, {
      description: operation.description, inputSchema: operation.inputSchema,
    }, async args => operation.invoke(args));
  }
  return server;
}
