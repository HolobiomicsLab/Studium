import { z } from "zod";
import { SessionHost, ResponseInputSchema, ExperimentInputSchema, RunResultSchema, publicPresentation, publicTransition, operatorContext } from "@studium/lesson-session-host";
import type { ResponseInput } from "@studium/lesson-session";

export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
const text = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true });

export interface Operation {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  invoke: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/** Build transport-independent operations using the canonical host and schemas. */
export function lessonOperations(host: SessionHost): Operation[] {
  const operations: Operation[] = [];
  const server = {
    registerTool<S extends z.ZodRawShape>(name: string, config: {description: string; inputSchema: S}, callback: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>) {
      operations.push({name, ...config, invoke: async args => callback(z.object(config.inputSchema).strict().parse(args))});
    },
  };

  server.registerTool("record_experiment", {
    description: "Record a consenting learner's own prediction, begin, observation or conclusion in the private " +
      "experiment journal. Preserve their exact words; never substitute assistant text. No grading or scene advance. " +
      "Predict before beginning an experiment; use the same experiment_id for later contributions.",
    inputSchema: { session_id: z.string(), scene_id: z.string(), input: ExperimentInputSchema },
  }, async ({ session_id, scene_id, input }) => {
    try {
      if (host.currentPresentation(session_id).scene.id !== scene_id) return fail("Stale experiment action: scene changed");
      return text(host.recordExperiment(session_id, input));
    }
    catch (e) { return fail((e as Error).message); }
  });
  server.registerTool("get_experiment_journal", {
    description: "Read this learner's private experiment contributions to resume across harnesses. " +
      "Contains learner text; do not share with teacher analytics or another learner. No grading.",
    inputSchema: { session_id: z.string() },
  }, async ({ session_id }) => {
    try { return text(host.experimentJournal(session_id)); }
    catch (e) { return fail((e as Error).message); }
  });

  server.registerTool("get_operator_context", {
    description: "Get the current public scene, resolved display assets, run instructions and response contract " +
      "for an external harness creating a custom viewer or example. Read-only: Studium never executes viewer code. " +
      "In teaching mode collect the learner's judgment and confidence; do not answer for them.",
    inputSchema: { session_id: z.string() },
  }, async ({ session_id }) => {
    try { return text(operatorContext(host, session_id)); }
    catch (e) { return fail((e as Error).message); }
  });

  server.registerTool("set_session_language", {
    description: "Set this session's presentation language as a BCP 47 tag, or null to use the bundle's source language. " +
      "This changes only harness presentation instructions; source content and learner responses remain unchanged.",
    inputSchema: { session_id: z.string(), presentation_language: z.string().nullable() },
  }, async ({ session_id, presentation_language }) => {
    try {
      host.setPresentationLanguage(session_id, presentation_language);
      return text({ language: operatorContext(host, session_id).language });
    }
    catch (e) { return fail((e as Error).message); }
  });

  server.registerTool(
    "start_lesson_session",
    {
      description: "Start a lesson session from a bundle_ref and return the first public presentation. " +
        "Optionally select a BCP 47 presentation_language; when omitted, use the bundle's source language.",
      inputSchema: {
        bundle_ref: z.string(), learner_id: z.string().optional(), presentation_language: z.string().optional(),
      },
    },
    async ({ bundle_ref, learner_id, presentation_language }) => {
      try {
        const r = await host.create(bundle_ref, learner_id, presentation_language);
        // Redact the answer key (quiz `correct`, claims/key_points/cues, model_* reveals) at the
        // client boundary — the server keeps the full scene; only this projection ships.
        return text({
          session_id: r.sessionId,
          presentation: publicPresentation(r.presentation),
          language: operatorContext(host, r.sessionId).language,
        });
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
    "get_next_reinforcement",
    {
      description: "FSRS ROUTER: the single most-urgent concept to REINFORCE now (mastered earlier but " +
        "whose recall is decaying), with the bundle scene that addresses it — or null when nothing is due. " +
        "A native driver calls this to route the learner to a spaced-repetition pass instead of advancing " +
        "linearly. Returns {reinforcement: {concept_id, scene_id, due_at, retrievability} | null}. " +
        "`now_ms` (epoch ms) is injectable for deterministic review scheduling; defaults to wall-clock.",
      inputSchema: { session_id: z.string(), now_ms: z.number().optional() },
    },
    async ({ session_id, now_ms }) => {
      try {
        const nowMs = now_ms ?? Date.now();
        const target = host.nextReinforcement(session_id, nowMs);
        const scene_id = target ? host.nextReinforcementScene(session_id, nowMs) : null;
        return text({ reinforcement: target ? { ...target, scene_id } : null });
      } catch (e) { return fail((e as Error).message); }
    },
  );

  // ---------------------------------------------------------------------------
  // Learner-time RUN protocol — MCP parity with the file channel (.studium-session/ run.json /
  // run_result.json). Studium NEVER executes: the operator provisions + runs the capsule in the
  // workspace, then submits the result. The native VS Code surface drives the run + judgment loop here.
  // ---------------------------------------------------------------------------

  server.registerTool(
    "get_run_manifest",
    {
      description: "Get the learner-time RUN manifest for the current scene — the provisioning/run " +
        "instructions {capsule_ref, cmd, working_dir?, timeout_s?, requirements?, expected_outputs[], " +
        "verify_checks[], research_question?} — when the current scene is a reproduction the LEARNER must " +
        "run, else null. NON-answer-bearing (no expected values, no author landmark): the operator " +
        "provisions the env, installs the deps, runs `cmd` IN THE WORKSPACE, then calls submit_run_result.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try { return text({ run_manifest: host.runManifest(session_id) }); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "submit_run_result",
    {
      description: "Submit the result of the learner running the capsule in the workspace (Studium NEVER " +
        "executes). Gates advance on ran && passed: a passing run records the learner's OWN executed " +
        "result (so a later judgment scene is grounded on it) and advances; a ran:false / failed-checks " +
        "run does NOT advance. Returns {status: ran|run_incomplete|run_failed_checks|not_a_run_scene, " +
        "learner_run_recorded, transition?} — transition (redacted) present only on a passing run.",
      inputSchema: { session_id: z.string(), run_result: RunResultSchema },
    },
    async ({ session_id, run_result }) => {
      try {
        const r = await host.ingestRunResult(session_id, run_result);
        return text({
          status: r.status,
          learner_run_recorded: r.learnerRunRecorded,
          // Attestation: an unverifiable run advances but is quarantined from grounding a judgment
          // (so it never feeds trust_calibration). Surfaced so a driver/teacher can see quarantined runs.
          attested: r.attested,
          attestation_reasons: r.attestationReasons,
          transition: r.transition ? publicTransition(r.transition) : null,
        });
      } catch (e) { return fail((e as Error).message); }
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

  return operations;
}
