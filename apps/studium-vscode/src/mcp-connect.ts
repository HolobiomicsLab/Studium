// mcp-connect.ts — spawn lesson-mcp over stdio and expose a typed call() + close(). Shared by the lesson
// panel (extension.ts) and the @studium chat participant (chat.ts) so the connection logic lives once.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

export type McpCall = (name: string, args: Record<string, any>) => Promise<Record<string, any>>;
export interface LessonMcp { call: McpCall; close: () => void; }

/** Connect to a fresh lesson-mcp subprocess. `call` throws on a tool error; `close` tears the transport down. */
export async function connectLessonMcp(opts: { tsx: string; mcpDir: string; env: Record<string, string> }): Promise<LessonMcp> {
  const transport = new StdioClientTransport({ command: opts.tsx, args: ["src/index.ts"], cwd: opts.mcpDir, env: opts.env, stderr: "ignore" });
  const client = new Client({ name: "studium-vscode", version: "0.1.0" });
  await client.connect(transport);
  const call: McpCall = async (name, args) => {
    const res: any = await client.callTool({ name, arguments: args });
    const data = JSON.parse(res.content?.[0]?.text ?? "{}");
    if (res.isError) throw new Error(`${name}: ${data.error}`);
    return data;
  };
  return { call, close: () => { client.close().catch(() => {}); } };
}
