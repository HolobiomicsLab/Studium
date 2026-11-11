// Development-only Streamable HTTP → bundled stdio bridge; one local client, memory-only state.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../apps/lesson-mcp/package.json", import.meta.url));
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const schema = require("@modelcontextprotocol/sdk/types.js");
const root = fileURLToPath(new URL("../", import.meta.url));
const sessions = new Set();
const http = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) { response.writeHead(403).end(); return; }
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.host ?? "")) { response.writeHead(403).end(); return; }
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, mcp-protocol-version");
  response.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
  if (request.url !== "/mcp") { response.writeHead(404).end(); return; }
  let connection = [...sessions].find(item => item.transport.sessionId === request.headers["mcp-session-id"]);
  if (!connection) {
    if (request.headers["mcp-session-id"] || request.method !== "POST") { response.writeHead(404).end(); return; }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
    const server = new Server({ name: "studium-panel-dev", version: "0.6.1" }, { capabilities: { tools: {}, resources: {} } });
    let client, ready;
    server.oninitialized = () => {
      client = new Client({ name: "panel-http-dev", version: "1" }, { capabilities: server.getClientCapabilities() });
      ready = client.connect(new StdioClientTransport({ command: process.execPath, args: [`${root}apps/lesson-mcp/dist/studium-mcp.cjs`], env: { STUDIUM_EPHEMERAL: "1", BUNDLES_ROOT: `${root}fixtures`, LITELLM_BASE_URL: "" }, stderr: "pipe" }));
    };
    for (const [input, output] of [[schema.ListToolsRequestSchema, schema.ListToolsResultSchema], [schema.CallToolRequestSchema, schema.CallToolResultSchema], [schema.ListResourcesRequestSchema, schema.ListResourcesResultSchema], [schema.ReadResourceRequestSchema, schema.ReadResourceResultSchema]]) {
      server.setRequestHandler(input, async payload => { await ready; return client.request(payload, output); });
    }
    connection = { transport, server, close: async () => { await client?.close(); await server.close(); } };
    sessions.add(connection); transport.onclose = () => { sessions.delete(connection); void client?.close(); };
    await server.connect(transport);
  }
  try { await connection.transport.handleRequest(request, response); }
  catch (error) { if (!response.headersSent) response.writeHead(500).end(String(error)); }
});
http.listen(Number(process.env.PANEL_HTTP_PORT ?? 3001), "127.0.0.1", () => console.error(`Panel development MCP: http://127.0.0.1:${http.address().port}/mcp`));
async function stop() { http.closeAllConnections(); http.close(); await Promise.all([...sessions].map(connection => connection.close())); }
process.once("SIGINT", stop); process.once("SIGTERM", stop);
