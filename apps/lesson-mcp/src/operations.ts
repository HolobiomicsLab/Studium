import { z } from "zod";
import {
  SessionHost, ResponseInputSchema, ExperimentInputSchema, RunResultSchema, NowMsSchema, publicPresentation, publicTransition,
  operatorContext,
} from "@studium/lesson-session-host";
import type { ResponseInput } from "@studium/lesson-session";
import { getBuildInfo, SERVER_VERSION } from "./build-info.js";

export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type ReinforcementStatus = Awaited<ReturnType<SessionHost["reinforcementStatusForSession"]>>;
type RoutedReinforcementTarget = ReinforcementStatus["due"][number];
const text = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true });

function transportTarget(target: RoutedReinforcementTarget): RoutedReinforcementTarget {
  return { ...target, due_at: Math.round(target.due_at) };
}

/** L-8 (H3): every review due counts — mastered concepts to recall, weak ones to relearn, self-rated
 * ones never measured — in `reason`, in `counts` and in `reinforcement` (the first of them), so a status
 * bar agrees with get_study_plan and start_review_session. */
function reinforcementResult(status: ReinforcementStatus): Record<string, unknown> {
  const due = status.due.map(transportTarget);
  // Reviewed concepts still below the gate after graded attempts (the study plan's « À reprendre »).
  const relearn = status.relearn.map(transportTarget);
  // Reviewed concepts no graded attempt measured, due for review (« À revoir »), never called weak.
  const unmeasured = status.unmeasured.map(transportTarget);
  const total = due.length + relearn.length + unmeasured.length;
  const reason = total > 0 ? "due" : status.has_history ? "nothing_due" : "no_history";
  return {
    reinforcement: due[0] ?? relearn[0] ?? unmeasured[0] ?? null,
    due,
    relearn,
    unmeasured,
    counts: { due: due.length, relearn: relearn.length, unmeasured: unmeasured.length, total },
    reason,
    next_due_at: reason === "nothing_due" && status.next_due_at !== null
      ? Math.round(status.next_due_at) : null,
  };
}

export const TOOL_NAMES = [
  "close_peer_room",
  "end_session",
  "explain_last_adaptation",
  "forget_session",
  "get_current_scene",
  "get_experiment_journal",
  "get_next_reinforcement",
  "get_operator_context",
  "get_peer_room_state",
  "get_run_manifest",
  "get_scene_artifacts",
  "get_server_info",
  "get_session_state",
  "get_workflow_graph",
  "join_peer_room",
  "list_community_bundles",
  "open_peer_room",
  "record_experiment",
  "request_hint",
  "set_session_language",
  "start_lesson_session",
  "submit_peer_rating",
  "submit_response",
  "submit_run_result",
  "submit_turn",
] as const;

export interface Operation {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  invoke: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface LessonOperationsOptions {
  /** The tools the surface actually registers, which get_server_info lists (sorted). The MCP server
   * passes its full list (lesson, study, authoring and teacher tools); without it, TOOL_NAMES. */
  toolNames?: () => readonly string[];
}

/** Build transport-independent operations using the canonical host and schemas. */
export function lessonOperations(host: SessionHost, opts: LessonOperationsOptions = {}): Operation[] {
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

  server.registerTool("get_server_info", {
    description: "Describe this Studium MCP server build, runtime configuration, and complete tool surface.",
    inputSchema: {},
  }, async () => {
    const persistence = host.persistence();
    return text({
      name: "studium-lesson",
      version: SERVER_VERSION,
      build: getBuildInfo(),
      tools: [...(opts.toolNames?.() ?? TOOL_NAMES)].sort(),
      bundles_root: host.bundlesRoot,
      data_dir: persistence.data_dir,
      // C6: where lessons and learner data live, and the warning to relay when nothing is durable.
      persistence,
      // RFR-13: every date Studium returns (yyyy-mm-dd) and prints is a day in this IANA time zone.
      time_zone: host.timeZone,
      model_backend: process.env["LITELLM_BASE_URL"] ? "configured" : "none",
    });
  });

  server.registerTool("get_operator_context", {
    description: "Get the current public scene, resolved display assets, run instructions and response contract " +
      "for an external harness creating a custom viewer or example. Read-only: Studium never executes viewer code. " +
      "In teaching mode collect the learner's judgment and confidence; do not answer for them. A reference_result " +
      "or executed_result is EVIDENCE the learner judges against, not an answer key.",
    inputSchema: { session_id: z.string() },
  }, async ({ session_id }) => {
    try { return text(operatorContext(host, session_id)); }
    catch (e) { return fail((e as Error).message); }
  });

  server.registerTool(
    "list_community_bundles",
    {
      description: "List the approved community (learner-authored) bundles under BUNDLES_ROOT as " +
        "{bundles:[{bundle_ref, course_id, item_id}]}. With course_id, only <course_id>/community/; without, " +
        "the legacy root-level community/ (course_id null) plus every course directory's. Each bundle_ref " +
        "passes unchanged to start_lesson_session. course_id must match ^[a-z0-9][a-z0-9._-]{0,63}$.",
      inputSchema: { course_id: z.string().optional() },
    },
    async ({ course_id }) => {
      try { return text({ bundles: await host.listCommunityBundles(course_id) }); }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "start_lesson_session",
    {
      description: "Start or resume a lesson session and report whether it is new, resumed, or completed. " +
        "A completed lesson starts at scene zero as a retake and includes due profile-backed review targets. " +
        "The authoring block (also on every presentation) says who wrote the lesson; when authoring.notice " +
        "is set (a self-authored lesson), show it to the learner. " +
        "Optionally select a BCP 47 presentation_language; when omitted, use the bundle's source language. " +
        "With now_ms the session runs on a clock anchored there: its answers, ratings and reviews are dated from it. " +
        "concept_map is the lesson's concept map as the session opens (see get_workflow_graph); the first presentation's display_markdown already shows it.",
      inputSchema: {
        bundle_ref: z.string(), learner_id: z.string().optional(), now_ms: NowMsSchema.optional(),
        presentation_language: z.string().optional(),
      },
    },
    async ({ bundle_ref, learner_id, now_ms, presentation_language }) => {
      try {
        const r = await host.create(bundle_ref, learner_id, {
          ...(now_ms === undefined ? {} : { nowMs: now_ms }),
          ...(presentation_language === undefined ? {} : { presentationLanguage: presentation_language }),
        });
        // Redact the answer key (quiz `correct`, claims/key_points/cues, model_* reveals) at the
        // client boundary — the server keeps the full scene; only this projection ships.
        return text({
          session_id: r.sessionId,
          authoring: r.authoring,
          presentation: publicPresentation(r.presentation),
          ...(r.concept_map ? { concept_map: r.concept_map } : {}),
          language: operatorContext(host, r.sessionId).language,
          resume: r.resume,
          persistence: r.persistence,
          ...(r.due ? { due: r.due.map(transportTarget) } : {}),
        });
      } catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "get_current_scene",
    {
      description: "Get the current public scene/presentation for a session. Any reference_result or " +
        "executed_result is EVIDENCE to judge against, not an answer key; answer-bearing fields remain redacted.",
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
      description: "Submit a response to the current scene: {session_id, input}. In a chat, send the learner's own " +
        "words as input {kind:\"reply\", text}, that is submit_response {session_id, input: {kind:\"reply\", text}}: " +
        "Studium maps them to the scene's answer (a choice letter, alone or followed by the learner's reason, or " +
        "the choice text; a confidence; a free-text answer) and refuses a reply naming two choices. A scene " +
        "carrying run_manifest requires " +
        "get_run_manifest, an actual run, and submit_run_result first. Lesson quiz choices keep a deterministic " +
        "order for each learner, including on resume. Review choices are shuffled and relettered by learner and " +
        "review day in the host's time zone; an open review keeps its letters. Send the DISPLAYED choice id, never " +
        "a memorized source id. Confidence checkpoints accept " +
        "{kind:\"confidence\", pre, post} (legacy value remains accepted). Returns next/replay/remediate_alt/" +
        "remediate/calibration/complete with verdict and navigation; navigation.returns_to is the scene resumed " +
        "after the detour. A complete summary documents skipped_scene_ids, scenes_detoured, and mastery. Show " +
        "verdict.display_markdown first, then the transition's display_markdown. At a few moments the transition " +
        "carries concept_map (see get_workflow_graph), with moment start/new_concept/detour/detour_return/synthesis/complete " +
        "and show map/line; display_markdown already includes the list or the position line. A harness that draws " +
        "diagrams may render concept_map.mermaid in place of the list.",
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
        "protocol_md|executed_result, title?, payload?, path?, legend?: [{symbol, meaning}], meta?}. Empty for a plain quiz. A webview " +
        "calls this each turn to repaint the artifact pane in lockstep with the lesson. reference_result and " +
        "executed_result are EVIDENCE to judge against, not an answer key.",
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
        "whose recall is decaying), plus every due target in priority order. With session_id it unions " +
        "session and cross-lesson profile memory; learner_id works without a live session. " +
        "Returns reinforcement (the first of due, else of relearn, else of unmeasured), due, relearn (graded " +
        "weak), unmeasured (self-rated only), counts {due, relearn, unmeasured, total}, reason " +
        "(due|nothing_due|no_history: due when any of the three lists is not empty), and next_due_at. " +
        "`now_ms` (epoch ms) is injectable for deterministic review scheduling; defaults to the session's clock " +
        "with session_id, else the server clock.",
      inputSchema: {
        session_id: z.string().min(1).optional(),
        learner_id: z.string().min(1).optional(),
        now_ms: NowMsSchema.optional(),
      },
    },
    async ({ session_id, learner_id, now_ms }) => {
      try {
        if (session_id === undefined && learner_id === undefined) {
          return fail("at least one of session_id or learner_id is required");
        }
        const status = session_id !== undefined
          ? await host.reinforcementStatusForSession(session_id, now_ms)
          : await host.reinforcementStatusForLearner(learner_id, now_ms);
        return text(reinforcementResult(status));
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
        "provisions the env, installs the deps, runs `cmd` IN THE WORKSPACE, then calls submit_run_result. " +
        "`learner_run_recorded: true` means this session already holds the learner's attested run for this " +
        "scene (a revisit after a detour): re-run if you want a fresh result, or submit_response {kind:\"ack\"} to continue.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try { return text(host.runStatus(session_id)); }
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
        "Each hint discounts the mastery credit of the eventual answer (M5 anti-offloading). When the lesson " +
        "has already given a legend for the symbols of this scene's concepts, the reply also carries " +
        "notation: [{symbol, meaning}] — a reminder of what was shown, not a hint: it is never metered and " +
        "stays available once the hints are spent.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try {
        const hint = host.requestHint(session_id);
        const notation = host.sceneNotation(session_id);
        return text({ hint, ...(notation.length ? { notation } : {}) });
      }
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
        "A graph webview repaints this each turn; the same payload drives a teacher (full) or student (ego) view. null when the bundle has no LWG. " +
        "Also returns concept_map, the learner's map drawn from what this session served and how it was answered " +
        "(studium/concept-map/v1): nodes with state acquired/to_review/current/seen/upcoming and the questions asked with their step, " +
        "prerequisite edges, position {from, at, next}, a Mermaid flowchart and display_markdown. Show it when the learner asks where they are; " +
        "start_lesson_session and submit_response already carry it at the moments worth showing it. null for a review session or a lesson with fewer than two concepts.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try { return text({ graph: host.workflowGraph(session_id), concept_map: host.conceptMap(session_id) }); }
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
      description: "Closes a session and keeps durable lesson state and cross-lesson memory. " +
        "Use forget_session for irreversible erasure. When the progress could not be saved, the reply says " +
        "state_kept: false with a persistence_warning to pass on to the learner.",
      inputSchema: { session_id: z.string() },
    },
    async ({ session_id }) => {
      try {
        // L-11 (CC-6): a close whose write-through failed still closes, and says the state was not kept.
        const closed = await host.close(session_id);
        return text(closed.persistence_warning
          ? { closed: true, state_kept: false, persistence_warning: closed.persistence_warning }
          : { closed: true, state_kept: true });
      }
      catch (e) { return fail((e as Error).message); }
    },
  );

  server.registerTool(
    "forget_session",
    {
      description: "Right to be forgotten; irreversible. Pass exactly one of session_id or learner_id. With session_id: " +
        "erases this learner's durable state for this lesson AND the cross-lesson profile and review schedule. With " +
        "learner_id (no live session needed): every lesson's progress too, and the learner's live sessions close. " +
        "Returns {forgotten, scope: lesson|learner, erased: [{kind, lessons?}], kept: [{kind, lessons?, path?}], " +
        "display_markdown}: kept names what stays on disk (the library's lessons and their sources); show " +
        "display_markdown to the learner. To merely close, use end_session.",
      inputSchema: { session_id: z.string().min(1).optional(), learner_id: z.string().min(1).max(200).optional() },
    },
    async ({ session_id, learner_id }) => {
      try {
        if ((session_id === undefined) === (learner_id === undefined)) return fail("pass exactly one of session_id or learner_id");
        return text(session_id !== undefined ? await host.forget(session_id) : await host.forgetLearner(learner_id));
      }
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
