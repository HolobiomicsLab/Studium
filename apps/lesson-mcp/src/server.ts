// apps/lesson-mcp/src/server.ts
//
// The Studium MCP server: the lesson operations (operations.ts), the tools of the 2026-10-30
// production sprint (contract C1) — the study tools defined here (list_lessons, get_study_plan,
// start_review_session, rate_recall, and export_concept_map since 2026-11-06), the authoring tools (authoring-tools.ts: get_authoring_guide,
// prepare_sources, create_lesson) and the teacher tools (teacher-tools.ts: review_lesson,
// class_report) — the instructions a harness reads at connection, and the `learn` and `review`
// prompts. get_server_info lists exactly the tools registered here.
//
// Lead decision I-11 keeps authoring, teacher and most study tools MCP-only. Owner exception of
// 2026-11-05: HTTP also exposes rate_recall because its own lesson transition requests that rating;
// http.ts and http.test.ts pin the exact 25 lesson + 1 study operation surface.
import { z } from "zod";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SelfRatingExpiredError } from "@studium/lesson-session";
import {
  SessionHost, NowMsSchema, publicPresentation, operatorContext, type SelfRating, type PromptSurface,
} from "@studium/lesson-session-host";
import {
  CONVERSATION, lessonOperations, TOOL_NAMES as LESSON_TOOL_NAMES, type Operation, type SurfaceRank, type ToolResult,
} from "./operations.js";
import { AUTHORING_TOOL_NAMES, registerAuthoringTools } from "./authoring-tools.js";
import { TEACHER_TOOL_NAMES, registerTeacherTools } from "./teacher-tools.js";
import { FORM_TOOL_NAMES, registerFormTools } from "./form-tools.js";
import { COMPANION_TOOL_NAMES, registerCompanionTools } from "./companion-tools.js";
import { getBuildInfo, SERVER_VERSION } from "./build-info.js";
import { PANEL_TOOL_NAMES, registerPanelTools } from "./panel-tools.js";

/** C1 study tools, defined in this file. */
export const STUDY_TOOL_NAMES = ["export_concept_map", "get_study_plan", "list_lessons", "rate_recall", "start_review_session"] as const;
/** Every tool buildMcpServer registers, sorted: the lesson operations, the study tools, the authoring
 * tools, the teacher tools, the form tool (form-tools.ts, a prototype), the panel tools (panel-tools.ts)
 * and the companion tool (companion-tools.ts). */
export const TOOL_NAMES: readonly string[] = [
  ...LESSON_TOOL_NAMES, ...STUDY_TOOL_NAMES, ...AUTHORING_TOOL_NAMES, ...TEACHER_TOOL_NAMES, ...FORM_TOOL_NAMES, ...PANEL_TOOL_NAMES,
  ...COMPANION_TOOL_NAMES,
].sort();

/** C4 self-rating grades, in FSRS order (lesson-session's SELF_RATING_CHOICES; a test pins the match). */
export const RECALL_GRADES = ["again", "hard", "good", "easy"] as const satisfies readonly SelfRating[];

/** The reply call written the way submit_response takes it (RT-8a): the instructions and both prompts
 * use it, so a harness that follows them literally sends a valid call. */
export const REPLY_CALL = "submit_response {session_id, input: {kind: \"reply\", text}}";

/** What a harness reads once, at connection (MCP `instructions`). */
export const SERVER_INSTRUCTIONS = [
  "Studium teaches through the learner's own answers: you relay, the learner answers.",
  "- Start with get_study_plan: its next_step names the call to make and its arguments (start_review_session, start_lesson_session, or the authoring tools).",
  "- Pass one stable learner_id per person on every call; without one, persistence.learner_id_default (get_server_info) applies.",
  "- Pass the learner's language (fr or en) to get_study_plan, list_lessons and start_review_session.",
  "- Show display_markdown as it is and add nothing of your own unless the learner asks (they wait on every word): on a presentation; after an answer, verdict.display_markdown first, then the transition's.",
  "- On the first screen, relay the authoring notice; if persistence.durable is false, tell the learner progress is lost at restart.",
  `- Wait for the learner's answer and send their words with ${REPLY_CALL}; never answer, choose or rate for them.`,
  "- When a transition carries self_rating, ask the learner to rate their recall and call rate_recall: it schedules reviews, never mastery.",
  "- start_review_session plays every review due, across lessons; list_lessons shows what can be started.",
  "- To learn from new sources: get_authoring_guide, prepare_sources, create_lesson, then start_lesson_session.",
  "- When the learner asks where they are, show the map (get_workflow_graph). Offer once, at a pause, never between a question and its answer: at the end, the map as a page on the learner's yes (export_concept_map); in a working conversation, a short lesson from it when the person wants to understand it (prepare_sources, kind \"conversation\"). When the learner says they already know a concept of the map, or doubt one they got, relay it with submit_response {kind: \"contest\", concept_id, claim}, the id as the map names it; never contest for them.",
  "- Never call forget_session unless the learner asks to erase their data: it deletes their progress for good.",
].join("\n");

let hasLoggedStartup = false;

function logStartup(toolCount: number): void {
  if (hasLoggedStartup) return;
  const build = getBuildInfo();
  process.stderr.write(
    `[studium-lesson] v${SERVER_VERSION} ${build.origin} ${build.built_at ?? "unbuilt"} tools=${toolCount}\n`,
  );
  hasLoggedStartup = true;
}

const text = (data: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (error: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify({
    error: (error as Error).message,
    ...(error instanceof SelfRatingExpiredError ? { code: "self_rating_expired" } : {}),
  }) }],
  isError: true,
});

/** An operation whose arguments are checked against its schema, as operations.ts does. */
function operation<S extends z.ZodRawShape>(
  name: string, description: string, inputSchema: S, run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
): Operation {
  return {
    name, description, inputSchema,
    invoke: async (args) => {
      try { return text(await run(z.object(inputSchema).strict().parse(args))); }
      catch (error) { return fail(error); }
    },
  };
}

const learnerIdArg = z.string().min(1).max(200).optional()
  .describe("one stable id per learner; defaults to persistence.learner_id_default");
/** L-1: an integer epoch a Date can hold, refused otherwise in one line (session-clock.ts). */
const nowMsArg = NowMsSchema.optional();
/** L-4: the language the study tools speak. */
const languageArg = z.enum(["fr", "en"], { errorMap: () => ({ message: "language must be fr or en" }) }).optional()
  .describe("fr or en: the language of display_markdown and of the next step; defaults to the language of the " +
    "learner's last lesson, else the server's");

/** The C1 study tools, transport-independent like lessonOperations (an HTTP surface can add them as is). */
export function studyOperations(
  host: SessionHost, opts: { formsAvailable?: () => boolean; surfaceRankOf?: (sessionId: string) => SurfaceRank } = {},
): Operation[] {
  // INT-STUDIUM-058 § 2.6: the screens these tools serve are read in the conversation (rank 1).
  const promptSurface = (): PromptSurface => ({ rank: 1, formsAvailable: opts.formsAvailable?.() ?? false });
  // The conversation tools log the rank the session is played on, not always the conversation's own.
  const rankOf = (sessionId: string): SurfaceRank => opts.surfaceRankOf?.(sessionId) ?? 1;
  return [
    operation("list_lessons",
      "List the lessons this server can start, from BUNDLES_ROOT and the learner's library, read afresh (a lesson " +
      "written a moment ago is listed): bundle_ref (pass it to start_lesson_session), title, language, concepts, who " +
      "wrote it (authoring.mode, drafted_by), and with learner_id the learner's status (new | in_progress | completed). " +
      "`query` keeps the lessons whose title, ref, discipline or concepts contain every word of it. display_markdown " +
      "is the list in `language`, ready to show.",
      { query: z.string().max(200).optional(), learner_id: z.string().min(1).max(200).optional(), language: languageArg },
      async ({ query, learner_id, language }) => host.listLessons({
        ...(query === undefined ? {} : { query }), ...(learner_id === undefined ? {} : { learnerId: learner_id }),
        ...(language === undefined ? {} : { language }),
      })),

    operation("get_study_plan",
      "Start here: what the learner should do now. Reviews due (with dates), concepts to relearn, lessons in progress, " +
      "the next lesson, and next_step {action: review|continue|start|author|wait, tool, arguments, text} naming the " +
      "call to make with its arguments (language included where the tool takes one). With the minutes a day the " +
      "learner gave, minutes_per_day and next_step.estimated_minutes size the step. display_markdown is the plan in " +
      "`language`, ready to show. Dates (due_date, next_review_date) are days in get_server_info.time_zone.",
      { learner_id: learnerIdArg, now_ms: nowMsArg, language: languageArg },
      async ({ learner_id, now_ms, language }) => host.studyPlan(learner_id, {
        ...(now_ms === undefined ? {} : { nowMs: now_ms }), ...(language === undefined ? {} : { language }),
      })),

    operation("start_review_session",
      "Start a review session: one retrieval scene per concept due, taken from the lessons the learner studied — " +
      "mastered concepts whose recall is due, then reviewed ones still weak. Play it like a lesson (submit_response, " +
      "rate_recall); its answers update the learner's memory and mastery, and it is never recorded as a lesson " +
      "completed. With now_ms it runs on a clock anchored there (its answers and ratings are dated from it). Returns " +
      "{status: \"started\", session_id, review: {items, not_playable?}, presentation, ...}, or {status: " +
      "\"nothing_due\", next_review_at, next_review_date, display_markdown, not_playable?} saying when the next review " +
      "falls; not_playable names the concepts due that no lesson on disk can review any more.",
      {
        learner_id: learnerIdArg, max_items: z.number().int().min(1).max(50).optional(), now_ms: nowMsArg,
        presentation_language: z.string().optional(), language: languageArg,
      },
      async ({ learner_id, max_items, now_ms, presentation_language, language }) => {
        const r = await host.startReview(learner_id, {
          ...(max_items === undefined ? {} : { maxItems: max_items }),
          ...(now_ms === undefined ? {} : { nowMs: now_ms }),
          ...(presentation_language === undefined ? {} : { presentationLanguage: presentation_language }),
          ...(language === undefined ? {} : { language }),
          promptSurface: promptSurface(),
        });
        if (r.status === "nothing_due") return r;
        // The answer keys stay on the server: only the public projection of the scene ships.
        return {
          status: r.status, session_id: r.sessionId, review: r.review, authoring: r.authoring,
          presentation: publicPresentation(r.presentation), language: operatorContext(host, r.sessionId).language,
          resume: r.resume, persistence: r.persistence,
        };
      }),

    operation("rate_recall",
      "After an answer whose transition carries self_rating {requested: true} (a production answer no judge assessed), " +
      "ask the LEARNER how well they recalled it — again, hard, good or easy — and pass their rating; never rate for " +
      "them. It sets the concept's next review (source self_rated) and never changes mastery. One rating per " +
      "request; scene_id is self_rating.scene_id. Returns the next review date and a line to show.",
      {
        session_id: z.string(), scene_id: z.string(),
        grade: z.enum(RECALL_GRADES, { errorMap: () => ({ message: `grade must be one of ${RECALL_GRADES.join(", ")}` }) }),
      },
      async ({ session_id, scene_id, grade }) => host.settleAct(session_id, CONVERSATION("rateRecall", rankOf(session_id)), () => host.rateRecall(session_id, scene_id, grade, "companion", { promptSurface: promptSurface() }))),

    operation("export_concept_map",
      "On the learner's request, export the concept map of a lesson session as a record " +
      "(studium/concept-map-record/v1): the map, each step with who assessed the answer and how the session routed " +
      "after it, and for every scene what it rests on (sources cited and their origin, key class, who drafted the " +
      "lesson and whether an approval record matches this exact file). No learner identifier and none of the learner's words; a passage " +
      "is quoted only for a scene already left. When the server has a library the record is written under " +
      "<library>/_exports/concept-maps/ and saved_to and sha256 name the file; tools/concept_map_report.py turns it " +
      "into an interactive page with its ASTRA document and ARA trace. Show display_markdown. Fails for a review " +
      "session and for a lesson with fewer than two concepts.",
      { session_id: z.string() },
      async ({ session_id }) => {
        const exported = await host.exportConceptMap(session_id);
        if (!exported) throw new Error("this session has no concept map (a review session, or a lesson with fewer than two concepts)");
        return exported;
      }),
  ];
}

/** Where create_lesson and prepare_sources write (L-12, SEC-1, RT-8d): always the learner's library, the
 * C6 library <STUDIUM_HOME>/library, never the folder BUNDLES_ROOT names — a repository's fixtures,
 * where the full text of the learner's sources would be committed and a teacher's lesson replaced.
 * list_lessons and start_lesson_session search the library after BUNDLES_ROOT, so a lesson just written
 * is listed and started at once, and persistence.library_root names it. A host with no library refuses. */
function authoringRoot(host: SessionHost): string {
  const library = host.libraryRoot;
  if (!library) {
    throw new Error("this server has no learner library to write lessons into: lessons and their sources go to " +
      "<STUDIUM_HOME>/library (persistence.library_root), never into BUNDLES_ROOT; start the server with the C6 defaults");
  }
  return library;
}

type PromptLocale = "en" | "fr";

/** The arguments a prompt names in the calls it asks for: learner_id, then language (L-4). */
function callArgs(locale: PromptLocale, learnerId?: string, language?: PromptLocale): string {
  const named = [
    ...(learnerId ? [locale === "fr" ? `learner_id « ${learnerId} »` : `learner_id "${learnerId}"`] : []),
    ...(language ? [locale === "fr" ? `language « ${language} »` : `language "${language}"`] : []),
  ];
  if (!named.length) return "";
  return locale === "fr" ? ` avec ${named.join(" et ")}` : ` with ${named.join(" and ")}`;
}

/** RFR-16, R-en-10: list_lessons only when the plan does not already say to author a lesson. RT-8a: the
 * reply call as submit_response takes it. */
const PROMPTS: Record<PromptLocale, {
  learn: (topic?: string, learnerId?: string, language?: PromptLocale) => string;
  review: (learnerId?: string, language?: PromptLocale) => string;
}> = {
  en: {
    learn: (topic, learnerId, language) =>
      `I want to learn ${topic ? `“${topic}”` : "something new"} with Studium. Call get_study_plan` +
      `${callArgs("en", learnerId, language)} and follow its next step. If its next_step is author, ask me for my ` +
      "sources and build a lesson with get_authoring_guide, prepare_sources and create_lesson. Otherwise, if what it " +
      `proposes does not cover what I want, call list_lessons${callArgs("en", learnerId, language)} to find a lesson, ` +
      "or build one from my sources the same way. Show each display_markdown as it is, wait for my own answer and send " +
      `it with ${REPLY_CALL}. Never answer for me.`,
    review: (learnerId, language) =>
      `Run my Studium reviews: call start_review_session${callArgs("en", learnerId, language)}. ` +
      `Show each display_markdown as it is, wait for my answer and send it with ${REPLY_CALL}. ` +
      "When a transition carries self_rating, ask me to rate my recall (again, hard, good or easy) and pass my rating " +
      "to rate_recall. If nothing is due, tell me when my next review is.",
  },
  fr: {
    learn: (topic, learnerId, language) =>
      `Je veux apprendre ${topic ? `« ${topic} »` : "quelque chose de nouveau"} avec Studium. Appelle get_study_plan` +
      `${callArgs("fr", learnerId, language)}, puis suis son étape suivante. Si son next_step est author, demande-moi ` +
      "mes sources et prépare une leçon avec get_authoring_guide, prepare_sources et create_lesson. Sinon, si ce qu'il " +
      `propose ne couvre pas ce que je veux, appelle list_lessons${callArgs("fr", learnerId, language)} pour trouver une ` +
      "leçon, ou prépare-la de la même façon à partir de mes sources. Montre chaque display_markdown tel quel, attends " +
      `ma propre réponse et transmets-la avec ${REPLY_CALL}. Ne réponds jamais à ma place.`,
    review: (learnerId, language) =>
      `Lance mes révisions Studium : appelle start_review_session${callArgs("fr", learnerId, language)}. ` +
      `Montre chaque display_markdown tel quel, attends ma réponse et transmets-la avec ${REPLY_CALL}. ` +
      "Quand une transition porte self_rating, demande-moi de noter mon rappel (again, hard, good ou easy) et " +
      "transmets ma note à rate_recall. S'il n'y a rien à réviser, dis-moi quand tombe ma prochaine révision.",
  },
};

const promptLocale = z.enum(["en", "fr"]).optional().describe("language of the request: en (default) or fr");
const promptLearner = z.string().optional().describe("the learner's stable id");

function userMessage(textValue: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text: textValue } }] };
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt("learn", {
    title: "Learn with Studium",
    description: "Learn a topic with Studium: follow the study plan, or build a lesson from your own sources.",
    argsSchema: { topic: z.string().optional().describe("what to learn"), learner_id: promptLearner, language: promptLocale },
  }, ({ topic, learner_id, language }) => userMessage(PROMPTS[language ?? "en"].learn(topic, learner_id, language)));
  server.registerPrompt("review", {
    title: "Review with Studium",
    description: "Play the Studium reviews due today, across every lesson studied.",
    argsSchema: { learner_id: promptLearner, language: promptLocale },
  }, ({ learner_id, language }) => userMessage(PROMPTS[language ?? "en"].review(learner_id, language)));
}

/** The MCP server over `host`: lesson operations, study, authoring and teacher tools, instructions and
 * prompts. */
export function buildMcpServer(host: SessionHost): McpServer {
  const server = new McpServer({ name: "studium-lesson", version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  const panels = registerPanelTools(server, host);
  const registered: string[] = [...panels.names];
  // get_server_info reads `registered` when it is called, so it lists every tool added below.
  // Forms are available when the connected client declares MCP elicitation (play_in_forms is always registered).
  const formsAvailable = () => Boolean(server.server.getClientCapabilities()?.elicitation);
  const surfaceRankOf = (id: string) => panels.surfaceRankOf(id);
  for (const op of [
    ...lessonOperations(host, { toolNames: () => registered, formsAvailable, surfaceRankOf }),
    ...studyOperations(host, { formsAvailable, surfaceRankOf }),
  ]) {
    const registeredTool = server.registerTool(op.name, { description: op.description, inputSchema: op.inputSchema }, async (args) => {
      const result = await op.invoke(args);
      await panels.observe(op.name, args, result);
      return result;
    });
    panels.attachTool(op.name, registeredTool);
    registered.push(op.name);
  }
  registered.push(...registerAuthoringTools(server, {
    libraryRoot: () => authoringRoot(host),
    servedElsewhere: (id) => resolve(host.bundlesRoot) !== resolve(host.libraryRoot ?? "") && existsSync(join(host.bundlesRoot, id)),
    // Nothing to refresh: list_lessons scans the roots afresh on every call and start_lesson_session
    // resolves a bundle_ref on disk, so a lesson written a moment ago is listed and starts at once
    // (learn-and-review.e2e.test.ts proves it through this server).
    onLessonWritten: () => {},
    judge: () => host.judge,
  }));
  registered.push(...registerTeacherTools(server, {
    bundlesRoot: host.bundlesRoot, libraryRoot: host.libraryRoot, dataDir: host.persistence().data_dir,
  }));
  registered.push(...registerFormTools(server, host));
  registered.push(...registerCompanionTools(server, host));
  registerPrompts(server);
  logStartup(registered.length);
  return server;
}
