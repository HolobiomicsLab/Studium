import { helpStyles, lessonHelpTemplates, graphHelp } from "./contextual-help.js";
// extension.ts — Studium in VS Code.
//
// The extension host is an MCP client to the lesson-mcp server (the same server VS Code Copilot
// would connect to). A WebviewPanel renders the ARTIFACT PANE (media/artifact-pane.*). The two
// move in lockstep, pair by pair: every time the learner advances, the extension pulls the next
// scene + get_scene_artifacts and posts them to the pane; the pane posts the learner's responses
// back, which the extension feeds to submit_response / request_hint.
import * as vscode from "vscode";
import { existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { connectLessonMcp, resolveServerLaunch, setLessonMcpLog, type LessonMcp } from "./mcp-connect.js";
import { LessonPanelLifecycle, type ActionResult } from "./panel-lifecycle.js";
import { registerStudiumChat } from "./chat.js";
import { toCytoscape, buildStylesheet, egoFilter, type GraphView } from "@studium/typed-graph-lens";
import { registerStudiumNotebook } from "./notebook.js";
import { reviewDueConcepts } from "./review-fsrs.js";
import { selectRenderOrder, type ModalityPreference } from "./modality.js";
import { discoverCommunityBundles, toPickItems } from "./community.js";
import { calibrationVerdicts, type CalibrationVerdict } from "./calibration.js";
import { runManifestToTaskSpec, buildRunResult, extractLandmark, type RunManifest, type RunResult } from "./run-task.js";
import { StudiumTreeProvider } from "./tree.js";
import type { CommunityItem } from "./lesson-tree.js";
import { inlineImageAsset } from "./asset-path.js";

type Json = Record<string, any>;

/** The currently-open lesson, exposed to the top-level "Run reproduction" command so it can drive the
 * run protocol (get_run_manifest → native task → submit_run_result) against the live session. Replaced
 * each openLesson; cleared on panel dispose. */
let activeLesson: {
  call: (name: string, args: Json) => Promise<Json>;
  sid: () => string;
  isDisposed: () => boolean;
  advance: (presentation: Json, explanation?: Json) => Promise<void>;
  done: (message: string) => void;
  runExclusive: <TResult>(action: () => Promise<TResult>) => Promise<ActionResult<TResult>>;
  pending: (message: string) => void;
  settled: () => void;
} | null = null;

/** The activity-bar sidebar; module-level so pushScene can toggle its "reproduction scene is live" state. */
let treeProvider: StudiumTreeProvider | undefined;

/** Output channel every lesson-mcp subprocess writes its stderr to (View > Output > this name). */
const MCP_OUTPUT_CHANNEL = "Studium — lesson-mcp";

export function activate(context: vscode.ExtensionContext) {
  // Every lesson-mcp subprocess pipes its stderr here (lesson panel AND @studium chat), so a server
  // that dies at startup leaves a readable diagnostic instead of vanishing.
  const mcpOutput = vscode.window.createOutputChannel(MCP_OUTPUT_CHANNEL);
  context.subscriptions.push(mcpOutput);
  setLessonMcpLog((line) => mcpOutput.appendLine(line));
  treeProvider = new StudiumTreeProvider(() => discoverForTree(context));
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("studiumLessons", treeProvider),
    // The tree's community leaves open a specific bundle by ref; the palette entry opens the default.
    vscode.commands.registerCommand("studium.openLesson", (ref?: unknown) =>
      openLesson(context, typeof ref === "string" ? ref : undefined)),
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

/** The community bundles the sidebar lists, discovered the same way the quick-pick command does. */
function discoverForTree(context: vscode.ExtensionContext): CommunityItem[] {
  const root = resolveBundlesRoot(context);
  const canonicalRef = cfg<string>("bundleRef", "atomistique-l1/lesson.json");
  return toPickItems(discoverCommunityBundles(root, canonicalRef)).map((p) => ({ ref: p.ref, label: p.label }));
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
    const isParked = parkRunResult(wsFolder, result);
    const rescue = isParked
      ? ` Résultat conservé dans ${SESSION_DIR}/${RUN_RESULT_FILE} — il sera repris sans relancer la capsule.`
      : " Le résultat n'a PAS pu être sauvegardé (espace de travail non inscriptible).";
    vscode.window.showErrorMessage(`Studium : envoi du run échoué — ${e.message}.${rescue}`);
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
    vscode.window.showInformationMessage("Studium : ouvre d'abord une leçon, puis lance sa scène de reproduction.");
    return;
  }
  const lesson = activeLesson;
  const result = await lesson.runExclusive(async () => {
    lesson.pending("Exécution de la reproduction dans le terminal…");
    try { await runReproductionForLesson(lesson); }
    finally { lesson.settled(); }
  });
  if (result.status === "busy") {
    vscode.window.showInformationMessage("Studium : une action est déjà en cours pour cette leçon.");
  }
}

/** Execute one reproduction after the caller has acquired the lesson panel's exclusive gate. */
async function runReproductionForLesson(lesson: NonNullable<typeof activeLesson>) {
  let manifest: RunManifest | null;
  try {
    manifest = ((await lesson.call("get_run_manifest", { session_id: lesson.sid() })).run_manifest as RunManifest | null) ?? null;
  } catch (e: any) { vscode.window.showErrorMessage(`Studium: ${e.message}`); return; }
  if (!manifest) {
    vscode.window.showInformationMessage("Studium : la scène courante n'a pas de capsule à exécuter.");
    return;
  }
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsFolder) { vscode.window.showErrorMessage("Studium : ouvre un dossier de travail pour exécuter la capsule."); return; }

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
  catch (e: any) { vscode.window.showErrorMessage(`Studium : impossible de lancer la tâche — ${e.message}`); return; }

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
        vscode.window.showInformationMessage("Studium : run attesté ✓ — le prochain jugement est fondé sur TON résultat.");
      } else {
        const why = Array.isArray(r.attestation_reasons) && r.attestation_reasons.length
          ? " Raisons : " + r.attestation_reasons.join(" · ") : "";
        vscode.window.showWarningMessage(
          `Studium : run en quarantaine ⚠ — il fait avancer la leçon mais ne fonde PAS le jugement (le jugement utilisera le run de référence).${why}`,
        );
      }
      if (r.transition.kind === "complete") lesson.done(`Leçon terminée — ${r.transition.summary?.scenesCompleted ?? "?"} scènes.`);
      else await lesson.advance(r.transition.presentation);
    } else {
      vscode.window.showWarningMessage(`Studium : run non accepté (${r.status}) — corrige l'exécution puis relance.`);
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
          writeEmitter.fire(crlf(`[studium] délai dépassé (${timeoutS}s) — arrêt de la capsule.\n`));
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

/** Resolve the runtime BUNDLES_ROOT exactly as openLesson does, so discovery and lesson-open agree
 * on the same root. The community-bundles root override (studium.communityBundlesRoot) lets a
 * deployment point discovery at the COURSE bundles root the scene-synth emit path writes into, when
 * that differs from the lesson BUNDLES_ROOT. */
function resolveBundlesRoot(context: vscode.ExtensionContext): string {
  const repoRoot = cfg<string>("repoRoot", resolve(context.extensionPath, "..", ".."));
  const lessonBundlesRoot = cfg<string>("bundlesRoot", join(repoRoot, "fixtures"));
  return cfg<string>("communityBundlesRoot", lessonBundlesRoot);
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
  const bundlesRoot = resolveBundlesRoot(context);
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
      "Studium: aucune contribution de la classe pour ce cours pour l'instant (no community contributions yet).",
    );
    return;
  }
  const picks = toPickItems(bundles);
  const chosen = await vscode.window.showQuickPick(picks, {
    title: "Contributions de la classe / Community contributions",
    placeHolder: "Choisis une contribution d'un·e camarade à étudier (approuvée par l'enseignant·e)",
    matchOnDescription: true,
  });
  if (!chosen) return; // dismissed
  // Open the chosen community bundle EXACTLY like the canonical one — reuse openLesson with the
  // community ref as the bundleRef override. resolveBundle / start_lesson_session load it unchanged.
  await openLesson(context, chosen.ref);
}

async function openLesson(context: vscode.ExtensionContext, bundleRefOverride?: string) {
  // The extension ships inside the monorepo (apps/studium-vscode); default repoRoot = ../../ .
  const repoRoot = cfg<string>("repoRoot", resolve(context.extensionPath, "..", ".."));
  let serverLaunch;
  try {
    serverLaunch = resolveServerLaunch(context.extensionPath, repoRoot);
  } catch (e: any) {
    const open = "Ouvrir les réglages";
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
  // (resolveBundlesRoot — honours studium.communityBundlesRoot) so the community ref resolves; a
  // canonical open keeps the plain lesson bundlesRoot.
  const bundlesRoot = bundleRefOverride
    ? resolveBundlesRoot(context)
    : cfg<string>("bundlesRoot", join(repoRoot, "fixtures"));
  const bundleRef = bundleRefOverride ?? cfg<string>("bundleRef", "atomistique-l1/lesson.json");
  const learnerId = cfg<string>("learnerId", "vscode-learner");
  const consent = cfg<boolean>("telemetryConsent", false);

  const assets = cfg<"vendor" | "cdn">("assets", "vendor");
  const panel = vscode.window.createWebviewPanel(
    "studiumLesson", "Studium — Lesson", vscode.ViewColumn.Beside,
    { enableScripts: true, localResourceRoots: [vscode.Uri.file(join(context.extensionPath, "media"))], retainContextWhenHidden: true },
  );
  panel.webview.html = paneHtml(panel.webview, context.extensionPath, assets);

  // Register disposal BEFORE the asynchronous connection starts. If the learner closes the pane
  // while the subprocess is still opening, the lifecycle closes the late connection on arrival.
  const lifecycle = new LessonPanelLifecycle<LessonMcp>();
  let panelDisposed = false;
  panel.onDidDispose(() => { panelDisposed = true; lifecycle.dispose(); });

  // 1) connect to lesson-mcp over stdio
  const env: Record<string, string> = { ...process.env as any, BUNDLES_ROOT: bundlesRoot };
  if (consent) { env["STUDIUM_DATA_DIR"] = join(bundlesRoot, "data"); env["STUDIUM_TELEMETRY_CONSENT"] = "granted"; }
  let mcp: LessonMcp | null;
  try {
    mcp = await lifecycle.connect(() => connectLessonMcp({ launch: serverLaunch, env }));
  } catch (e: any) {
    if (panelDisposed) return;
    panel.webview.postMessage({
      type: "error",
      message: `Impossible de joindre le service local : ${e.message}`,
    });
    vscode.window.showErrorMessage(`Studium: could not connect to lesson-mcp — ${e.message}`);
    return;
  }
  if (!mcp) return;
  const call = mcp.call;
  panel.webview.postMessage({ type: "loading", message: "Service prêt · ouverture de la leçon…" });

  let sid = "";

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
      "studiumGraph", "Studium — Graph", vscode.ViewColumn.Beside,
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

  const pushScene = async (presentation: Json, explanation?: Json) => {
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
      calibration = calibrationVerdicts(st);
    } catch { /* best-effort */ }
    if (panelDisposed) return;
    panel.webview.postMessage({
      type: "render",
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
    });
    await pushGraph();
    // When the current scene is a reproduction the LEARNER must run, light up the sidebar's run action +
    // the when-clause context, and nudge them. The run_manifest is non-answer-bearing (publicScene keeps it).
    const isReproScene = presentation.scene?.type === "reproduction" && !!presentation.scene?.run_manifest;
    setReproductionContext(isReproScene);
    if (isReproScene) {
      vscode.window.showInformationMessage(
        "Studium : cette scène demande d'exécuter une capsule. Lance « Studium: Run reproduction » pour la faire tourner dans ton terminal.",
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
    isDisposed: () => panelDisposed || lifecycle.isDisposed(),
    advance: (presentation: Json, explanation?: Json) => pushScene(presentation, explanation),
    done: (message: string) => { if (!panelDisposed) panel.webview.postMessage({ type: "done", message }); },
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
            "Effacer définitivement vos données de cette session (droit à l'oubli) ? Cette action est irréversible.",
            { modal: true }, "Effacer",
          );
          if (ok === "Effacer") {
            try { await call("end_session", { session_id: sid }); } catch { /* already gone */ }
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
        if (msg.type === "respond") {
          const t = (await call("submit_response", { session_id: sid, input: msg.input })).transition;
          if (panelDisposed) return;
          if (t.kind === "complete") {
            panel.webview.postMessage({ type: "done", message: `Lesson complete — ${t.summary.scenesCompleted} scenes, autonomy ${t.summary.autonomyRatio.toFixed(2)}` });
            return;
          }
          await pushScene(t.presentation, t.kind === "replay" || t.kind === "remediate_alt"
            ? { rule_id: t.kind, explanation_short: t.reason } : undefined);
        }
      });
      if (result.status === "busy") {
        // The accepted action will settle the pane. Ignore a duplicate host message so it cannot
        // mutate the same scene twice or unlock controls ahead of the accepted request.
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
    await pushScene(started.presentation);
    vscode.window.showInformationMessage(`Studium: lesson started (${bundleRef}).`);
  } catch (e: any) {
    // Replace the loading placeholder with an in-pane error so the panel is never stuck on "Chargement…".
    if (panelDisposed) return;
    lifecycle.dispose();
    if (activeLesson === thisLesson) activeLesson = null;
    setReproductionContext(false);
    panel.webview.postMessage({ type: "error", message: `Impossible de démarrer la leçon : ${e.message}` });
    vscode.window.showErrorMessage(`Studium: could not start lesson — ${e.message}`);
  }
}

function nonce() { return Array.from({ length: 16 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join(""); }

function paneHtml(webview: vscode.Webview, extPath: string, assets: "vendor" | "cdn"): string {
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
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${media("artifact-pane.css")}">
<link rel="stylesheet" href="${katexCss}">
${libs}
<style>${helpStyles}</style>
</head><body>${lessonHelpTemplates()}<div id="pane"><div class="loading" role="status"><span class="loading-mark" aria-hidden="true"></span><div><strong>Ouverture de Studium</strong><span>Démarrage du service local et vérification de la leçon…</span></div></div></div>
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
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${media("graph-pane.css")}">
${libs}
<style>${helpStyles}</style>
</head><body>${graphHelp()}<div id="graph"></div><div id="legend"></div>
<script nonce="${n}" src="${media("graph-pane.js")}"></script>
</body></html>`;
}
