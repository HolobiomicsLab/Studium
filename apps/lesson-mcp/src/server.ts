import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionHost, ResponseInputSchema, publicPresentation, publicTransition } from "@studium/lesson-session-host";
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
        // Redact the answer key (quiz `correct`, claims/key_points/cues, model_* reveals) at the
        // client boundary — the server keeps the full scene; only this projection ships.
        return text({ session_id: r.sessionId, presentation: publicPresentation(r.presentation) });
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
      try { return text({ presentation: publicPresentation(host.currentPresentation(session_id)) }); }
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
      try { return text({ transition: publicTransition(await host.respond(session_id, input as ResponseInput)) }); }
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
    "get_workflow_graph",
    {
      description: "Get the Learning Workflow Graph for the session as a normalized GraphView with " +
        "LIVE per-concept state (mastered/current/available/locked) from the learner's running mastery. " +
        "Shape: {schema, domain, title?, nodes:[{id,type,label,group?,state?,value?}], edges:[{id,source,target,type}], focus?, legend?}. " +
        "A graph webview repaints this each turn; the same payload drives a teacher (full) or student (ego) view. null when the bundle has no LWG.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try { return text({ graph: host.workflowGraph(session_id) }); }
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

  // ---------------------------------------------------------------------------
  // D1 PeerStudio — ephemeral room tools
  // ---------------------------------------------------------------------------

  server.registerTool(
    "open_peer_room",
    {
      description: "Teacher opens a PeerStudio room for a bundle. Returns a human-typable join_code for learners and a secret teacher_key for room management. The room is ephemeral and in-memory; close it with close_peer_room when the session ends.",
      inputSchema: { bundle_ref: z.string() },
    },
    async ({ bundle_ref }) => {
      try { return text(host.openRoom(bundle_ref)); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "join_peer_room",
    {
      description: "Learner joins an open PeerStudio room using the 6-character join_code the teacher provided, linking their active session into the room for peer review.",
      inputSchema: { join_code: z.string(), session_id: z.string() },
    },
    async ({ join_code, session_id }) => {
      try { return text(host.joinRoom(join_code, session_id)); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "submit_peer_rating",
    {
      description: "Learner submits a peer rating for another session's response. Returns whether the target is still k-suppressed (fewer than 3 independent ratings) and the current rating count k.",
      inputSchema: {
        room_id: z.string(),
        rater_session_id: z.string(),
        target_session_id: z.string(),
        passed: z.boolean(),
        rating: z.number().int().min(1).max(5),
        helpful: z.boolean(),
      },
    },
    async ({ room_id, rater_session_id, target_session_id, passed, rating, helpful }) => {
      try {
        return text(host.submitRoomRating(room_id, rater_session_id, target_session_id, { passed, rating, helpful }));
      }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "get_peer_room_state",
    {
      description: "Teacher reads the current PeerStudio room state: session count, rating count, and k-suppressed per-target aggregates (passed_rate, avg_rating, avg_helpful). Gated by the teacher_key.",
      inputSchema: { room_id: z.string(), teacher_key: z.string() },
    },
    async ({ room_id, teacher_key }) => {
      try { return text(host.getRoomState(room_id, teacher_key)); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "close_peer_room",
    {
      description: "Teacher closes the PeerStudio room. Returns the final k-suppressed aggregates for each target that reached the 3-rater floor. The caller may forward these aggregates to the scene-synth /decide_item endpoint to promote approved learner responses into the community bundle. Gated by the teacher_key.",
      inputSchema: { room_id: z.string(), teacher_key: z.string() },
    },
    async ({ room_id, teacher_key }) => {
      try { return text(host.closeRoom(room_id, teacher_key)); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  return server;
}
