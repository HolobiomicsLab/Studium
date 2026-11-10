// session-workspace.ts — the file-based agentic-session channel (`.studium-session/`).
//
// The capsule-backed lesson outsources EXECUTION + RENDERING to the VS Code host and a pluggable
// agentic operator (Copilot / Claude Code / Codex / opencode). Studium stays the lesson BRAIN and
// talks to the operator over two channels: MCP (typed/live — see apps/lesson-mcp) and THIS file
// protocol (universal — any assistant can read/write plain files). Studium and the workspace go
// back and forth through one small folder:
//
//   .studium-session/
//     task.md       Studium -> operator : the current step, REDACTED (no answer key). What to do.
//     response.json operator -> Studium : the learner's submission  ({kind,...} or {text}).
//     feedback.md   Studium -> operator : the graded outcome + whether it advanced.
//     index.json    the shared memory/log : one entry per step (scene id/type + status).
//     session-language.json operator -> Studium : optional presentation-language change.
//
// The answer key (claims / flaws_expected / model_*) is stripped by publicScene BEFORE it is ever
// written to task.md, so the operator (and the model behind it) audits the AI reading WITHOUT being
// handed the solution — the redaction boundary holds at the FILE edge, exactly as it does over MCP.
// Execution + rendering of the real artifact (the capsule run's figure) is the HOST's job; Studium
// only references it here and grades the JUDGMENT the operator writes back.

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { LessonSession } from "@studium/lesson-session";
import { RUN_REQUIRED_MESSAGE, type SessionHost } from "./host.js";
import { publicScene, publicTransition, citedSources, type CitedSource } from "./public-scene.js";
import { verdictMarkdown, sourcesMarkdown, approvalNoticeMarkdown } from "./chat-display.js";
import { parseRunResult, type RunResult } from "./run-result.js";
import { expectedKind, operatorContext, operatorContextMarkdown, responseFor } from "./operator-context.js";
import { z } from "zod";
import { ExperimentInputSchema } from "./experiment-journal.js";
import { frenchSpacing } from "../../lesson-session/src/phrases.js";

const experimentEnvelope = z.object({ session_id: z.string(), scene_id: z.string(), input: ExperimentInputSchema }).strict();
const sessionLanguageEnvelope = z.object({
  session_id: z.string(), presentation_language: z.string().nullable(),
}).strict();

type Locale = ReturnType<typeof LessonSession.localeFromLanguage>;
type PhraseKey = Parameters<typeof LessonSession.phrase>[0];

const tr = (locale: Locale, key: PhraseKey, params: Record<string, string | number> = {}): string =>
  LessonSession.phrase(key, params, locale);

const FILES = {
  task: "task.md", response: "response.json", feedback: "feedback.md", index: "index.json",
  // LEARNER-TIME RUN channel: Studium emits the manifest, the operator runs + writes the result back.
  run: "run.json", runResult: "run_result.json",
} as const;

/** Expected kinds a bare `{text}` cannot carry: the host reads the choice or the confidence from it. */
const READ_FROM_REPLY = new Set(["quiz_choice", "confidence"]);

// scene type -> the free-text ResponseInput kind its grader requires (mirror of studium-vscode
// scene-io.ts + lesson-session graders.ts). Operators may instead write an explicit {kind,...};
// control scenes (intro/concept/reproduction/discussion) and anything unmapped fall back to ack.
export interface WorkspaceStepEntry {
  step: number;
  scene_id: string;
  scene_type: string;
  status: "awaiting_response" | "graded" | "complete" | "awaiting_run" | "ran";
  // recorded for a learner-time run step (status "ran"): the learner's OWN executed result summary.
  landmark?: string | null;
  passed?: boolean;
  artifacts?: string[];
}
export interface WorkspaceIndex {
  session_id: string;
  entries: WorkspaceStepEntry[];
  /** A production answer has advanced in the engine, but the file channel stays here until the
   * learner supplies the explicit FSRS recall rating requested by that answer. */
  pending_recall?: {
    scene_id: string;
    after: string;
    locale: Locale;
  };
}

/**
 * Bridges a SessionHost session to the `.studium-session/` file protocol, so an external agentic
 * operator drives the lesson by reading/writing plain files. Stateless except for a step counter;
 * the durable state lives in the host (mastery/history) and the folder (the index/log).
 */
export class SessionWorkspace {
  private step = 0;
  constructor(private readonly host: SessionHost, private readonly dir: string) {}

  /** The runner uses this to avoid declaring the file session complete while a requested learner
   * recall rating is still missing. The grade itself is never invented by the runner. */
  async pendingRecall(sessionId: string): Promise<{ sceneId: string } | null> {
    const pending = (await this.readIndex(sessionId)).pending_recall;
    return pending ? { sceneId: pending.scene_id } : null;
  }

  /** Studium -> operator: write the REDACTED current task + real-artifact reference; log "awaiting".
   * A scene carrying a `run_manifest` is a LEARNER-TIME RUN: Studium emits a non-answer-bearing
   * `run.json` + a provision-&-run task and WITHHOLDS the author landmark (the learner produces a
   * fresh result by running it). Execution is the host/operator's job — Studium never runs it. */
  async writeStep(sessionId: string, recordInIndex = true): Promise<void> {
    const pres = this.host.currentPresentation(sessionId) as { locale: Locale; scene: Record<string, unknown> };
    const locale = pres.locale;
    const scene = publicScene(pres.scene as never) as Record<string, unknown>; // answer key stripped HERE
    const context = operatorContextMarkdown(operatorContext(this.host, sessionId));
    const approvalNotice = this.step === 0 ? approvalNoticeMarkdown(this.host.authoring(sessionId), locale) : "";
    const prefix = approvalNotice ? `> ${approvalNotice}\n\n` : "";
    await mkdir(this.dir, { recursive: true });
    if (recordInIndex) await this.writeExperimentSnapshot(sessionId);
    const manifest = scene.run_manifest as Record<string, unknown> | undefined;
    // A run scene revisited after a detour, with the learner's run already recorded: a response task
    // (ack) — the operator may still re-run and write run_result.json, which ingest() picks up first.
    if (manifest && !scene.learner_run_recorded) {
      if (recordInIndex) await rm(join(this.dir, FILES.runResult), { force: true }); // fresh run scene: no stale result
      if (recordInIndex) await writeFile(join(this.dir, FILES.run), JSON.stringify(manifest, null, 2), "utf8");
      await writeFile(join(this.dir, FILES.task), prefix + renderRunTask(scene, manifest, this.step, locale) + context, "utf8");
      if (recordInIndex) {
        await this.append(sessionId, {
          step: this.step, scene_id: String(scene.id ?? ""), scene_type: String(scene.type ?? ""),
          status: "awaiting_run",
        });
      }
      return;
    }
    if (recordInIndex) await rm(join(this.dir, FILES.run), { force: true }); // leaving a run scene: clear the stale manifest
    const assets = this.host.sceneArtifacts(sessionId) as Array<Record<string, unknown>>;
    await writeFile(join(this.dir, FILES.task), prefix + renderTask(scene, assets, this.step, locale) + context, "utf8");
    if (recordInIndex) {
      await this.append(sessionId, {
        step: this.step,
        scene_id: String(scene.id ?? ""),
        scene_type: String(scene.type ?? ""),
        status: "awaiting_response",
      });
    }
  }

  /** operator -> Studium: read response.json into a ResponseInput for the current scene type.
   * Returns null when there is no readable response yet (absent OR a partial/invalid write — both
   * "not ready, retry"). A present `text` is mapped to the scene's required kind; a mismatched explicit
   * `kind` WITH text is coerced to the right kind; a structural mismatch is passed through for ingest's
   * guard to handle gracefully (so a bad response never wedges the channel). */
  async readResponse(sceneType: string): Promise<Record<string, unknown> | null> {
    let raw: string;
    try { raw = await readFile(join(this.dir, FILES.response), "utf8"); } catch { return null; } // absent = not ready
    let r: Record<string, unknown>;
    try { r = JSON.parse(raw); } catch { return null; }                  // partial/invalid write = not ready (retry)
    const expected = expectedKind(sceneType);
    // A quiz choice or a confidence is not free text: the host reads it from the words (reply-mapping.ts).
    const fromText = (text: string) => (READ_FROM_REPLY.has(expected) ? { kind: "reply", text } : { kind: expected, text });
    if (r && typeof r.kind === "string") {
      if (r.kind === expected) return r;                                 // explicit + correct
      if (typeof r.text === "string") return fromText(r.text);           // mismatched-with-text: coerce
      return r;                                                          // structural mismatch: ingest's catch handles it
    }
    if (r && typeof r.text === "string") return expected === "ack" ? { kind: "ack" } : fromText(r.text);
    return { kind: "ack" };                                              // empty / control scene
  }

  /** Grade the operator's response, write feedback, advance, write the next task (or mark complete).
   * Never throws on operator error: a missing/partial response writes a "not ready" note; a bad/mismatched
   * input is CONSUMED + a corrective feedback.md is written so the operator can retry — the channel
   * self-heals instead of deadlocking on an un-consumed bad response.json. */
  async ingest(sessionId: string): Promise<{ done: boolean; transition: string }> {
    const pending = (await this.readIndex(sessionId)).pending_recall;
    if (pending) return this.ingestRecall(sessionId, pending);
    const sessionLanguage = await this.ingestSessionLanguage(sessionId);
    if (sessionLanguage) return sessionLanguage;
    const experiment = await this.ingestExperiment(sessionId);
    if (experiment) return experiment;
    const pres = this.host.currentPresentation(sessionId) as {
      locale: Locale;
      scene: { type: string; run_manifest?: unknown; learner_run_recorded?: boolean };
    };
    const locale = pres.locale;
    if (pres.scene.run_manifest) {
      // learner-time run scene: a run already recorded makes the run optional — a fresh run_result.json
      // still counts (re-run), otherwise the operator's response.json (ack) advances.
      const hasResult = await readFile(join(this.dir, FILES.runResult), "utf8").then(() => true, () => false);
      if (!pres.scene.learner_run_recorded || hasResult) return this.ingestRun(sessionId, locale);
    }
    const sceneType = pres.scene.type;
    const input = await this.readResponse(sceneType);
    if (!input) {                                                        // no valid response yet — don't wedge
      await writeFile(join(this.dir, FILES.feedback),
        `${LessonSession.phrase("workspace_feedback_heading", {}, locale)}\n\n` +
        `${LessonSession.phrase("workspace_missing_response", {}, locale)}\n`, "utf8");
      return { done: false, transition: "awaiting" };
    }
    let t: Record<string, unknown>;
    try {
      t = publicTransition(await this.host.respond(sessionId, input as never)) as unknown as Record<string, unknown>;
    } catch (e) {                                                        // bad/mismatched input — self-heal
      await rm(join(this.dir, FILES.response), { force: true });         // consume the bad file (no re-wedge)
      await writeFile(join(this.dir, FILES.feedback),
        `${LessonSession.phrase("workspace_feedback_heading", {}, locale)}\n\n` +
        `${LessonSession.phrase("workspace_invalid_response", {
          error: (e as Error).message,
          kind: expectedKind(sceneType),
        }, locale)}\n`, "utf8");
      return { done: false, transition: "invalid_response" };
    }
    await rm(join(this.dir, FILES.response), { force: true });          // consume on success: no stale re-ingest
    await this.markGraded(sessionId);
    const completion = t.kind === "complete" ? this.host.masterySummaryMarkdown(sessionId) : "";
    await writeFile(join(this.dir, FILES.feedback), renderFeedback(t, locale, completion), "utf8");
    const selfRating = t.self_rating as { requested?: unknown; scene_id?: unknown } | undefined;
    if (selfRating?.requested === true && typeof selfRating.scene_id === "string") {
      await this.setPendingRecall(sessionId, {
        scene_id: selfRating.scene_id,
        after: String(t.kind),
        locale,
      });
      await writeFile(join(this.dir, FILES.task), renderRecallTask(locale), "utf8");
      return { done: false, transition: "awaiting_recall" };
    }
    if (t.kind === "complete") {
      this.step += 1;
      await this.append(sessionId, { step: this.step, scene_id: "", scene_type: "", status: "complete" });
      return { done: true, transition: "complete" };
    }
    this.step += 1;
    await this.writeStep(sessionId);
    return { done: false, transition: String(t.kind) };
  }

  /** Consume only a learner-supplied recall grade. Invalid structures are consumed so the file
   * channel can recover; partial JSON is left in place for an atomic writer to finish. */
  private async ingestRecall(
    sessionId: string,
    pending: NonNullable<WorkspaceIndex["pending_recall"]>,
  ): Promise<{ done: boolean; transition: string }> {
    let raw: string;
    try { raw = await readFile(join(this.dir, FILES.response), "utf8"); }
    catch {
      await writeFile(join(this.dir, FILES.feedback), renderRecallWaiting(pending.locale), "utf8");
      return { done: false, transition: "awaiting_recall" };
    }
    let response: unknown;
    try { response = JSON.parse(raw); }
    catch {
      await writeFile(join(this.dir, FILES.feedback), renderRecallWaiting(pending.locale), "utf8");
      return { done: false, transition: "awaiting_recall" };
    }
    const r = response as { kind?: unknown; grade?: unknown } | null;
    const grades = ["again", "hard", "good", "easy"] as const;
    if (!r || r.kind !== "recall" || !grades.includes(r.grade as typeof grades[number])) {
      await rm(join(this.dir, FILES.response), { force: true });
      await writeFile(join(this.dir, FILES.feedback), renderRecallInvalid(pending.locale), "utf8");
      return { done: false, transition: "invalid_recall" };
    }
    let rating: Awaited<ReturnType<SessionHost["rateRecall"]>>;
    try {
      rating = await this.host.rateRecall(sessionId, pending.scene_id, r.grade as typeof grades[number]);
    } catch {
      await rm(join(this.dir, FILES.response), { force: true });
      await writeFile(join(this.dir, FILES.feedback), renderRecallInvalid(pending.locale), "utf8");
      return { done: false, transition: "invalid_recall" };
    }
    await rm(join(this.dir, FILES.response), { force: true });
    await this.clearPendingRecall(sessionId);
    const completed = pending.after === "complete"
      ? (pending.locale === "fr" ? "**Leçon terminée.**" : "**Lesson complete.**")
      : "";
    const summary = pending.after === "complete" ? this.host.masterySummaryMarkdown(sessionId) : "";
    const body = [rating.display_markdown, completed, summary].filter(Boolean).join("\n\n");
    await writeFile(join(this.dir, FILES.feedback),
      `${tr(pending.locale, "workspace_feedback_heading")}\n\n${body}\n`, "utf8");
    if (pending.after === "complete") {
      this.step += 1;
      await this.append(sessionId, { step: this.step, scene_id: "", scene_type: "", status: "complete" });
      return { done: true, transition: "complete" };
    }
    this.step += 1;
    await this.writeStep(sessionId);
    return { done: false, transition: "recall_rated" };
  }

  /** operator -> Studium for a LEARNER-TIME RUN scene: read run_result.json (the operator's run output),
   * record the learner's OWN executed result, and gate "you actually ran it" on `ran && passed`. Studium
   * never executes — it only validates + records + advances. Self-heals like the response channel:
   * missing/partial waits; a non-completed/failed run is consumed with a corrective note, no wedge. */
  private async ingestRun(sessionId: string, locale: Locale): Promise<{ done: boolean; transition: string }> {
    let raw: string;
    try { raw = await readFile(join(this.dir, FILES.runResult), "utf8"); }
    catch {
      await rm(join(this.dir, FILES.response), { force: true });
      await this.writeRunFeedback(
        LessonSession.phrase("workspace_run_required", { message: RUN_REQUIRED_MESSAGE }, locale),
        locale,
      );
      return { done: false, transition: "awaiting_run" };
    }
    const result = parseRunResult(raw);
    if (!result) { // partial / invalid write — keep the file, the atomic writer will complete it
      await this.writeRunFeedback(LessonSession.phrase("workspace_run_result_invalid", {}, locale), locale);
      return { done: false, transition: "awaiting_run" };
    }
    // SHARED run-ingest core (host.ingestRunResult) — gates on ran && passed, records the learner's run
    // (so a later reference_from_run judgment grounds on it) and advances. The file channel adds only its
    // own I/O (consume run_result.json, write feedback.md + the next task) around it, so the MCP and file
    // channels can't drift on the gating logic.
    let r: { status: string; transition: unknown; learnerRunRecorded: boolean };
    try { r = await this.host.ingestRunResult(sessionId, result); }
    catch (e) {
      await rm(join(this.dir, FILES.runResult), { force: true });
      await this.writeRunFeedback(
        LessonSession.phrase("workspace_run_advance_failed", { error: (e as Error).message }, locale),
        locale,
      );
      return { done: false, transition: "invalid_run" };
    }
    if (r.status === "run_incomplete") {
      await rm(join(this.dir, FILES.runResult), { force: true });
      await this.writeRunFeedback(LessonSession.phrase("workspace_run_incomplete", {}, locale), locale);
      return { done: false, transition: "run_incomplete" };
    }
    if (r.status === "run_failed_checks") {
      const failing = result.checks.filter((c) => !c.passed).map((c) => c.check);
      await rm(join(this.dir, FILES.runResult), { force: true });
      await this.writeRunFeedback(LessonSession.phrase("workspace_run_checks_failed", {
        checks: failing.join(" ; ") || LessonSession.phrase("workspace_run_checks_fallback", {}, locale),
      }, locale), locale);
      return { done: false, transition: "run_failed_checks" };
    }
    if (r.status !== "ran" || !r.transition) { // not_a_run_scene — should not happen (ingest routes run scenes)
      await rm(join(this.dir, FILES.runResult), { force: true });
      await this.writeRunFeedback(LessonSession.phrase("workspace_run_ignored", {}, locale), locale);
      return { done: false, transition: "invalid_run" };
    }
    // ran && passed: the host recorded the learner's run + advanced. Mark the step + write the next task.
    await this.markRan(sessionId, result);
    const t = publicTransition(r.transition as Parameters<typeof publicTransition>[0]) as unknown as Record<string, unknown>;
    await rm(join(this.dir, FILES.runResult), { force: true }); // consume: next scene starts fresh
    await writeFile(join(this.dir, FILES.feedback), renderRunFeedback(result, t, locale), "utf8");
    if (t.kind === "complete") {
      await rm(join(this.dir, FILES.run), { force: true }); // session over: clear the stale manifest too
      this.step += 1;
      await this.append(sessionId, { step: this.step, scene_id: "", scene_type: "", status: "complete" });
      return { done: true, transition: "complete" };
    }
    this.step += 1;
    await this.writeStep(sessionId);
    return { done: false, transition: String(t.kind) };
  }

  private async writeRunFeedback(body: string, locale: Locale): Promise<void> {
    await writeFile(join(this.dir, FILES.feedback),
      `${LessonSession.phrase("workspace_feedback_heading", {}, locale)}\n\n${body}\n`, "utf8");
  }

  private async writeExperimentSnapshot(sessionId: string): Promise<void> {
    const journal = this.host.experimentJournal(sessionId);
    const path = join(this.dir, "experiment.json");
    if (journal.experiments.length) await writeFile(path, JSON.stringify(journal, null, 2), { encoding: "utf8", mode: 0o600 });
    else await rm(path, { force: true });
  }

  private async ingestSessionLanguage(sessionId: string): Promise<{ done: boolean; transition: string } | null> {
    const path = join(this.dir, "session-language.json");
    let raw: string;
    try { raw = await readFile(path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    let envelope: z.infer<typeof sessionLanguageEnvelope>;
    try {
      envelope = sessionLanguageEnvelope.parse(JSON.parse(raw));
      if (envelope.session_id !== sessionId) throw new Error("Stale session language action");
      this.host.setPresentationLanguage(sessionId, envelope.presentation_language);
    } catch {
      await rm(path, { force: true });
      await writeFile(join(this.dir, FILES.feedback),
        "# Session language\n\nInvalid session or BCP 47 presentation language. Rewrite session-language.json and retry.\n", "utf8");
      return { done: false, transition: "invalid_session_language" };
    }
    await rm(path, { force: true });
    await this.writeStep(sessionId, false);
    await writeFile(join(this.dir, FILES.feedback),
      "# Session language\n\nPresentation language updated. Source content and learner responses are unchanged.\n", "utf8");
    return { done: false, transition: "session_language_changed" };
  }

  private async ingestExperiment(sessionId: string): Promise<{ done: boolean; transition: string } | null> {
    const path = join(this.dir, "experiment-action.json");
    let raw: string;
    try { raw = await readFile(path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      const envelope = experimentEnvelope.parse(JSON.parse(raw));
      if (envelope.session_id !== sessionId || envelope.scene_id !== this.host.currentPresentation(sessionId).scene.id)
        throw new Error("Stale experiment action: session or scene changed");
      this.host.recordExperiment(sessionId, envelope.input);
      await this.writeExperimentSnapshot(sessionId);
      await rm(path, { force: true });
      await writeFile(join(this.dir, FILES.feedback), "# Experiment\n\nContribution recorded privately. No grade or lesson advance.\n", "utf8");
      return { done: false, transition: "experiment_recorded" };
    } catch {
      // Do not echo invalid free text or a foreign session's identifiers into feedback.
      await rm(path, { force: true });
      await writeFile(join(this.dir, FILES.feedback), "# Experiment\n\nInvalid or stale experiment action, or journal unavailable. Check session/scene, consent, attribution and event order. Rewrite experiment-action.json and retry.\n", "utf8");
      return { done: false, transition: "invalid_experiment" };
    }
  }

  /** Mark the latest awaiting_run step "ran" and record the learner's executed-result summary (auditable). */
  private async markRan(sessionId: string, result: RunResult): Promise<void> {
    const idx = await this.readIndex(sessionId);
    for (let i = idx.entries.length - 1; i >= 0; i--) {
      if (idx.entries[i]!.status === "awaiting_run") {
        idx.entries[i]!.status = "ran";
        idx.entries[i]!.landmark = result.landmark ?? null;
        idx.entries[i]!.passed = result.passed;
        idx.entries[i]!.artifacts = result.artifacts;
        break;
      }
    }
    await writeFile(join(this.dir, FILES.index), JSON.stringify(idx, null, 2), "utf8");
  }

  private async readIndex(sessionId: string): Promise<WorkspaceIndex> {
    try { return JSON.parse(await readFile(join(this.dir, FILES.index), "utf8")); }
    catch { return { session_id: sessionId, entries: [] }; }
  }
  private async setPendingRecall(
    sessionId: string,
    pending: NonNullable<WorkspaceIndex["pending_recall"]>,
  ): Promise<void> {
    const idx = await this.readIndex(sessionId);
    idx.pending_recall = pending;
    await writeFile(join(this.dir, FILES.index), JSON.stringify(idx, null, 2), "utf8");
  }
  private async clearPendingRecall(sessionId: string): Promise<void> {
    const idx = await this.readIndex(sessionId);
    delete idx.pending_recall;
    await writeFile(join(this.dir, FILES.index), JSON.stringify(idx, null, 2), "utf8");
  }
  private async append(sessionId: string, entry: WorkspaceStepEntry): Promise<void> {
    const idx = await this.readIndex(sessionId);
    idx.entries.push(entry);
    await writeFile(join(this.dir, FILES.index), JSON.stringify(idx, null, 2), "utf8");
  }
  private async markGraded(sessionId: string): Promise<void> {
    const idx = await this.readIndex(sessionId);
    for (let i = idx.entries.length - 1; i >= 0; i--) {
      if (idx.entries[i]!.status === "awaiting_response") { idx.entries[i]!.status = "graded"; break; }
    }
    await writeFile(join(this.dir, FILES.index), JSON.stringify(idx, null, 2), "utf8");
  }
}

function instructionFor(type: string, locale: Locale): string {
  switch (type) {
    case "spot_the_flaw": return tr(locale, "workspace_instruction_spot_the_flaw");
    case "ai_critique": return tr(locale, "workspace_instruction_ai_critique");
    case "explain_back": return tr(locale, "workspace_instruction_explain_back");
    case "comparison": return tr(locale, "workspace_instruction_comparison");
    case "summary_audit": return tr(locale, "workspace_instruction_summary_audit");
    case "prompt_practice": return tr(locale, "workspace_instruction_prompt_practice");
    case "communication_sim": return tr(locale, "workspace_instruction_communication_sim");
    case "quiz": return tr(locale, "workspace_instruction_quiz");
    case "meta_checkpoint": return tr(locale, "workspace_instruction_meta_checkpoint");
    default: return tr(locale, "workspace_instruction_default");
  }
}

function renderTask(
  scene: Record<string, unknown>,
  assets: Array<Record<string, unknown>>,
  step: number,
  locale: Locale,
): string {
  const s = scene as Record<string, string | undefined>;
  const L: string[] = [];
  L.push(tr(locale, "workspace_task_title", { step, title: s.title || s.type || "" }), "");
  if (scene.learner_run_recorded) {
    L.push("", tr(locale, "workspace_run_already_recorded", {
      landmark: String(scene.learner_run_landmark ?? ""),
    }), tr(locale, "workspace_run_already_recorded_action"), "");
  }
  L.push(tr(locale, "workspace_scene_type", { type: s.type || "" }), "");
  L.push(instructionFor(String(s.type), locale), "");
  if (s.markdown) L.push(s.markdown, "");
  if (s.flawed_content) L.push(tr(locale, "workspace_ai_reading"), "", s.flawed_content, "");
  if (s.prompt) L.push(s.prompt, "");
  if (s.artifact_a) L.push("**A.**", "", s.artifact_a, "");
  if (s.artifact_b) L.push("**B.**", "", s.artifact_b, "");
  if (s.source_content) L.push(tr(locale, "workspace_source"), "", s.source_content, "");
  if (s.ai_summary) L.push(tr(locale, "workspace_ai_summary"), "", s.ai_summary, "");
  const claims = scene.claims_to_critique;
  if (Array.isArray(claims) && claims.length) {
    L.push(tr(locale, "workspace_ai_claims"), "", ...claims.map((c: { text?: unknown }, i: number) => `${i + 1}. ${String(c.text ?? "")}`), "");
  }
  if (s.scenario) L.push(tr(locale, "workspace_situation", { text: s.scenario }), "");
  if (s.task) L.push(tr(locale, "workspace_task", { text: s.task }), "");
  const readingSources = sourcesMarkdown(citedSources(scene as never), locale);
  if (readingSources) L.push(readingSources, "");

  // SECURITY: host.sceneArtifacts() is NOT publicScene-redacted (known asymmetry). So we surface ONLY
  // the executed_result asset and ONLY an explicit allowlist of its meta keys (landmark/path/cmd/passed)
  // — never arbitrary asset kinds or whole meta. A future asset kind that copied an answer-bearing field
  // into meta would otherwise leak into task.md; keep this allowlist tight.
  const exec = assets.find((a) => a.kind === "executed_result");
  if (exec) {
    const m = (exec.meta as Record<string, unknown>) || {};
    L.push(tr(locale, "workspace_executed_result"), "");
    if (m.landmark) L.push(tr(locale, "workspace_measure", { text: String(m.landmark) }));
    if (exec.path) L.push(tr(locale, "workspace_figure", { text: String(exec.path) }));
    if (m.cmd) L.push(tr(locale, "workspace_command", {
      text: Array.isArray(m.cmd) ? (m.cmd as string[]).join(" ") : String(m.cmd),
    }));
    if (m.passed != null) L.push(tr(locale, "workspace_checks_passed", { text: String(m.passed) }));
    L.push("");
  }

  L.push(tr(locale, "workspace_respond_heading"), tr(locale, "workspace_write_response"), "```json");
  L.push(JSON.stringify(responseFor(scene, false).example, null, 2));
  L.push("```", tr(locale, "workspace_response_shorthand"));
  return L.join("\n") + "\n";
}

function renderFeedback(t: Record<string, unknown>, locale: Locale, completion = ""): string {
  // The host's verdict display is the canonical learner wording. It already obeys the one marking
  // rule (✓ only for `correct:true`, ✗ only for `correct:false`) and releases references + sources
  // only after the answer. The fallback keeps older hosts compatible with the same renderer.
  const v = t.verdict as { display_markdown?: unknown; sources?: CitedSource[] } | undefined;
  const earnedFromVerdict = typeof v?.display_markdown === "string"
    ? v.display_markdown
    : verdictMarkdown(t as never, v?.sources ?? [], { locale });
  const earned = earnedFromVerdict || (locale === "fr" ? "**Réponse enregistrée.**" : "**Answer recorded.**");
  const selfRating = (t.self_rating as { requested?: unknown } | undefined)?.requested === true;
  const ratingInstruction = selfRating ? renderRecallInstruction(locale) : "";
  const navigation = selfRating ? "" : renderWorkspaceNavigation(t, locale);
  const body = [earned, ratingInstruction, navigation, completion].filter((part) => part.trim() !== "").join("\n\n");
  const rendered = `${tr(locale, "workspace_feedback_heading")}\n\n${body}\n`;
  return locale === "fr" ? frenchSpacing(rendered) : rendered;
}

/** File-channel navigation is selected from the public kind alone. Engine reasons and ids can carry
 * correctness claims, item/threshold vocabulary or another scene's internal identifiers. */
function renderWorkspaceNavigation(t: Record<string, unknown>, locale: Locale): string {
  const kind = (t.navigation as { kind?: unknown } | undefined)?.kind ?? t.kind;
  const fr = locale === "fr";
  switch (kind) {
    case "replay": return fr ? "La prochaine tâche reprend cette question." : "The next task repeats this question.";
    case "remediate_alt": return fr ? "La prochaine tâche propose une autre question sur le même point."
      : "The next task gives you another question on the same point.";
    case "remediate": return fr ? "La prochaine tâche revoit d'abord une notion nécessaire."
      : "The next task first revisits a concept this lesson needs.";
    case "gate_unassessable": return fr ? "Cette notion n'a pas pu être mesurée ici ; la leçon continue."
      : "This concept could not be measured here; the lesson continues.";
    case "skip_mastered":
    case "skip_concept": return fr ? "La leçon passe à la suite." : "The lesson moves on.";
    case "calibration": return fr ? "La prochaine tâche est un point de confiance."
      : "The next task is a confidence check.";
    case "complete": {
      const count = Number((t.summary as { scenesCompleted?: unknown } | undefined)?.scenesCompleted);
      if (!Number.isFinite(count)) return fr ? "Leçon terminée." : "Lesson complete.";
      if (fr) return count === 1 ? "Leçon terminée — 1 scène." : `Leçon terminée — ${count} scènes.`;
      return count === 1 ? "Lesson complete — 1 scene." : `Lesson complete — ${count} scenes.`;
    }
    default: return fr ? "Passage à l'étape suivante (`task.md` est mis à jour)."
      : "Moving to the next step (`task.md` is updated).";
  }
}

const recallExample = JSON.stringify({ kind: "recall", grade: "good" }, null, 2);

function renderRecallInstruction(locale: Locale): string {
  const text = locale === "fr"
    ? "Choisis ta note de rappel — **je ne savais pas** (`again`), **difficile** (`hard`), **bien** (`good`) ou **facile** (`easy`) — puis écris :"
    : "Choose your recall rating — **again**, **hard**, **good** or **easy** — then write:";
  const rendered = `${text}\n\n\`\`\`json\n${recallExample}\n\`\`\``;
  return locale === "fr" ? frenchSpacing(rendered) : rendered;
}

function renderRecallTask(locale: Locale): string {
  const heading = locale === "fr" ? "# Studium — note ton rappel" : "# Studium — rate your recall";
  return `${heading}\n\n${renderRecallInstruction(locale)}\n`;
}

function renderRecallWaiting(locale: Locale): string {
  const line = locale === "fr"
    ? "Aucune note de rappel valide n'a encore été reçue. La leçon attend ta note."
    : "No valid recall rating has been received yet. The lesson is waiting for your rating.";
  return `${tr(locale, "workspace_feedback_heading")}\n\n${line}\n\n${renderRecallInstruction(locale)}\n`;
}

function renderRecallInvalid(locale: Locale): string {
  const line = locale === "fr"
    ? "La note de rappel est invalide. Choisis `again`, `hard`, `good` ou `easy`."
    : "The recall rating is invalid. Choose `again`, `hard`, `good` or `easy`.";
  const rendered = `${tr(locale, "workspace_feedback_heading")}\n\n${line}\n\n${renderRecallInstruction(locale)}\n`;
  return locale === "fr" ? frenchSpacing(rendered) : rendered;
}

/** Render the provision-&-run task for a learner-time reproduction scene. Surfaces ONLY how to run
 * (capsule ref / install / cmd / produced file names / file-existence checks) — NEVER the expected
 * values or the author's landmark. The host/operator owns env + install + execution; Studium never runs. */
function renderRunTask(
  scene: Record<string, unknown>,
  manifest: Record<string, unknown>,
  step: number,
  locale: Locale,
): string {
  const s = scene as Record<string, string | undefined>;
  const m = manifest;
  const L: string[] = [];
  L.push(tr(locale, "workspace_run_task_title", { step, title: s.title || s.type || "" }), "");
  L.push(tr(locale, "workspace_run_scene_type"), "");
  if (s.markdown) L.push(s.markdown, "");
  L.push(tr(locale, "workspace_run_heading"), "");
  if (m.research_question) L.push(tr(locale, "workspace_question", { text: String(m.research_question) }), "");
  L.push(tr(locale, "workspace_capsule", { text: String(m.capsule_ref ?? "") }));
  const reqs = Array.isArray(m.requirements) ? (m.requirements as string[]) : [];
  if (reqs.length) L.push(tr(locale, "workspace_install", { text: reqs.join(", ") }));
  const cmd = Array.isArray(m.cmd) ? (m.cmd as string[]).join(" ") : String(m.cmd ?? "");
  L.push(tr(locale, "workspace_launch", {
    command: cmd,
    working_dir: m.working_dir ? tr(locale, "workspace_working_dir", { text: String(m.working_dir) }) : "",
  }));
  const outs = Array.isArray(m.expected_outputs) ? (m.expected_outputs as string[]) : [];
  if (outs.length) L.push(tr(locale, "workspace_expected_outputs", { text: outs.map((o) => `\`${o}\``).join(", ") }));
  const checks = Array.isArray(m.verify_checks) ? (m.verify_checks as string[]) : [];
  if (checks.length) { L.push(tr(locale, "workspace_verify")); for (const c of checks) L.push(`  - ${c}`); }
  L.push("");
  L.push(tr(locale, "workspace_run_report_heading"), tr(locale, "workspace_run_report_instruction"), "```json");
  L.push(JSON.stringify({
    ran: true, passed: true,
    landmark: tr(locale, "workspace_run_landmark_example"),
    artifacts: outs,
    checks: checks.map((c) => ({ check: c, passed: true })),
  }, null, 2));
  L.push("```", tr(locale, "workspace_run_attestation"));
  return L.join("\n") + "\n";
}

function renderRunFeedback(result: RunResult, t: Record<string, unknown>, locale: Locale): string {
  const lm = result.landmark ? tr(locale, "workspace_run_measure", { text: result.landmark }) : "";
  const heading = `${tr(locale, "workspace_feedback_heading")}\n\n`;
  if (t.kind === "complete") {
    const n = (t.summary as Record<string, unknown> | undefined)?.scenesCompleted;
    return `${heading}${tr(locale, "workspace_run_complete", { measure: lm, count: String(n ?? "?") })}\n`;
  }
  return `${heading}${tr(locale, "workspace_run_next", { measure: lm })}\n`;
}
