// apps/lesson-mcp/src/companion-tools.ts
//
// get_companion_brief (INT-STUDIUM-058 § 2.5). A lesson is played on two lanes: on a panel, a pane or
// in forms the server answers the learner and no model writes; in the conversation an agent relays.
// When the learner turns to the agent after acts on the fast lane, the agent does not know what
// happened there. This tool tells it: where the learner is, the acts since it last looked, the help
// that is open, and three rules. It is the one tool the two-lane interface adds for the model (N10).
//
// The brief is built by the session host (lesson-session-host companion.ts) from the orientation and
// the acts it noted: ids, types, titles, durations and the outcome of answers already given. No scene
// text, key, hint or reference.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionHost } from "@studium/lesson-session-host";

export const COMPANION_TOOL_NAMES = ["get_companion_brief"] as const;

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** Register the companion tool on the MCP server; returns its name. */
export function registerCompanionTools(server: McpServer, host: SessionHost): string[] {
  server.registerTool("get_companion_brief", {
    description: "Read what the learner did on a panel, a pane or in forms since you last looked, before you answer " +
      "them. Call it at the learner's first message after such acts, instead of showing the scene again. Returns " +
      "{brief: {session_id, cursor, status_line, where{lesson_title, step{index, total}, scene{id, type, title}, " +
      "waiting}, since_last[{scene_id, act: read | answer | hint | self_rating | contest, lane: fast | companion, " +
      "correct?, confidence?}], since_last_count, help{rungs}, rules[3]}}. since_last holds the twelve latest acts; " +
      "since_last_count counts them all. Reading it moves the cursor: the next call lists what came after. It " +
      "holds no scene text and no key, hint or reference; follow its rules.",
    inputSchema: { session_id: z.string().min(1) },
  }, async ({ session_id }): Promise<ToolResult> => {
    try {
      return { content: [{ type: "text", text: JSON.stringify({ brief: host.companionBrief(session_id) }) }] };
    } catch (error) {
      return { content: [{ type: "text", text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
    }
  });
  return [...COMPANION_TOOL_NAMES];
}
