import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionHost, ResponseInputSchema } from "@studium/lesson-session-host";
import type { ResponseInput } from "@studium/lesson-session";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
const text = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true });

/**
 * Builds the MCP server exposing the lesson-session loop as tools over a SessionHost.
 *
 * SDK API used (1.29.0): McpServer.registerTool(name, { description, inputSchema }, cb)
 * where inputSchema is a ZodRawShapeCompat (Record<string, ZodTypeAny>).
 * The discriminated-union ResponseInputSchema satisfies AnySchema and can appear as a
 * value in the ZodRawShapeCompat record for the `input` field.
 */
export function buildMcpServer(host: SessionHost): McpServer {
  const server = new McpServer({ name: "studium-lesson", version: "0.1.0" });

  server.registerTool(
    "start_lesson_session",
    {
      description: "Start a lesson session from a bundle_ref and return the first scene presentation.",
      inputSchema: { bundle_ref: z.string(), learner_id: z.string().optional() },
    },
    async ({ bundle_ref, learner_id }) => {
      try {
        const r = await host.create(bundle_ref, learner_id);
        return text({ session_id: r.sessionId, presentation: r.presentation });
      } catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "get_current_scene",
    {
      description: "Get the current scene/presentation for a session.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try { return text({ presentation: host.currentPresentation(session_id) }); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "submit_response",
    {
      description: "Submit a response to the current scene (ack | quiz_choice | confidence | critique); returns the transition (next/replay/calibration/complete).",
      inputSchema: { session_id: z.string(), input: ResponseInputSchema },
    },
    async ({ session_id, input }) => {
      try { return text({ transition: await host.respond(session_id, input as ResponseInput) }); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "get_scene_artifacts",
    {
      description: "Get the normalized render manifest (scene_assets[]) for the current scene — the " +
        "artifacts a UI pairs with this scene: {kind: image|svg|equation_latex|plot_spec|code|data_csv|" +
        "protocol_md|executed_result, title?, payload?, path?, meta?}. Empty for a plain quiz. A webview " +
        "calls this each turn to repaint the artifact pane in lockstep with the lesson.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try { return text({ scene_assets: host.sceneArtifacts(session_id) }); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "request_hint",
    {
      description: "Request the next authored hint for the current quiz scene. Returns {hint, index, remaining} " +
        "or {hint: null} when the scene is not a quiz, has no hints, or the per-visit hint cap is reached. " +
        "Each hint discounts the mastery credit of the eventual answer (M5 anti-offloading).",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try { return text({ hint: host.requestHint(session_id) }); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "submit_turn",
    {
      description: "Submit a free-text discussion turn; returns the scored reasoning signal and the Socratic tutor's reply move (so the client can render the dialogue turn-by-turn).",
      inputSchema: { session_id: z.string(), text: z.string() },
    },
    async ({ session_id, text: turn }) => {
      try {
        await host.submitTurn(session_id, turn);
        return text({ accepted: true, reasoning: host.lastReasoning(session_id), tutor: host.lastTutorMove(session_id) });
      }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "explain_last_adaptation",
    {
      description: "Explain the last adaptation decision (rule_id + modulator + short explanation), or null.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try { return text({ explanation: host.explainLast(session_id) }); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "get_session_state",
    {
      description: "Get the learner state (concept mastery, completed scenes, history) for a session.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try { return text({ state: host.getState(session_id) }); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "end_session",
    {
      description: "End a session: emits forget_requested and drops it (right to be forgotten).",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try { await host.forget(session_id); return text({ forgotten: true }); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  return server;
}
