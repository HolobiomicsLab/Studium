import { helpStyles, lessonHelpTemplates, graphHelp } from "./contextual-help.js";
// extension.ts — Studium in VS Code.
//
// The extension host is an MCP client to the lesson-mcp server (the same server VS Code Copilot
// would connect to). A WebviewPanel renders the ARTIFACT PANE (media/artifact-pane.*). The two
// move in lockstep, pair by pair: every time the learner advances, the extension pulls the next
// scene + get_scene_artifacts and posts them to the pane; the pane posts the learner's responses
// back, which the extension feeds to submit_response / request_hint.
import * as vscode from "vscode";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  connectLessonMcp, describeServerLaunch, lessonMcpEnv, resolveLogSink, resolveServerLaunch,
  serverBuildWarning, serverInfoLine, setLessonMcpLog, type LessonMcp,
} from "./mcp-connect.js";
import { LessonPanelLifecycle, type ActionResult } from "./panel-lifecycle.js";
import { registerStudiumChat } from "./chat.js";
import { toCytoscape, buildStylesheet, egoFilter, type GraphView } from "@studium/typed-graph-lens";
import { registerStudiumNotebook } from "./notebook.js";
import { reviewDueConcepts } from "./review-fsrs.js";
import { selectRenderOrder, type ModalityPreference } from "./modality.js";
import { discoverCommunityBundles, toPickItems } from "./community.js";
import { calibrationVerdicts, type CalibrationVerdict } from "./calibration.js";
import { runManifestToTaskSpec, buildRunResult, extractLandmark, workingDirProblem, type RunManifest, type RunResult } from "./run-task.js";
import { StudiumTreeProvider } from "./tree.js";
import { buildLessonTree, type CommunityItem, type TreeNode } from "./lesson-tree.js";
import { discoverCoursesInRoot, needsLessonPicker, toLessonPickerChoices, type LessonCourse, type LessonPickerChoice } from "./lesson-picker.js";
import { browserPhrases, localeFromLanguage, phrase, type Locale } from "./phrases.js";
import { inlineImageAsset } from "./asset-path.js";
import { hostPhrase } from "./host-phrases.js";
import { defaultBundlesRoot, studiumHome } from "./data-paths.js";
import { isTrusted, runConsent, runFingerprint, withTrusted } from "./run-trust.js";
import { checkLessonPath, parseOpenLessonQuery, rawQuery, type OpenLessonResult } from "./lesson-uri.js";
import { parseReinforcement, reviewStartReply, statusBarText, type StudyStatus } from "./study-status.js";
import { readConceptTitles } from "./bundle-titles.js";
import { parseRateRecall } from "./pane-messages.js";

type Json = Record<string, any>;

/** The currently-open lesson, exposed to the top-level "Run reproduction" command so it can drive the
 * run protocol (get_run_manifest → native task → submit_run_result) against the live session. Replaced
 * each openLesson; cleared on panel dispose. */
let activeLesson: {
  call: (name: string, args: Json) => Promise<Json>;
  sid: () => string;
  locale: () => Locale;
  /** Absolute path of the bundle file this lesson was opened from (fingerprinted for the run trust memory). */
  bundlePath: string;
  /** Close the lesson panel (used when the learner erases their data). */
  close: () => void;
  isDisposed: () => boolean;
  advance: (presentation: Json, explanation?: Json, verdict?: Json, extras?: SceneExtras) => Promise<void>;
  done: (transition: Json, message: string) => Promise<void>;
  runExclusive: <TResult>(action: () => Promise<TResult>) => Promise<ActionResult<TResult>>;
  pending: (message: string) => void;
  settled: () => void;
} | null = null;

/** What a transition carries for the pane besides the scene: the ONE navigation decision and the C4 request. */
interface SceneExtras { navigation?: Json; self_rating?: Json }

/** A concept as the pane names it: its id and the bundle's title for it (W4 review: never the bare id). */
interface NamedConcept { id: string; label: string }

/** The activity-bar sidebar; module-level so pushScene can toggle its "reproduction scene is live" state. */
let treeProvider: StudiumCoursesTreeProvider | undefined;
let extensionLocale: Locale = "fr";
/** The extension context, for globalState (run trust memory, last lesson) and globalStorageUri. */
let extensionContext: vscode.ExtensionContext | undefined;
/** What is due for review (get_next_reinforcement); feeds the status-bar item and the Reviews node. */
let studyStatus: StudyStatus | null = null;
let studyStatusItem: vscode.StatusBarItem | undefined;
let studyStatusRefreshing = false;

const TRUSTED_RUNS_KEY = "studium.trustedRuns";
const LAST_LESSON_KEY = "studium.lastLesson";
const LESSON_VIEW_TYPE = "studiumLesson";

/** What the restored pane needs to reopen the lesson it showed before a window reload. */
interface LastLesson { bundlesRoot: string; bundleRef: string; rootKind: "lesson" | "community"; }

interface TreeContents {
  courses: LessonCourse[];
  currentRef: string;
  community: CommunityItem[];
}

/** Add course-aware root shaping and descriptions without changing the shared thin tree provider. */
class StudiumCoursesTreeProvider extends StudiumTreeProvider {
  private onReproductionScene = false;
  private locale: Locale = extensionLocale;
  private reviews: StudyStatus | null = null;

  constructor(private readonly discoverContents: () => TreeContents) {
    super(() => discoverContents().community);
  }

  override setReproductionScene(on: boolean): void {
    this.onReproductionScene = on;
    super.setReproductionScene(on);
  }

  setReviews(reviews: StudyStatus | null): void {
    this.reviews = reviews;
    this.refresh();
  }

  setLocale(locale: Locale): void {
    if (this.locale === locale) return;
    this.locale = locale;
    this.refresh();
  }

  override getTreeItem(node: TreeNode): vscode.TreeItem {
    const item = super.getTreeItem(node);
    item.description = node.description;
    return item;
  }

  override getChildren(node?: TreeNode): TreeNode[] {
    if (node) return node.children ?? [];
    const contents = this.safeDiscoverContents();
    // An empty tree lets the view's welcome content (viewsWelcome) show its buttons.
    return buildLessonTree({
      ...contents, onReproductionScene: this.onReproductionScene, locale: this.locale,
      reviews: this.reviews, emptyAsWelcome: true,
    });
  }

  private safeDiscoverContents(): TreeContents {
    try {
      return this.discoverContents();
    } catch {
      return { courses: [], currentRef: "", community: [] };
    }
  }
}

/** Output channel every lesson-mcp subprocess writes its stderr to (View > Output > this name). */
const MCP_OUTPUT_CHANNEL = "Studium — lesson-mcp";

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  // The interface follows VS Code's display language until a lesson brings its own (VSC-5).
  extensionLocale = localeFromLanguage(vscode.env.language);
  // Every lesson-mcp subprocess pipes its stderr here (lesson panel AND @studium chat), so a server
  // that dies at startup leaves a readable diagnostic instead of vanishing.
  const mcpOutput = vscode.window.createOutputChannel(MCP_OUTPUT_CHANNEL);
  context.subscriptions.push(mcpOutput);
  setLessonMcpLog((line) => mcpOutput.appendLine(line));
  treeProvider = new StudiumCoursesTreeProvider(() => discoverForTree(context));
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("studiumLessons", treeProvider),
    // The tree's community leaves open a specific bundle by ref; the palette entry opens the default.
    vscode.commands.registerCommand("studium.openLesson", (ref?: unknown, source?: unknown) =>
      openLesson(context, typeof ref === "string" ? ref : undefined, source === "community" ? "community" : "lesson")),
    vscode.commands.registerCommand("studium.pickLesson", () => pickLesson(context)),
    vscode.commands.registerCommand("studium.communityContributions", () => openCommunityContribution(context)),
    vscode.commands.registerCommand("studium.runReproduction", () => runReproductionScene()),
    vscode.commands.registerCommand("studium.openWalkthrough", () => openWalkthrough(context)),
    vscode.commands.registerCommand("studium.refreshLessons", () => { treeProvider?.refresh(); void refreshStudyStatus(context); }),
    vscode.commands.registerCommand("studium.openThisLesson", (resource?: unknown) => openThisLesson(context, resource)),
    vscode.commands.registerCommand("studium.forgetMyData", () => forgetMyData(context)),
    // A harness (Codex, Claude Code) hands a lesson over with `code --open-url vscode://<id>/open?bundle=…`.
    vscode.window.registerUriHandler({ handleUri: (uri) => handleLessonUri(context, uri) }),
    // After a window reload VS Code gives the pane back to us; reopen its lesson and resume (VSC-7).
    vscode.window.registerWebviewPanelSerializer(LESSON_VIEW_TYPE, {
      deserializeWebviewPanel: (panel) => restoreLessonPanel(context, panel),
    }),
  );
  registerStudiumNotebook(context);
  registerStudiumChat(context);
  setUpStudyStatus(context);
}
export function deactivate() {}

/** Where learner state lives: VS Code's own per-user storage, independent of the telemetry setting (ENG-03). */
function learnerDataDir(context: vscode.ExtensionContext): string {
  return context.globalStorageUri.fsPath;
}

/** Environment for a lesson-mcp subprocess: bundles root, learner data in VS Code storage, consent from the setting. */
function lessonServerEnv(context: vscode.ExtensionContext, bundlesRoot: string): Record<string, string> {
  const storageDir = learnerDataDir(context);
  try { mkdirSync(storageDir, { recursive: true }); } catch { /* the server will report an unwritable dir itself */ }
  return lessonMcpEnv({
    baseEnv: process.env, bundlesRoot, storageDir, telemetryConsent: cfg<boolean>("telemetryConsent", false),
  });
}

/** The status-bar item "Studium · n à réviser" and the Reviews node, fed by get_next_reinforcement (VSC-6). */
function setUpStudyStatus(context: vscode.ExtensionContext) {
  studyStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  studyStatusItem.command = "workbench.view.extension.studium";
  context.subscriptions.push(studyStatusItem);
  // Spawning the server is only worth it for someone who has studied here before: no stored state, no check.
  if (hasLearnerData(context)) void refreshStudyStatus(context);
}

function hasLearnerData(context: vscode.ExtensionContext): boolean {
  try { return readdirSync(learnerDataDir(context)).length > 0; } catch { return false; }
}

function applyStudyStatus() {
  treeProvider?.setReviews(studyStatus);
  const shown = statusBarText(studyStatus, extensionLocale);
  if (!studyStatusItem) return;
  if (!shown) { studyStatusItem.hide(); return; }
  studyStatusItem.text = shown.text;
  studyStatusItem.tooltip = shown.tooltip;
  studyStatusItem.show();
}

/** Ask a short-lived lesson-mcp what is due for this learner. Best-effort: a failure keeps the last status. */
async function refreshStudyStatus(context: vscode.ExtensionContext): Promise<void> {
  if (studyStatusRefreshing) return;
  studyStatusRefreshing = true;
  let mcp: LessonMcp | null = null;
  try {
    const repoRoot = cfg<string>("repoRoot", resolve(context.extensionPath, "..", ".."));
    const launch = resolveServerLaunch(context.extensionPath, repoRoot);
    mcp = await connectLessonMcp({ launch, env: lessonServerEnv(context, resolveLessonBundlesRoot(context)) });
    studyStatus = parseReinforcement(await mcp.call("get_next_reinforcement", { learner_id: cfg<string>("learnerId", "vscode-learner") }));
  } catch (e: any) {
    resolveLogSink()(`[studium] review status unavailable: ${e?.message ?? e}`);
  } finally {
    mcp?.close();
    studyStatusRefreshing = false;
  }
  applyStudyStatus();
}

/** Tell the learner why a lesson path or link was refused. */
function reportLessonPathError(result: Extract<OpenLessonResult, { ok: false }>) {
  vscode.window.showErrorMessage(hostPhrase(result.error.key, { path: result.error.path ?? "" }, extensionLocale));
}

/** vscode://<publisher>.studium-vscode/open?bundle=<path of lesson.json> (C7). */
async function handleLessonUri(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  if (uri.path !== "/open") return;
  const result = parseOpenLessonQuery(rawQuery(uri.toString()), existsSync);
  if (!result.ok) { reportLessonPathError(result); return; }
  await openLesson(context, result.bundleRef, "lesson", { bundlesRoot: result.bundlesRoot });
}

/** "Studium : Ouvrir cette leçon" on a lesson.json (explorer or editor tab menu, or the active editor). */
async function openThisLesson(context: vscode.ExtensionContext, resource?: unknown): Promise<void> {
  const uri = resource instanceof vscode.Uri ? resource : vscode.window.activeTextEditor?.document.uri;
  if (!uri || uri.scheme !== "file") {
    vscode.window.showInformationMessage(hostPhrase("open_this_no_file", {}, extensionLocale));
    return;
  }
  const result = checkLessonPath(uri.fsPath, existsSync);
  if (!result.ok) { reportLessonPathError(result); return; }
  await openLesson(context, result.bundleRef, "lesson", { bundlesRoot: result.bundlesRoot });
}

/** Reopen the lesson a restored pane was showing and resume it (the learner id picks the saved progress up). */
async function restoreLessonPanel(context: vscode.ExtensionContext, panel: vscode.WebviewPanel): Promise<void> {
  const last = context.globalState.get<LastLesson>(LAST_LESSON_KEY);
  if (!last || !existsSync(join(last.bundlesRoot, last.bundleRef))) { panel.dispose(); return; }
  await openLesson(context, last.bundleRef, last.rootKind, { bundlesRoot: last.bundlesRoot, panel });
}

/** "Studium : Oublier mes données": erase what THIS extension keeps (its VS Code storage, the run trust memory and
 * the last lesson), after a confirmation that names where an assistant's Studium data lives
 * (<STUDIUM_HOME>/data, written by lesson-mcp under Claude Code or Codex), which it does not touch. */
async function forgetMyData(context: vscode.ExtensionContext): Promise<void> {
  const locale = extensionLocale;
  const action = hostPhrase("forget_data_action", {}, locale);
  const harnessData = join(studiumHome(process.env, homedir()), "data");
  const choice = await vscode.window.showWarningMessage(
    hostPhrase("forget_data_prompt", { harness_data: harnessData }, locale), { modal: true }, action);
  if (choice !== action) return;
  try {
    activeLesson?.close(); // a running lesson would write its state straight back
    rmSync(learnerDataDir(context), { recursive: true, force: true });
    await context.globalState.update(TRUSTED_RUNS_KEY, undefined);
    await context.globalState.update(LAST_LESSON_KEY, undefined);
  } catch (e: any) {
    vscode.window.showErrorMessage(hostPhrase("forget_data_failed", { error: e?.message ?? String(e) }, locale));
    return;
  }
  studyStatus = null;
  applyStudyStatus();
  vscode.window.showInformationMessage(hostPhrase("forget_data_done", {}, locale));
}

/** Open the Getting-Started walkthrough. Its id is `${extensionId}#${walkthroughId}`; deriving the extension
 *  id from context.extension.id is correct whether unpublished (undefined_publisher.studium-vscode) or
 *  published (publisher.studium-vscode) — a hardcoded string would silently open nothing in one of those. */
function openWalkthrough(context: vscode.ExtensionContext) {
  vscode.commands.executeCommand("workbench.action.openWalkthrough", `${context.extension.id}#studium.gettingStarted`, false);
}

/** Courses and community bundles shown in the sidebar, discovered from their configured roots. */
function discoverForTree(context: vscode.ExtensionContext): TreeContents {
  const lessonRoot = resolveLessonBundlesRoot(context);
  const communityRoot = resolveCommunityBundlesRoot(context);
  const canonicalRef = cfg<string>("bundleRef", "atomistique-l1/lesson.json");
  const currentRef = configuredValue<string>("bundleRef")?.trim() ?? "";
  const community = toPickItems(discoverCommunityBundles(communityRoot, canonicalRef))
    .map((pick) => ({ ref: pick.ref, label: pick.label }));
  return { courses: discoverCoursesInRoot(lessonRoot), currentRef, community };
}

// The `.studium-session/` FILE channel (packages/lesson-session-host/src/session-workspace.ts): the
// universal operator protocol Studium already ingests run results from. When the MCP submit fails, the
// run is parked here instead of being thrown away with the error toast.
const SESSION_DIR = ".studium-session";
const RUN_RESULT_FILE = "run_result.json";

/** Park an assembled RunResult on the file channel so a failed submit_run_result does not lose the run.
 *  Inputs: the workspace folder and the result. Output: true when the file was written. Atomic
 *  (tmp + rename), matching writeRunResult — a reader never sees a half-written file. */
function parkRunResult(wsFolder: string, result: RunResult): boolean {
  const target = join(wsFolder, SESSION_DIR, RUN_RESULT_FILE);
  try {
    mkdirSync(join(wsFolder, SESSION_DIR), { recursive: true });
    writeFileSync(`${target}.tmp`, JSON.stringify(result), "utf8");
    renameSync(`${target}.tmp`, target);
    return true;
  } catch {
    return false; // read-only workspace: the toast below says the run was not saved
  }
}

/** Submit the assembled run to lesson-mcp; if the submit itself fails, PARK it on the file channel so the
 *  learner's completed run is not lost with the error toast (it is ingested without re-running the capsule).
 *  Inputs: the live lesson, the workspace folder, the result. Output: the server's reply, or null when the
 *  submit failed (the learner has already been told where the result went). */
async function submitRunOrPark(lesson: NonNullable<typeof activeLesson>, wsFolder: string, result: RunResult): Promise<Json | null> {
  try {
    return await lesson.call("submit_run_result", { session_id: lesson.sid(), run_result: result });
  } catch (e: any) {
    const locale = lesson.locale();
    const isParked = parkRunResult(wsFolder, result);
    const rescue = isParked
      ? phrase("extension_saved_run", { path: `${SESSION_DIR}/${RUN_RESULT_FILE}` }, locale)
      : phrase("extension_unsaved_run", {}, locale);
    vscode.window.showErrorMessage(phrase("extension_run_submit_failed", { error: e.message, rescue }, locale));
    return null;
  }
}

/** Toggle the live reproduction-scene state on the sidebar + the `when`-clause context key. */
function setReproductionContext(on: boolean) {
  treeProvider?.setReproductionScene(on);
  vscode.commands.executeCommand("setContext", "studium.onReproductionScene", on);
}

/**
 * Surface the learner-time RUN manifest of the current scene as a NATIVE VS Code task. The run protocol
 * is pure delegation — Studium NEVER executes; the OPERATOR's environment does. In VS Code the operator
 * is the user's workspace: get_run_manifest → a shell task that provisions + runs the capsule in the
 * integrated terminal → buildRunResult from the produced outputs → submit_run_result (the host gates
 * advance on ran && passed). This is "let VS Code handle the environment and install" made literal.
 */
async function runReproductionScene() {
  if (!activeLesson || activeLesson.isDisposed()) {
    vscode.window.showInformationMessage(phrase("extension_open_lesson_first", {}, extensionLocale));
    return;
  }
  const lesson = activeLesson;
  const result = await lesson.runExclusive(async () => {
    lesson.pending(phrase("extension_running", {}, lesson.locale()));
    try { await runReproductionForLesson(lesson); }
    finally { lesson.settled(); }
  });
  if (result.status === "busy") {
    vscode.window.showInformationMessage(phrase("extension_action_busy", {}, lesson.locale()));
  }
}

/** Read the bundle file for fingerprinting; null when it is missing or unreasonably large. */
function readBundleBytes(path: string): Buffer | null {
  try {
    if (statSync(path).size > 64 * 1024 * 1024) return null;
    return readFileSync(path);
  } catch { return null; }
}

/** The run confirmation (ENG-02): a modal with the exact command, packages and folder. A bundle the learner
 * chose to trust is remembered by fingerprint, so the same bundle does not ask twice. Returns whether to run. */
async function confirmRun(lesson: NonNullable<typeof activeLesson>, manifest: RunManifest, spec: ReturnType<typeof runManifestToTaskSpec>, cwd: string): Promise<boolean> {
  const locale = lesson.locale();
  const fingerprint = runFingerprint(readBundleBytes(lesson.bundlePath), manifest);
  const trusted = extensionContext?.globalState.get<string[]>(TRUSTED_RUNS_KEY, []) ?? [];
  if (isTrusted(trusted, fingerprint)) return true;
  const consent = runConsent(manifest, spec, cwd, locale);
  const choice = await vscode.window.showWarningMessage(consent.message, { modal: true, detail: consent.detail }, consent.runLabel, consent.trustLabel);
  if (choice === consent.trustLabel) {
    await extensionContext?.globalState.update(TRUSTED_RUNS_KEY, withTrusted(trusted, fingerprint));
    return true;
  }
  if (choice === consent.runLabel) return true;
  vscode.window.showInformationMessage(hostPhrase("run_declined", {}, locale));
  return false;
}

/** Execute one reproduction after the caller has acquired the lesson panel's exclusive gate. */
async function runReproductionForLesson(lesson: NonNullable<typeof activeLesson>) {
  const locale = lesson.locale();
  let manifest: RunManifest | null;
  try {
    manifest = ((await lesson.call("get_run_manifest", { session_id: lesson.sid() })).run_manifest as RunManifest | null) ?? null;
  } catch (e: any) { vscode.window.showErrorMessage(`Studium: ${e.message}`); return; }
  if (!manifest) {
    vscode.window.showInformationMessage(phrase("extension_no_capsule", {}, locale));
    return;
  }
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsFolder) { vscode.window.showErrorMessage(phrase("extension_open_workspace", {}, locale)); return; }

  // ENG-02: the bundle chose this command, package list and folder. Refuse a folder outside the workspace,
  // then show exactly what will run and wait for the learner's go-ahead before anything starts.
  const dirProblem = workingDirProblem(manifest.working_dir);
  if (dirProblem) {
    vscode.window.showErrorMessage(hostPhrase(dirProblem === "absolute" ? "run_refused_absolute" : "run_refused_parent",
      { dir: manifest.working_dir ?? "" }, locale));
    return;
  }
  const spec = runManifestToTaskSpec(manifest);
  const cwd = join(wsFolder, spec.cwd);
  if (!(await confirmRun(lesson, manifest, spec, cwd))) return;
  // A CustomExecution backed by a Pseudoterminal so we CAPTURE the run's stdout (a plain ShellExecution
  // hands us only the exit code). The learner's OWN landmark is parsed from that stdout — without it the
  // run has landmark=null and attestation quarantines it, so the judgment falls back to a canned number
  // instead of grounding on the value the learner actually produced. Studium's BRAIN still never executes:
  // the extension is the operator's harness (VS Code = the operator's environment), and lesson-mcp only
  // ever receives the finished run_result. Capture is in-process (child_process) → cross-platform, no
  // workspace-polluting `tee`.
  const { pty, done } = spawnCapturingPty(spec.command, cwd, manifest.timeout_s);
  const task = new vscode.Task(
    { type: "studium-run", capsule: manifest.capsule_ref },
    vscode.TaskScope.Workspace, spec.name, "studium",
    new vscode.CustomExecution(async () => pty),
  );
  try { await vscode.tasks.executeTask(task); }
  catch (e: any) { vscode.window.showErrorMessage(phrase("extension_task_failed", { error: e.message }, locale)); return; }

  // When the captured process ends, parse the learner's landmark, assemble run_result.json, submit it.
  const { exitCode, stdout } = await done;
  if (lesson.isDisposed()) return;
  const landmark = extractLandmark(stdout, manifest.landmark_pattern);
  // Pass the FULL stdout — buildRunResult evaluates verify_checks against all of it (an early
  // `stdout contains:` marker must not be missed) and stores only a bounded tail on the wire.
  const result = buildRunResult(manifest, {
    exitCode,
    fileExists: (p) => existsSync(join(wsFolder, p)),
    landmark,
    stdout,
  });
  const r = await submitRunOrPark(lesson, wsFolder, result);
  if (!r || lesson.isDisposed()) return;
  try {
    if (r.status === "ran" && r.transition) {
      // ATTESTATION (D5) made legible: a `ran` run always advances (pure-delegation gate), but only an
      // ATTESTED run grounds the next judgment on the learner's OWN result. Surface which happened —
      // "attested = internally consistent with the manifest", NOT "verified genuine" (attestation is
      // structural, brain-only; a perfect forgery still attests — never over-claim the guarantee).
      if (r.attested && r.learner_run_recorded) {
        vscode.window.showInformationMessage(phrase("extension_run_attested", {}, locale));
      } else {
        const why = Array.isArray(r.attestation_reasons) && r.attestation_reasons.length
          ? phrase("extension_attestation_reasons", { reasons: r.attestation_reasons.join(" · ") }, locale) : "";
        vscode.window.showWarningMessage(
          phrase("extension_run_quarantined", { why }, locale),
        );
      }
      if (r.transition.kind === "complete") await lesson.done(r.transition, phrase("extension_lesson_complete", {
        count: r.transition.summary?.scenesCompleted ?? "?",
      }, locale));
      else await lesson.advance(r.transition.presentation, undefined, r.transition.verdict,
        { navigation: r.transition.navigation, self_rating: r.transition.self_rating });
    } else {
      vscode.window.showWarningMessage(phrase("extension_run_rejected", { status: r.status }, locale));
    }
  } catch (e: any) { vscode.window.showErrorMessage(`Studium: ${e.message}`); }
}

/**
 * A vscode.Pseudoterminal that spawns the capsule command in the workspace and CAPTURES its stdout while
 * streaming it to the terminal the learner watches. Returns the pty (for a CustomExecution) plus a `done`
 * promise that resolves with { exitCode, stdout } when the child closes. stderr is echoed to the terminal
 * (no longer silently discarded) but is not parsed for the landmark. Newlines are CRLF-normalized for the
 * terminal. The extension is the OPERATOR's harness here — Studium's brain (lesson-mcp) still never runs.
 */
function spawnCapturingPty(command: string, cwd: string, timeoutS?: number): {
  pty: vscode.Pseudoterminal;
  done: Promise<{ exitCode: number | null; stdout: string }>;
} {
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<number>();
  let stdout = "";
  let child: ReturnType<typeof spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let settle!: (v: { exitCode: number | null; stdout: string }) => void;
  const done = new Promise<{ exitCode: number | null; stdout: string }>((res) => { settle = res; });
  // Settle `done` at most once and always clear the watchdog. Idempotent so 'error' then 'close', a
  // timeout kill, and a terminal-close teardown can all call it without double-resolving or hanging.
  const finish = (exitCode: number | null) => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (settled) return;
    settled = true;
    settle({ exitCode, stdout });
  };
  const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");
  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    open: () => {
      writeEmitter.fire(crlf(`$ ${command}\n`));
      try { child = spawn(command, { cwd, shell: true }); }
      catch (e: any) { writeEmitter.fire(crlf(`[studium] spawn error: ${e?.message}\n`)); closeEmitter.fire(1); finish(1); return; }
      // Watchdog: a capsule that never exits (infinite loop, blocked on stdin, network stall) would leave
      // the caller awaiting `done` forever. When the manifest declares a timeout, kill the child at the
      // deadline; its 'close' event then settles `done` (a timed-out run is quarantined, not hung).
      if (timeoutS && timeoutS > 0) {
        timer = setTimeout(() => {
          writeEmitter.fire(crlf(`${phrase("extension_timeout", { seconds: timeoutS }, extensionLocale)}\n`));
          child?.kill();
        }, timeoutS * 1000);
      }
      child.stdout?.on("data", (d: Buffer) => { const s = d.toString(); stdout += s; writeEmitter.fire(crlf(s)); });
      child.stderr?.on("data", (d: Buffer) => { writeEmitter.fire(crlf(d.toString())); });
      child.on("error", (e) => { writeEmitter.fire(crlf(`[studium] ${e.message}\n`)); closeEmitter.fire(1); finish(1); });
      child.on("close", (code) => { closeEmitter.fire(code ?? 0); finish(code); });
    },
    // If the learner closes the terminal before the capsule finishes, KILL the child (it is NOT detached,
    // so it would otherwise be orphaned) and settle `done` (exitCode=null → ran=false) so the awaiting
    // caller resumes instead of hanging. (kill() targets the shell; a deeply-nested grandchild on a hung
    // pipe may outlive it — a known shell:true limitation — but the run protocol is unblocked regardless.)
    close: () => { child?.kill(); finish(null); },
  };
  return { pty, done };
}

function cfg<T>(key: string, fallback: T): T {
  const v = vscode.workspace.getConfiguration("studium").get<T>(key);
  return v === undefined || v === "" ? fallback : v;
}

/** Return only an explicitly stored setting, excluding package defaults. */
function configuredValue<T>(key: string): T | undefined {
  const inspected = vscode.workspace.getConfiguration("studium").inspect<T>(key);
  return inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
}

/** Resolve the lesson BUNDLES_ROOT used by course discovery and canonical lesson opens. */
function resolveLessonBundlesRoot(context: vscode.ExtensionContext): string {
  const repoRoot = cfg<string>("repoRoot", resolve(context.extensionPath, "..", ".."));
  // Unset: a checkout's fixtures/, else the personal library (~/.studium/library), where a lesson an
  // assistant built lands. A packaged VSIX has no checkout, so it must not default to a folder that cannot exist.
  return cfg<string>("bundlesRoot", defaultBundlesRoot({ repoRoot, exists: existsSync, env: process.env, homedir: homedir() }));
}

/** Resolve the optional community root while preserving the lesson root as its fallback. */
function resolveCommunityBundlesRoot(context: vscode.ExtensionContext): string {
  return cfg<string>("communityBundlesRoot", resolveLessonBundlesRoot(context));
}

function bundleExists(bundlesRoot: string, bundleRef: string): boolean {
  const root = resolve(bundlesRoot);
  const candidate = resolve(root, bundleRef);
  const fromRoot = relative(root, candidate);
  if (!fromRoot || isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith("../") || fromRoot.startsWith("..\\")) return false;
  return existsSync(candidate);
}

/**
 * "Contributions de la classe / Community contributions" — discover the approved, learner-authored
 * community bundles sitting in the bound course's community/ subdir (emitted by the scene-synth
 * decide_item approve path, packages/lesson-session-host/src/community-bundles.ts contract) and let
 * the learner pick one to open. A chosen community bundle opens through the SAME open-lesson path as
 * the canonical bundle (openLesson with the community ref) — the canonical course stays immutable;
 * community items are purely additive. No author identity is ever shown (the emitted bundle is
 * pseudonym-scrubbed; the picker shows only the neutral item id).
 */
async function openCommunityContribution(context: vscode.ExtensionContext) {
  const bundlesRoot = resolveCommunityBundlesRoot(context);
  const canonicalRef = cfg<string>("bundleRef", "atomistique-l1/lesson.json");
  let bundles;
  try {
    bundles = discoverCommunityBundles(bundlesRoot, canonicalRef);
  } catch (e: any) {
    vscode.window.showErrorMessage(hostPhrase("community_scan_failed", { error: e.message }, extensionLocale));
    return;
  }
  if (bundles.length === 0) {
    vscode.window.showInformationMessage(
      phrase("extension_no_community", {}, extensionLocale),
    );
    return;
  }
  const picks = toPickItems(bundles);
  const chosen = await vscode.window.showQuickPick(picks, {
    title: phrase("extension_community_title", {}, extensionLocale),
    placeHolder: phrase("extension_community_placeholder", {}, extensionLocale),
    matchOnDescription: true,
  });
  if (!chosen) return; // dismissed
  // Open the chosen community bundle EXACTLY like the canonical one — reuse openLesson with the
  // community ref as the bundleRef override. resolveBundle / start_lesson_session load it unchanged.
  await openLesson(context, chosen.ref, "community");
}

type LessonRootKind = "lesson" | "community";

/** Let the learner choose a discovered course or another bundles root, persist it, then open it. */
async function pickLesson(context: vscode.ExtensionContext) {
  let bundlesRoot = resolveLessonBundlesRoot(context);
  for (;;) {
    const chosen = await showLessonChoices(bundlesRoot);
    if (!chosen) return;
    if (chosen.action === "folder") {
      const selected = await chooseBundlesRoot();
      if (!selected) return;
      bundlesRoot = selected;
      continue;
    }
    if (!chosen.ref) return;
    await saveAndOpenLesson(context, bundlesRoot, chosen.ref);
    return;
  }
}

async function showLessonChoices(bundlesRoot: string): Promise<LessonPickerChoice | undefined> {
  const choices = toLessonPickerChoices(discoverCoursesInRoot(bundlesRoot), bundlesRoot, extensionLocale);
  return vscode.window.showQuickPick(choices, {
    title: phrase("picker_title", {}, extensionLocale),
    placeHolder: choices.length === 1
      ? phrase("picker_empty", {}, extensionLocale)
      : phrase("picker_choose", {}, extensionLocale),
    matchOnDescription: true,
    matchOnDetail: true,
  });
}

async function chooseBundlesRoot(): Promise<string | undefined> {
  const selected = await vscode.window.showOpenDialog({
    title: phrase("picker_folder_title", {}, extensionLocale),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
  });
  return selected?.[0]?.fsPath;
}

async function saveLessonSelection(bundlesRoot: string, bundleRef: string): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("studium");
  await configuration.update("bundlesRoot", bundlesRoot, vscode.ConfigurationTarget.Workspace);
  await configuration.update("bundleRef", bundleRef, vscode.ConfigurationTarget.Workspace);
}

async function saveAndOpenLesson(context: vscode.ExtensionContext, bundlesRoot: string, bundleRef: string): Promise<void> {
  try {
    await saveLessonSelection(bundlesRoot, bundleRef);
  } catch (error: any) {
    vscode.window.showErrorMessage(phrase("extension_save_course_failed", { error: error.message }, extensionLocale));
    return;
  }
  treeProvider?.refresh();
  await openLesson(context, bundleRef, "lesson");
}

/** Where an open comes from when it is not the settings: an explicit bundles root (a link, "Open this lesson",
 * a restored pane) and, for a restored pane, the panel VS Code already created. */
interface OpenLessonOptions { bundlesRoot?: string; panel?: vscode.WebviewPanel; }

async function openLesson(
  context: vscode.ExtensionContext,
  bundleRefOverride?: string,
  rootKind: LessonRootKind = "lesson",
  options: OpenLessonOptions = {},
) {
  // The extension ships inside the monorepo (apps/studium-vscode); default repoRoot = ../../ .
  const repoRoot = cfg<string>("repoRoot", resolve(context.extensionPath, "..", ".."));
  const lessonBundlesRoot = resolveLessonBundlesRoot(context);
  const configuredRef = configuredValue<string>("bundleRef")?.trim();
  if (!bundleRefOverride && needsLessonPicker(configuredRef, (ref) => bundleExists(lessonBundlesRoot, ref))) {
    await pickLesson(context);
    return;
  }
  let serverLaunch;
  try {
    serverLaunch = resolveServerLaunch(context.extensionPath, repoRoot);
  } catch (e: any) {
    const open = phrase("extension_open_settings", {}, extensionLocale);
    vscode.window.showErrorMessage(`Studium: ${e.message}`, open).then((pick) => {
      if (pick === open) vscode.commands.executeCommand("workbench.action.openSettings", "studium.repoRoot");
    });
    return;
  }
  // Default to the repo's own fixtures/ + the atomistique bundle, so it runs zero-config from any
  // clone. Override studium.bundlesRoot / studium.bundleRef to point elsewhere. A community bundle
  // opened via "Contributions de la classe" passes its ref as bundleRefOverride — it loads through
  // this SAME path as the canonical bundle (the course stays immutable; community items are additive).
  // When opening a community bundle, root BUNDLES_ROOT at the SAME root discovery used
  // (resolveCommunityBundlesRoot honours studium.communityBundlesRoot) so the community ref resolves; a
  // canonical open keeps the plain lesson bundlesRoot.
  const bundlesRoot = options.bundlesRoot ?? (rootKind === "community" ? resolveCommunityBundlesRoot(context) : lessonBundlesRoot);
  const bundleRef = bundleRefOverride ?? configuredRef!;
  const learnerId = cfg<string>("learnerId", "vscode-learner");
  const conceptTitles = readConceptTitles(join(bundlesRoot, bundleRef));
  /** Concept ids as the pane names them: the bundle's title, else the id without its "concept:" prefix. */
  const named = (ids: string[]): NamedConcept[] => ids.map((id) => {
    const bare = id.replace(/^concept:/, "");
    return { id, label: conceptTitles[id] ?? conceptTitles[bare] ?? bare };
  });

  const assets = cfg<"vendor" | "cdn">("assets", "vendor");
  const paneOptions = { enableScripts: true, localResourceRoots: [vscode.Uri.file(join(context.extensionPath, "media"))] };
  // A restored pane arrives already created, without its options or content: give it both.
  const panel = options.panel ?? vscode.window.createWebviewPanel(
    LESSON_VIEW_TYPE, phrase("extension_lesson_panel", {}, extensionLocale), vscode.ViewColumn.Beside,
    { ...paneOptions, retainContextWhenHidden: true },
  );
  if (options.panel) { panel.webview.options = paneOptions; panel.title = phrase("extension_lesson_panel", {}, extensionLocale); }
  panel.webview.html = paneHtml(panel.webview, context.extensionPath, assets, extensionLocale);

  // Register disposal BEFORE the asynchronous connection starts. If the learner closes the pane
  // while the subprocess is still opening, the lifecycle closes the late connection on arrival.
  const lifecycle = new LessonPanelLifecycle<LessonMcp>();
  let panelDisposed = false;
  panel.onDidDispose(() => { panelDisposed = true; lifecycle.dispose(); void refreshStudyStatus(context); });

  // 1) connect to lesson-mcp over stdio
  // Learner state goes to VS Code's own storage whatever the telemetry setting says (ENG-03).
  const env = lessonServerEnv(context, bundlesRoot);
  const mcpLog = resolveLogSink();
  mcpLog(`[studium] lesson-mcp launch: ${describeServerLaunch(serverLaunch)}`);
  let mcp: LessonMcp | null;
  try {
    mcp = await lifecycle.connect(() => connectLessonMcp({ launch: serverLaunch, env }));
  } catch (e: any) {
    if (panelDisposed) return;
    panel.webview.postMessage({
      type: "error",
      message: phrase("extension_connection_failed", { error: e.message }, extensionLocale),
    });
    vscode.window.showErrorMessage(hostPhrase("connect_failed_notification", { error: e.message }, extensionLocale));
    return;
  }
  if (!mcp) return;
  const call = mcp.call;
  panel.webview.postMessage({ type: "loading", message: phrase("extension_service_ready", {}, extensionLocale) });
  // Say which server actually answered (version, bundled-vs-source, build date, git sha) in the
  // output channel, so a stale VSIX or a source checkout is a readable fact rather than a guess
  // (audit 2026-10-29, P11/V2). Best-effort: an older server without get_server_info still runs.
  try {
    const serverInfo = await call("get_server_info", {}) as any;
    mcpLog(serverInfoLine(serverInfo));
    const warning = serverBuildWarning(serverInfo, repoRoot);
    if (warning) mcpLog(warning);
  }
  catch (e: any) { mcpLog(`[studium] get_server_info unavailable: ${e?.message ?? e}`); }
  if (panelDisposed) return;

  let sid = "";
  let locale: Locale = extensionLocale;

  // Companion live GRAPH panel (typed-graph-lens). The extension turns the GraphView from
  // get_workflow_graph into Cytoscape elements + a stylesheet (same package the host used to build
  // it) and posts them; graph-pane.js just lays out + renders. Repainted each turn, in lockstep.
  const showGraph = cfg<boolean>("showGraph", true);
  const graphMode = cfg<"student" | "teacher">("graphView", "student");
  // Live per-concept mastery is a learner-model / teacher signal: showing it to the student during a
  // quiz leaks the answer (click options, watch which raises mastery). Off by default; on for demos.
  const showMastery = cfg<boolean>("showMastery", false);
  // Modality-adaptive rendering (Ciussi, "comment mieux apprendre si je suis visuel"): the learner
  // declares whether they learn better VISUALLY or TEXTUALLY, and the SAME scene's artifacts are
  // reordered + emphasized to lead with that modality. 'balanced' = current behaviour. Content-
  // preserving — selectRenderOrder only permutes + tags, never drops an artifact.
  const modalityPref = cfg<ModalityPreference>("modalityPreference", "balanced");
  let graphPanel: vscode.WebviewPanel | undefined;
  if (showGraph) {
    const gp = vscode.window.createWebviewPanel(
      "studiumGraph", phrase("extension_graph_panel", {}, extensionLocale), vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [vscode.Uri.file(join(context.extensionPath, "media"))], retainContextWhenHidden: true },
    );
    gp.webview.html = graphHtml(gp.webview, context.extensionPath, assets, extensionLocale);
    gp.onDidDispose(() => { if (graphPanel === gp) graphPanel = undefined; });
    graphPanel = gp;
  }
  panel.onDidDispose(() => { try { graphPanel?.dispose(); } catch { /* already gone */ } });
  const pushGraph = async () => {
    if (!graphPanel || !sid) return;
    try {
      const g = (await call("get_workflow_graph", { session_id: sid })).graph as GraphView | null;
      if (!g || !graphPanel) return; // graphPanel may have been disposed during the await
      const view = graphMode === "student" ? egoFilter(g) : g;
      graphPanel.webview.postMessage({
        // VSC-5: graph-pane.js words its chrome from these (its built-in defaults are French).
        type: "graph", locale, strings: browserPhrases(locale), elements: toCytoscape(view), style: buildStylesheet(),
        title: g.title ?? "", legend: g.legend ?? [], focus: g.focus ?? null, mode: graphMode,
      });
    } catch { /* the graph is best-effort; never let it break the lesson */ }
  };

  const pushScene = async (presentation: Json, explanation?: Json, verdict?: Json, extras: SceneExtras = {}) => {
    if (panelDisposed || lifecycle.isDisposed()) return;
    locale = presentation.locale === "en" ? "en" : "fr";
    extensionLocale = locale;
    treeProvider?.setLocale(locale);
    panel.title = phrase("extension_lesson_panel", {}, locale);
    if (graphPanel) graphPanel.title = phrase("extension_graph_panel", {}, locale);
    const artifacts = (await call("get_scene_artifacts", { session_id: sid })).scene_assets || [];
    if (panelDisposed) return;
    // Spaced-repetition: which concepts are DUE for review (per the FSRS scheduler in
    // packages/adaptation-engine/src/fsrs.ts). Derived from the learner state get_session_state
    // already exposes. Best-effort — never let it break the lesson; it is a recall-timing cue, not
    // a mastery score, so it is always shown to the learner (no answer leak).
    let reviewDue: NamedConcept[] = [];
    let calibration: CalibrationVerdict[] = [];
    try {
      const st = (await call("get_session_state", { session_id: sid })).state;
      reviewDue = named(reviewDueConcepts(st));
      // Metacognitive calibration mirror (B1): a NUMBER-FREE "bien/sur/sous calibré·e" verdict per
      // concept, derived from the same state. Safe to show — it never exposes mastery or the raw gap.
      calibration = calibrationVerdicts(st, locale);
    } catch { /* best-effort */ }
    if (panelDisposed) return;
    panel.webview.postMessage({
      type: "render",
      locale,
      strings: browserPhrases(locale),
      // Modality-adaptive: reorder + emphasis-tag the (image-inlined) assets for the learner's
      // preference before posting. 'balanced' returns the authored order unchanged, all 'normal'.
      scene_assets: selectRenderOrder(
        artifacts.map((asset: Json) => inlineImageAsset(bundlesRoot, bundleRef, asset)),
        modalityPref,
      ),
      modalityPreference: modalityPref,
      scene: presentation.scene,
      progress: { index: (presentation.index ?? 0) + 1, total: presentation.total },
      mastery: showMastery ? (presentation.learnerSnapshot?.conceptMastery ?? {}) : {},
      reviewDue,
      calibration,
      explanation: explanation ?? presentation.explanation ?? null,
      // The graded verdict of the answer that led here (quiz: correct + the matching feedback
      // only, never the other branch; ungraded scenes: an acknowledgement). The engine releases
      // it on the transition; before 2026-10-29 the pane never showed it (audit P2).
      verdict: verdict ?? null,
      // The ONE navigation decision behind this scene: the pane words it from navigation.kind and never
      // prints rule_id or reason (VSC-2).
      navigation: extras.navigation ?? null,
      // C4: the self-rating request of an uncertified production answer; it names its scene.
      self_rating: extras.self_rating ?? null,
      // Who wrote the lesson; a self-authored one carries a notice the pane shows above the scene.
      authoring: presentation.authoring ?? null,
    });
    await pushGraph();
    // When the current scene is a reproduction the LEARNER must run, light up the sidebar's run action +
    // the when-clause context, and nudge them. The run_manifest is non-answer-bearing (publicScene keeps it).
    const isReproScene = presentation.scene?.type === "reproduction" && !!presentation.scene?.run_manifest;
    setReproductionContext(isReproScene);
    if (isReproScene) {
      vscode.window.showInformationMessage(
        phrase("extension_reproduction_notice", {}, locale),
      );
    }
  };

  /** VSC-6: the end-of-lesson screen. Concepts are named, never scored: only concepts with a graded attempt
   * are claimed consolidated (mastery >= 0.6, the threshold of chat-display.ts) or to revisit. */
  const completionPayload = async (t: Json): Promise<Json> => {
    const mastery: Record<string, number> = t.summary?.mastery ?? {};
    const states: Record<string, Json> = t.summary?.finalState?.concept_states ?? {};
    const graded = Object.keys(mastery).filter((id) => (states[id]?.total_attempts ?? 0) > 0);
    let dueNow = 0;
    try { dueNow = parseReinforcement(await call("get_next_reinforcement", { session_id: sid })).dueCount; } catch { /* best-effort */ }
    return {
      consolidated: named(graded.filter((id) => mastery[id]! >= 0.6)),
      to_revisit: named(graded.filter((id) => mastery[id]! < 0.6)),
      detours: Object.values((t.summary?.scenes_detoured ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0),
      next_review_at: t.review_plan?.next_due_at ?? null,
      due_now: dueNow,
      actions: [...(dueNow > 0 ? ["review"] : []), "restart", "pick"],
    };
  };
  const donePayload = async (t: Json, message: string): Promise<Json> => ({
    message,
    verdict: t.verdict ?? null,            // the last answer's verdict: the pane shows it as a step first
    self_rating: t.self_rating ?? null,
    calibration: calibrationVerdicts(t.summary?.finalState ?? {}, locale),
    completion: await completionPayload(t),
  });

  // Expose this lesson to the top-level "Run reproduction" command (it drives get_run_manifest →
  // native task → submit_run_result against this live session). Latest open wins; cleared on dispose.
  // The dispose-clear guards by OBJECT IDENTITY (not sid value) so it can't null a different live
  // lesson during the brief window where two sessions share the empty sentinel sid (pre-start).
  const thisLesson = {
    call,
    sid: () => sid,
    locale: () => locale,
    bundlePath: join(bundlesRoot, bundleRef),
    close: () => { if (!panelDisposed) panel.dispose(); },
    isDisposed: () => panelDisposed || lifecycle.isDisposed(),
    advance: (presentation: Json, explanation?: Json, verdict?: Json, extras?: SceneExtras) =>
      pushScene(presentation, explanation, verdict, extras),
    done: async (t: Json, message: string) => {
      const payload = await donePayload(t, message);
      if (!panelDisposed) panel.webview.postMessage({ type: "done", ...payload });
      void refreshStudyStatus(context);
    },
    runExclusive: <TResult>(action: () => Promise<TResult>) => lifecycle.runExclusive(action),
    pending: (message: string) => { if (!panelDisposed) panel.webview.postMessage({ type: "action_pending", message }); },
    settled: () => { if (!panelDisposed) panel.webview.postMessage({ type: "action_settled" }); },
  };
  activeLesson = thisLesson;
  panel.onDidDispose(() => {
    if (activeLesson === thisLesson) activeLesson = null;
    setReproductionContext(false); // the run action is scene-scoped; clear it when the lesson closes
  });

  // 2) learner actions from the pane → MCP calls → next render (pair by pair)
  panel.webview.onDidReceiveMessage(async (msg: Json) => {
    try {
      const result = await lifecycle.runExclusive(async () => {
        if (msg.type === "rateRecall") {
          // The learner's self-rating of a recall (C4) feeds spaced review only, never mastery. The webview is
          // untrusted: check the message shape here; the server validates the grade again.
          const rating = parseRateRecall(msg);
          if (!rating) return;
          await call("rate_recall", { session_id: sid, scene_id: rating.sceneId, grade: rating.grade });
          if (!panelDisposed) panel.webview.postMessage({ type: "recall_rated", sceneId: rating.sceneId, grade: rating.grade });
          return;
        }
        if (msg.type === "hint") {
          const h = (await call("request_hint", { session_id: sid })).hint;
          if (!panelDisposed) panel.webview.postMessage({ type: "hint", hint: h?.hint ?? null, remaining: h?.remaining });
          return;
        }
        if (msg.type === "end") {
          // Right to be forgotten: forget_session emits forget_requested and PURGES the durable per-learner
          // state on disk (in consented/durable mode). Irreversible, so confirm first; closing the panel
          // alone only drops the transport and leaves the saved state intact (so a learner can resume).
          const ok = await vscode.window.showWarningMessage(
            phrase("extension_forget_prompt", {}, locale),
            { modal: true }, phrase("extension_forget_action", {}, locale),
          );
          if (ok === phrase("extension_forget_action", {}, locale)) {
            try { await call("forget_session", { session_id: sid }); } catch { /* already gone */ }
            panel.dispose();
          } else if (!panelDisposed) {
            panel.webview.postMessage({ type: "action_settled" });
          }
          return;
        }
        if (msg.type === "turn") {
          // a discussion turn: score it (reasoning signal) + get the Socratic tutor's reply, WITHOUT
          // advancing the scene. The pane appends both to the transcript; the learner ends the scene
          // with the "Terminer" ack (a normal respond). After max_turns the server no-ops the turn.
          const r = await call("submit_turn", { session_id: sid, text: String(msg.text ?? "") });
          if (!panelDisposed) panel.webview.postMessage({ type: "turn_result", reasoning: r.reasoning ?? null, tutor: r.tutor ?? null });
          return;
        }
        if (msg.type === "run") {
          // VSC-8: the pane's « Lancer la reproduction » button. Same flow as the command, inside the gate this
          // handler already holds (runReproductionScene would take it again and report busy).
          thisLesson.pending(phrase("extension_running", {}, locale));
          try { await runReproductionForLesson(thisLesson); } finally { thisLesson.settled(); }
          return;
        }
        if (msg.type === "reviewNow") {
          // VSC-6: « Réviser maintenant » plays the due reviews (C1 start_review_session) in this pane.
          const r = await call("start_review_session", { learner_id: learnerId });
          if (panelDisposed) return;
          if (r.status !== "started") {
            // Nothing due is a calm notice with the next review date, in the lesson's language; any other reply
            // that did not start stays an action error, never an empty one.
            panel.webview.postMessage(reviewStartReply(r, locale));
            return;
          }
          sid = r.session_id;
          await pushScene(r.presentation);
          return;
        }
        if (msg.type === "restartLesson") {
          // « Revoir le parcours »: a completed lesson restarts at scene zero as a retake (start_lesson_session).
          const started = await call("start_lesson_session", { bundle_ref: bundleRef, learner_id: learnerId });
          if (panelDisposed) return;
          sid = started.session_id;
          await pushScene(started.presentation);
          return;
        }
        if (msg.type === "pickCourse") {
          if (!panelDisposed) panel.webview.postMessage({ type: "action_settled" });
          void vscode.commands.executeCommand("studium.pickLesson");
          return;
        }
        if (msg.type === "respond") {
          const t = (await call("submit_response", { session_id: sid, input: msg.input })).transition;
          if (panelDisposed) return;
          if (t.kind === "complete") {
            void refreshStudyStatus(context); // the next review date may have just changed
            panel.webview.postMessage({ type: "done",
              ...(await donePayload(t, phrase("extension_done", { count: t.summary.scenesCompleted }, locale))) });
            return;
          }
          resolveLogSink()(`[studium] navigation ${JSON.stringify(t.navigation ?? null)}`); // raw ids stay in the log
          await pushScene(t.presentation, undefined, t.verdict, { navigation: t.navigation, self_rating: t.self_rating });
        }
      });
      if (result.status === "busy") {
        // A busy gate must answer, or the pane stays pending.
        if (!panelDisposed) panel.webview.postMessage({ type: "action_error", message: phrase("extension_action_busy", {}, locale) });
        return;
      }
    } catch (e: any) {
      if (!panelDisposed) panel.webview.postMessage({ type: "action_error", message: e.message });
      if (!panelDisposed) vscode.window.showErrorMessage(`Studium: ${e.message}`);
    }
  });

  // 3) start
  try {
    const started = await call("start_lesson_session", { bundle_ref: bundleRef, learner_id: learnerId });
    sid = started.session_id;
    // Remember what this pane shows, so a window reload can reopen it (see restoreLessonPanel).
    void context.globalState.update(LAST_LESSON_KEY, { bundlesRoot, bundleRef, rootKind } satisfies LastLesson);
    await pushScene(started.presentation);
    vscode.window.showInformationMessage(phrase("extension_started", { bundle: bundleRef }, locale));
  } catch (e: any) {
    // Replace the loading placeholder with an in-pane error so the panel is never stuck on "Chargement…".
    if (panelDisposed) return;
    lifecycle.dispose();
    if (activeLesson === thisLesson) activeLesson = null;
    setReproductionContext(false);
    panel.webview.postMessage({ type: "error", message: phrase("extension_start_failed", { error: e.message }, locale) });
    vscode.window.showErrorMessage(phrase("extension_start_failed_notification", { error: e.message }, locale));
  }
}

function nonce() { return Array.from({ length: 16 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join(""); }

function paneHtml(webview: vscode.Webview, extPath: string, assets: "vendor" | "cdn", locale: Locale): string {
  const media = (f: string) => webview.asWebviewUri(vscode.Uri.file(join(extPath, "media", f)));
  const n = nonce();
  // Marked + KaTeX + Vega(-Lite/-Embed) + 3Dmol make prose, equations, plots and molecules rich; if they do not
  // load, the renderer degrades to styled code + an inline-SVG bar chart (same code path). `vendor` (the default)
  // ships the libs inside media/vendor: air-gap safe, and the pane loads nothing from the network. `cdn` is the
  // learner's opt-in to network assets: the same files from jsdelivr, pinned to the vendored versions and checked
  // by Subresource Integrity, and only then may remote images load (ENG-10).
  const cdn = assets === "cdn";
  const origin = cdn ? "https://cdn.jsdelivr.net" : "";
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:${cdn ? " https:" : ""}`,
    `style-src ${webview.cspSource} ${origin} 'unsafe-inline'`,
    `font-src ${webview.cspSource} ${origin}`,
    `script-src 'nonce-${n}' ${origin}`,
  ].join("; ");
  // [jsdelivr path, vendored copy, sha384 of those exact bytes]: the CDN file must be the vendored one.
  type Lib = readonly [cdnPath: string, vendored: string, integrity: string];
  const katexCss: Lib = ["katex@0.16.9/dist/katex.min.css", "vendor/katex/katex.min.css", "sha384-n8MVd4RsNIU0tAv4ct0nTaAbDJwPJzDEaqSD1odI+WdtXRGWt2kTvGFasHpSy3SV"];
  const scripts: Lib[] = [
    ["marked@15.0.12/marked.min.js", "vendor/marked.min.js", "sha384-948ahk4ZmxYVYOc+rxN1H2gM1EJ2Duhp7uHtZ4WSLkV4Vtx5MUqnV+l7u9B+jFv+"],
    ["katex@0.16.9/dist/katex.min.js", "vendor/katex/katex.min.js", "sha384-XjKyOOlGwcjNTAIQHIpgOno0Hl1YQqzUOEleOLALmuqehneUG+vnGctmUb0ZY0l8"],
    ["katex@0.16.9/dist/contrib/mhchem.min.js", "vendor/katex/mhchem.min.js", "sha384-ifpG+NlgMq0kvOSGqGQxW1mJKpjjMDmZdpKGq3tbvD3WPhyshCEEYClriK/wRVU0"],
    ["vega@5.33.1/build/vega.min.js", "vendor/vega.min.js", "sha384-NMXhl2TbCXxcN7o4ROC56Funm78m4AylL8gMg/7Kn4YU+wrm23K9l7cY8lDRXQ9d"],
    ["vega-lite@5.23.0/build/vega-lite.min.js", "vendor/vega-lite.min.js", "sha384-D9LYH0esGjcxQJsBuxOuXtCDJGXRWW1+KhluzWPqi0rLJmiR/ygPChefaD+rFFDQ"],
    ["vega-embed@6.29.0/build/vega-embed.min.js", "vendor/vega-embed.min.js", "sha384-M+Ax7e/WFJpxSOF09HzI+Sj4wg9ottVd/uxmV2ItGGh02fLH28t2FAOJx3TJBap5"],
    ["3dmol@2.5.5/build/3Dmol-min.js", "vendor/3Dmol-min.js", "sha384-OsczYbldvrHgslr9fFp/i4GiLSeuw9l+QIlv99ITw8soOwXcoGeflFMLg+CU/X1d"],
  ];
  const source = ([cdnPath, vendored]: Lib) => (cdn ? `https://cdn.jsdelivr.net/npm/${cdnPath}` : String(media(vendored)));
  const integrity = (lib: Lib) => (cdn ? ` integrity="${lib[2]}" crossorigin="anonymous"` : "");
  const libs = scripts.map((lib) => `<script defer nonce="${n}" src="${source(lib)}"${integrity(lib)}></script>`).join("\n");
  const strings = JSON.stringify(browserPhrases(locale)).replace(/</g, "\\u003c");
  // C8: the design tokens, their components, then the bridge to the editor theme; the pane's own sheet last, so
  // it also repaints the shared contextual help. `st-scope` keeps the host's vscode-* body classes.
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${media("studium-tokens.css")}">
<link rel="stylesheet" href="${media("studium-components.css")}">
<link rel="stylesheet" href="${media("studium-vscode-bridge.css")}">
<link rel="stylesheet" href="${source(katexCss)}"${integrity(katexCss)}>
${libs}
<style>${helpStyles}</style>
<link rel="stylesheet" href="${media("artifact-pane.css")}">
</head><body class="st-scope" data-remote-images="${cdn ? "allowed" : "blocked"}">${lessonHelpTemplates()}<div id="pane"><div class="loading" role="status"><span class="loading-mark" aria-hidden="true"></span><div><strong>${phrase("pane_opening", {}, locale)}</strong><span>${phrase("extension_loading_lesson", {}, locale)}</span></div></div></div>
<div id="pane-live" class="visually-hidden" role="status" aria-live="polite" aria-atomic="true"></div>
<script type="application/json" id="studium-strings" nonce="${n}">${strings}</script>
<script defer nonce="${n}" src="${media("artifact-pane.js")}"></script>
</body></html>`;
}

// The companion GRAPH webview: Cytoscape + dagre (+ the cytoscape-dagre adapter). The elements and
// stylesheet are computed host-side from the GraphView; graph-pane.js only lays out + renders. It speaks the
// lesson language (VSC-3 lang, VSC-5 strings), paints with the design tokens (C8) and pins CDN files by SRI.
function graphHtml(webview: vscode.Webview, extPath: string, assets: "vendor" | "cdn", locale: Locale): string {
  const media = (f: string) => webview.asWebviewUri(vscode.Uri.file(join(extPath, "media", f)));
  const n = nonce();
  const cdn = assets === "cdn";
  const origin = cdn ? "https://cdn.jsdelivr.net" : "";
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${n}' ${origin}`,
  ].join("; ");
  // [jsdelivr path, vendored copy, sha384 of those exact bytes] (ENG-10: the CDN file must be the vendored one).
  type Lib = readonly [cdnPath: string, vendored: string, integrity: string];
  const scripts: Lib[] = [
    ["cytoscape@3.34.0/dist/cytoscape.min.js", "vendor/cytoscape.min.js", "sha384-K+k+ywfDuvV9dwg+bwsVE0WGkrTnqFamaER+ydBgMFQTtlI0jdI9no9AjkQHwh/T"],
    ["dagre@0.8.5/dist/dagre.min.js", "vendor/dagre.min.js", "sha384-2IH3T69EIKYC4c+RXZifZRvaH5SRUdacJW7j6HtE5rQbvLhKKdawxq6vpIzJ7j9M"],
    ["cytoscape-dagre@4.0.0/dist/cytoscape-dagre.js", "vendor/cytoscape-dagre.js", "sha384-NF9TNU/y06b6xPvq8ROT3WRFrfmNyut2Z/UZ/TSHCB8I/nbFqO3ZpeGF1ERvj2Sd"],
  ];
  const libs = scripts.map(([cdnPath, vendored, integrity]) => cdn
    ? `<script defer nonce="${n}" src="https://cdn.jsdelivr.net/npm/${cdnPath}" integrity="${integrity}" crossorigin="anonymous"></script>`
    : `<script defer nonce="${n}" src="${media(vendored)}"></script>`).join("\n");
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${media("studium-tokens.css")}">
<link rel="stylesheet" href="${media("studium-components.css")}">
<link rel="stylesheet" href="${media("studium-vscode-bridge.css")}">
<link rel="stylesheet" href="${media("graph-pane.css")}">
${libs}
<style>${helpStyles}</style>
</head><body class="st-scope">${graphHelp()}<div id="graph"></div><div id="legend"></div>
<script nonce="${n}" src="${media("graph-pane.js")}"></script>
</body></html>`;
}
