// extension.ts — Studium in VS Code.
//
// The extension host is an MCP client to the lesson-mcp server (the same server VS Code Copilot
// would connect to). A WebviewPanel renders the ARTIFACT PANE (media/artifact-pane.*). The two
// move in lockstep, pair by pair: every time the learner advances, the extension pulls the next
// scene + get_scene_artifacts and posts them to the pane; the pane posts the learner's responses
// back, which the extension feeds to submit_response / request_hint.
import * as vscode from "vscode";
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { spawn } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  connectLessonMcp, describeServerLaunch, resolveLogSink, resolveServerLaunch,
  serverBuildWarning, serverInfoLine, setLessonMcpLog,
} from "./mcp-connect.js";
import { registerStudiumChat } from "./chat.js";
import { toCytoscape, buildStylesheet, egoFilter, type GraphView } from "@studium/typed-graph-lens";
import { registerStudiumNotebook } from "./notebook.js";
import { reviewDueConcepts } from "./review-fsrs.js";
import { selectRenderOrder, type ModalityPreference } from "./modality.js";
import { discoverCommunityBundles, toPickItems } from "./community.js";
import { calibrationVerdicts, type CalibrationVerdict } from "./calibration.js";
import { runManifestToTaskSpec, buildRunResult, extractLandmark, type RunManifest, type RunResult } from "./run-task.js";
import { StudiumTreeProvider } from "./tree.js";
import { buildLessonTree, type CommunityItem, type TreeNode } from "./lesson-tree.js";
import { discoverCoursesInRoot, needsLessonPicker, toLessonPickerChoices, type LessonCourse, type LessonPickerChoice } from "./lesson-picker.js";
import { browserPhrases, phrase, type Locale } from "./phrases.js";

type Json = Record<string, any>;

/** The currently-open lesson, exposed to the top-level "Run reproduction" command so it can drive the
 * run protocol (get_run_manifest → native task → submit_run_result) against the live session. Replaced
 * each openLesson; cleared on panel dispose. */
let activeLesson: {
  call: (name: string, args: Json) => Promise<Json>;
  sid: () => string;
  locale: () => Locale;
  isDisposed: () => boolean;
  advance: (presentation: Json, explanation?: Json) => Promise<void>;
  done: (message: string) => void;
} | null = null;

/** The activity-bar sidebar; module-level so pushScene can toggle its "reproduction scene is live" state. */
let treeProvider: StudiumCoursesTreeProvider | undefined;
let extensionLocale: Locale = "fr";

interface TreeContents {
  courses: LessonCourse[];
  currentRef: string;
  community: CommunityItem[];
}

/** Add course-aware root shaping and descriptions without changing the shared thin tree provider. */
class StudiumCoursesTreeProvider extends StudiumTreeProvider {
  private onReproductionScene = false;
  private locale: Locale = extensionLocale;

  constructor(private readonly discoverContents: () => TreeContents) {
    super(() => discoverContents().community);
  }

  override setReproductionScene(on: boolean): void {
    this.onReproductionScene = on;
    super.setReproductionScene(on);
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
    return buildLessonTree({ ...contents, onReproductionScene: this.onReproductionScene, locale: this.locale });
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
    vscode.commands.registerCommand("studium.refreshLessons", () => treeProvider?.refresh()),
  );
  registerStudiumNotebook(context);
  registerStudiumChat(context);
}
export function deactivate() {}

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

  const spec = runManifestToTaskSpec(manifest);
  // A CustomExecution backed by a Pseudoterminal so we CAPTURE the run's stdout (a plain ShellExecution
  // hands us only the exit code). The learner's OWN landmark is parsed from that stdout — without it the
  // run has landmark=null and attestation quarantines it, so the judgment falls back to a canned number
  // instead of grounding on the value the learner actually produced. Studium's BRAIN still never executes:
  // the extension is the operator's harness (VS Code = the operator's environment), and lesson-mcp only
  // ever receives the finished run_result. Capture is in-process (child_process) → cross-platform, no
  // workspace-polluting `tee`.
  const { pty, done } = spawnCapturingPty(spec.command, join(wsFolder, spec.cwd), manifest.timeout_s);
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
      if (r.transition.kind === "complete") lesson.done(phrase("extension_lesson_complete", {
        count: r.transition.summary?.scenesCompleted ?? "?",
      }, locale));
      else await lesson.advance(r.transition.presentation);
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
  return cfg<string>("bundlesRoot", join(repoRoot, "fixtures"));
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
    vscode.window.showErrorMessage(`Studium: could not scan community contributions — ${e.message}`);
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
  while (true) {
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

async function openLesson(
  context: vscode.ExtensionContext,
  bundleRefOverride?: string,
  rootKind: LessonRootKind = "lesson",
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
  const bundlesRoot = rootKind === "community" ? resolveCommunityBundlesRoot(context) : lessonBundlesRoot;
  const bundleRef = bundleRefOverride ?? configuredRef!;
  const learnerId = cfg<string>("learnerId", "vscode-learner");
  const consent = cfg<boolean>("telemetryConsent", false);

  const assets = cfg<"vendor" | "cdn">("assets", "vendor");
  const panel = vscode.window.createWebviewPanel(
    "studiumLesson", phrase("extension_lesson_panel", {}, extensionLocale), vscode.ViewColumn.Beside,
    { enableScripts: true, localResourceRoots: [vscode.Uri.file(join(context.extensionPath, "media"))], retainContextWhenHidden: true },
  );
  panel.webview.html = paneHtml(panel.webview, context.extensionPath, assets, extensionLocale);

  // 1) connect to lesson-mcp over stdio
  const env: Record<string, string> = { ...process.env as any, BUNDLES_ROOT: bundlesRoot };
  if (consent) { env["STUDIUM_DATA_DIR"] = join(bundlesRoot, "data"); env["STUDIUM_TELEMETRY_CONSENT"] = "granted"; }
  const mcpLog = resolveLogSink();
  mcpLog(`[studium] lesson-mcp launch: ${describeServerLaunch(serverLaunch)}`);
  const mcp = await connectLessonMcp({ launch: serverLaunch, env });
  const call = mcp.call;
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
  // Track disposal so async callbacks (which may resume after the user closes the panel) never
  // postMessage to a dead webview.
  let panelDisposed = false;
  panel.onDidDispose(() => { panelDisposed = true; mcp.close(); });

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
    gp.webview.html = graphHtml(gp.webview, context.extensionPath, assets);
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
        type: "graph", elements: toCytoscape(view), style: buildStylesheet(),
        title: g.title ?? "", legend: g.legend ?? [], focus: g.focus ?? null, mode: graphMode,
      });
    } catch { /* the graph is best-effort; never let it break the lesson */ }
  };

  // Resolve a figure path on disk into a webview-safe data URI so <img> renders under the CSP.
  // (Text artifacts — orbital .cube, spectrum, molecule — are inlined server-side by get_scene_artifacts.)
  const inlineImage = (a: Json) => {
    if (!a.path || a.kind !== "image" && a.kind !== "executed_result") return a;
    try {
      const b64 = readFileSync(a.path).toString("base64");
      const ext = (a.path.split(".").pop() || "png").toLowerCase();
      return { ...a, dataUri: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${b64}` };
    } catch { return a; }
  };

  const pushScene = async (presentation: Json, explanation?: Json, verdict?: Json) => {
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
    let reviewDue: string[] = [];
    let calibration: CalibrationVerdict[] = [];
    try {
      const st = (await call("get_session_state", { session_id: sid })).state;
      reviewDue = reviewDueConcepts(st);
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
      scene_assets: selectRenderOrder(artifacts.map(inlineImage), modalityPref),
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

  // Expose this lesson to the top-level "Run reproduction" command (it drives get_run_manifest →
  // native task → submit_run_result against this live session). Latest open wins; cleared on dispose.
  // The dispose-clear guards by OBJECT IDENTITY (not sid value) so it can't null a different live
  // lesson during the brief window where two sessions share the empty sentinel sid (pre-start).
  const thisLesson = {
    call,
    sid: () => sid,
    locale: () => locale,
    isDisposed: () => panelDisposed,
    advance: (presentation: Json, explanation?: Json) => pushScene(presentation, explanation),
    done: (message: string) => { if (!panelDisposed) panel.webview.postMessage({ type: "done", message }); },
  };
  activeLesson = thisLesson;
  panel.onDidDispose(() => {
    if (activeLesson === thisLesson) activeLesson = null;
    setReproductionContext(false); // the run action is scene-scoped; clear it when the lesson closes
  });

  // 2) learner actions from the pane → MCP calls → next render (pair by pair)
  panel.webview.onDidReceiveMessage(async (msg: Json) => {
    try {
      if (msg.type === "hint") {
        const h = (await call("request_hint", { session_id: sid })).hint;
        if (!panelDisposed) panel.webview.postMessage({ type: "hint", hint: h?.hint ?? null, remaining: h?.remaining });
        return;
      }
      if (msg.type === "end") {
        // Right to be forgotten: end_session emits forget_requested and PURGES the durable per-learner
        // state on disk (in consented/durable mode). Irreversible, so confirm first; closing the panel
        // alone only drops the transport and leaves the saved state intact (so a learner can resume).
        const ok = await vscode.window.showWarningMessage(
          phrase("extension_forget_prompt", {}, locale),
          { modal: true }, phrase("extension_forget_action", {}, locale),
        );
        if (ok === phrase("extension_forget_action", {}, locale)) {
          try { await call("end_session", { session_id: sid }); } catch { /* already gone */ }
          panel.dispose();
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
      if (msg.type === "respond") {
        const t = (await call("submit_response", { session_id: sid, input: msg.input })).transition;
        if (panelDisposed) return;
        if (t.kind === "complete") {
          panel.webview.postMessage({ type: "done", message: phrase("extension_done", {
            count: t.summary.scenesCompleted,
            autonomy: t.summary.autonomyRatio.toFixed(2),
          }, locale) });
          return;
        }
        await pushScene(t.presentation, t.kind === "replay" || t.kind === "remediate_alt" || t.kind === "remediate"
          ? { rule_id: t.navigation?.rule_id ?? t.kind, explanation_short: t.reason } : undefined, t.verdict);
      }
    } catch (e: any) { vscode.window.showErrorMessage(`Studium: ${e.message}`); }
  });

  // 3) start
  try {
    const started = await call("start_lesson_session", { bundle_ref: bundleRef, learner_id: learnerId });
    sid = started.session_id;
    await pushScene(started.presentation);
    vscode.window.showInformationMessage(phrase("extension_started", { bundle: bundleRef }, locale));
  } catch (e: any) {
    // Replace the loading placeholder with an in-pane error so the panel is never stuck on "Chargement…".
    if (!panelDisposed) panel.webview.postMessage({
      type: "error",
      message: phrase("extension_start_failed", { error: e.message }, locale),
    });
    vscode.window.showErrorMessage(phrase("extension_start_failed_notification", { error: e.message }, locale));
  }
}

function nonce() { return Array.from({ length: 16 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join(""); }

function paneHtml(webview: vscode.Webview, extPath: string, assets: "vendor" | "cdn", locale: Locale): string {
  const media = (f: string) => webview.asWebviewUri(vscode.Uri.file(join(extPath, "media", f)));
  const n = nonce();
  // KaTeX + Vega(-Lite/-Embed) make equations + plots rich; if neither loads, the renderer
  // degrades to styled code + an inline-SVG bar chart (same code path). `vendor` ships the libs
  // inside media/vendor (air-gap safe); `cdn` pulls them from jsdelivr.
  const cdn = assets === "cdn";
  const origin = cdn ? "https://cdn.jsdelivr.net" : "";
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} ${origin} 'unsafe-inline'`,
    `font-src ${webview.cspSource} ${origin}`,
    `script-src 'nonce-${n}' ${origin}`,
  ].join("; ");
  const katexCss = cdn ? "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" : media("vendor/katex/katex.min.css");
  const libs = (cdn
    ? ["https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js",
       "https://cdn.jsdelivr.net/npm/vega@5", "https://cdn.jsdelivr.net/npm/vega-lite@5", "https://cdn.jsdelivr.net/npm/vega-embed@6",
       "https://cdn.jsdelivr.net/npm/3dmol@2.5.5/build/3Dmol-min.js"]
    : [media("vendor/katex/katex.min.js"), media("vendor/vega.min.js"), media("vendor/vega-lite.min.js"), media("vendor/vega-embed.min.js"),
       media("vendor/3Dmol-min.js")]
  ).map((src) => `<script defer nonce="${n}" src="${src}"></script>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${media("artifact-pane.css")}">
<link rel="stylesheet" href="${katexCss}">
${libs}
</head><body><div id="pane"><div class="loading">⏳ ${phrase("extension_loading_lesson", {}, locale)}</div></div>
<script nonce="${n}" src="${media("artifact-pane.js")}"></script>
</body></html>`;
}

// The companion GRAPH webview: Cytoscape + dagre (+ the cytoscape-dagre adapter). The elements and
// stylesheet are computed host-side from the GraphView; graph-pane.js only lays out + renders.
function graphHtml(webview: vscode.Webview, extPath: string, assets: "vendor" | "cdn"): string {
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
  const libs = (cdn
    ? ["https://cdn.jsdelivr.net/npm/cytoscape@3.34.0/dist/cytoscape.min.js",
       "https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js",
       "https://cdn.jsdelivr.net/npm/cytoscape-dagre@4.0.0/dist/cytoscape-dagre.js"]
    : [media("vendor/cytoscape.min.js"), media("vendor/dagre.min.js"), media("vendor/cytoscape-dagre.js")]
  ).map((src) => `<script defer nonce="${n}" src="${src}"></script>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${media("graph-pane.css")}">
${libs}
</head><body><div id="graph"></div><div id="legend"></div>
<script nonce="${n}" src="${media("graph-pane.js")}"></script>
</body></html>`;
}
