// extension-host.driver.ts — the extension host, end to end, against a FAKE `vscode` module and the REAL
// lesson-mcp server (spawned over stdio, like the extension does). It covers what the pure drivers cannot:
//   ENG-02  a reproduction is confirmed (and a bad working_dir refused) BEFORE anything runs, and a trusted
//           bundle is not asked twice;
//   ENG-03  learner state is written to the extension's storage with telemetry consent OFF;
//   VSC-7   the URI handler and "Open this lesson" open a lesson, and a restored pane resumes it;
//   VSC-5   the interface language starts from vscode.env.language;
//   rateRecall messages from the pane are validated before they reach a tool; forget-my-data erases the lot.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/extension-host.driver.ts
import Module from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostPhrase } from "./host-phrases.js";
import { freeTextInput } from "./scene-io.js";
import { isolateFromHome } from "./driver-isolation.js";
import { makeZip } from "./zip-fixture.js";

// I-10: the lesson-mcp the extension spawns inherits this environment. Its durable state goes to the fake
// globalStorageUri below (STUDIUM_DATA_DIR, set by lessonServerEnv); everything else stays out of ~.
const isolation = isolateFromHome("extension-host");

type Json = Record<string, any>;
const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const here = fileURLToPath(new URL(".", import.meta.url));
const extensionPath = resolve(here, "..");
const repoRoot = resolve(extensionPath, "..", "..");
const scratch = mkdtempSync(join(tmpdir(), "studium-host-"));
const lib = join(scratch, "lib");
const workspace = join(scratch, "ws");
const storage = join(scratch, "storage");
const emptyRoot = join(scratch, "empty");
for (const d of [lib, join(workspace, "sub"), emptyRoot]) mkdirSync(d, { recursive: true });

/** Copy the run-demo lesson into the library with a chosen run manifest. */
function makeLesson(course: string, run: Json, bundleId?: string): string {
  const lesson = JSON.parse(readFileSync(join(repoRoot, "fixtures/capsule-run-demo/lesson.json"), "utf8"));
  if (bundleId) lesson.bundle_id = bundleId;
  for (const scene of lesson.scenes) if (scene.run_manifest) scene.run_manifest = { ...scene.run_manifest, ...run };
  mkdirSync(join(lib, course), { recursive: true });
  const path = join(lib, course, "lesson.json");
  writeFileSync(path, JSON.stringify(lesson));
  return path;
}
const SAFE_RUN = { cmd: ["node", "-e", "console.log('MARK=1')"], requirements: [], expected_outputs: [], verify_checks: [], working_dir: "sub" };
const safePath = makeLesson("safe", SAFE_RUN);
const escapePath = makeLesson("escape", { ...SAFE_RUN, working_dir: "../escape" });
const absolutePath = makeLesson("absolute", { ...SAFE_RUN, working_dir: "/etc" });
// Its own bundle_id, so no earlier block has completed it: the restore must RESUME it, not retake it.
const resumePath = makeLesson("resume", SAFE_RUN, "capsule-run-resume");

// ---------------------------------------------------------------- the fake vscode
const settings: Json = { learnerId: "e2e-learner", showGraph: false, repoRoot };
const seen = {
  errors: [] as string[], infos: [] as string[], warnings: [] as Array<{ message: string; options: Json; items: string[] }>,
  panels: [] as any[], tasksRun: [] as any[], commands: new Map<string, (...a: any[]) => any>(),
  uriHandler: undefined as any, executed: [] as string[], serializers: new Map<string, any>(), treeProviders: new Map<string, any>(), statusItems: [] as any[],
};
let warningAnswer: ((items: string[]) => string | undefined) = () => undefined;
const noop = () => ({ dispose() {} });
class FakeUri {
  scheme = "file";
  constructor(readonly fsPath: string) {}
  get path() { return this.fsPath; }
  toString() { return `file://${this.fsPath}`; }
  static file(p: string) { return new FakeUri(p); }
}
class FakeEmitter { event = () => noop(); fire() {} dispose() {} }
function fakePanel(viewType?: string) {
  const handlers: Array<() => void> = [];
  const panel: Json = {
    viewType, title: "", posted: [] as Json[], disposed: false, handler: undefined as undefined | ((m: Json) => Promise<void>),
    webview: {
      html: "", options: {}, cspSource: "csp",
      asWebviewUri: (u: FakeUri) => u.fsPath,
      postMessage: async (m: Json) => { panel.posted.push(m); return true; },
      onDidReceiveMessage: (h: (m: Json) => Promise<void>) => { panel.handler = h; return noop(); },
    },
    onDidDispose: (h: () => void) => { handlers.push(h); return noop(); },
    dispose: () => { if (panel.disposed) return; panel.disposed = true; handlers.forEach((h) => h()); },
    reveal() {},
  };
  return panel;
}
const globalStateData = new Map<string, unknown>();
const fakeVscode: Json = {
  __esModule: true,
  env: { language: "en" },
  Uri: FakeUri, EventEmitter: FakeEmitter,
  TreeItem: class { constructor(public label: string, public collapsibleState?: number) {} },
  ThemeIcon: class { constructor(public id: string) {} },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { Beside: -2 }, ConfigurationTarget: { Workspace: 2 }, TaskScope: { Workspace: 2 },
  Task: class { constructor(public definition: Json, public scope: unknown, public name: string, public source: string, public execution: any) {} },
  CustomExecution: class { constructor(public callback: () => Promise<any>) {} },
  NotebookCellKind: { Markup: 1, Code: 2 },
  NotebookCellOutputItem: { text: noop, json: noop, error: noop },
  NotebookCellOutput: class {}, NotebookCellData: class {}, NotebookData: class {},
  workspace: {
    workspaceFolders: [{ uri: new FakeUri(workspace) }],
    getConfiguration: () => ({
      get: (key: string) => settings[key],
      inspect: (key: string) => ({ globalValue: settings[key] }),
      update: async (key: string, value: unknown) => { settings[key] = value; },
    }),
    registerNotebookSerializer: noop, openNotebookDocument: async () => ({}), onDidCloseNotebookDocument: noop,
  },
  notebooks: { createNotebookController: () => ({ dispose() {}, supportedLanguages: [] }) },
  chat: { createChatParticipant: () => ({ dispose() {}, iconPath: undefined }) },
  tasks: {
    executeTask: async (task: any) => {
      const pty = await task.execution.callback();
      pty.open(undefined);
      seen.tasksRun.push(task);
    },
  },
  commands: {
    registerCommand: (id: string, fn: (...a: any[]) => any) => { seen.commands.set(id, fn); return noop(); },
    executeCommand: async (id: string) => { seen.executed.push(id); return undefined; },
  },
  window: {
    activeTextEditor: undefined,
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
    registerTreeDataProvider: (id: string, provider: unknown) => { seen.treeProviders.set(id, provider); return noop(); },
    registerUriHandler: (h: unknown) => { seen.uriHandler = h; return noop(); },
    registerWebviewPanelSerializer: (type: string, s: unknown) => { seen.serializers.set(type, s); return noop(); },
    createStatusBarItem: () => { const item = { text: "", tooltip: "", command: "", shown: false, show() { item.shown = true; }, hide() { item.shown = false; }, dispose() {} }; seen.statusItems.push(item); return item; },
    showInformationMessage: (m: string) => { seen.infos.push(m); return Promise.resolve(undefined); },
    showErrorMessage: (m: string) => { seen.errors.push(m); return Promise.resolve(undefined); },
    showWarningMessage: (message: string, options: Json, ...items: string[]) => {
      seen.warnings.push({ message, options, items });
      return Promise.resolve(warningAnswer(items));
    },
    showQuickPick: async () => undefined, showOpenDialog: async () => undefined,
    showNotebookDocument: async () => ({}),
    createWebviewPanel: (viewType: string) => { const p = fakePanel(viewType); seen.panels.push(p); return p; },
  },
};
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
  return request === "vscode" ? fakeVscode : originalLoad.call(this, request, ...rest);
};

// extension.ts imports .css as text (esbuild --loader:.css=text); do the same under tsx.
(Module as unknown as { _extensions: Record<string, (m: { exports: unknown }, filename: string) => void> })
  ._extensions[".css"] = (m, filename) => { m.exports = readFileSync(filename, "utf8"); };

const context: Json = {
  extensionPath, subscriptions: [], extension: { id: "holobiomicslab.studium-vscode" },
  globalStorageUri: new FakeUri(storage),
  globalState: {
    get: (k: string, d?: unknown) => (globalStateData.has(k) ? globalStateData.get(k) : d),
    update: async (k: string, v: unknown) => { if (v === undefined) globalStateData.delete(k); else globalStateData.set(k, v); },
  },
};
const uriFor = (lessonPath: string) => ({ path: "/open", toString: () => `vscode://holobiomicslab.studium-vscode/open?bundle=${encodeURIComponent(lessonPath)}` });
/** Every file under a folder (recursive); empty when the folder does not exist. */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastPanel = () => seen.panels[seen.panels.length - 1];
async function waitFor(cond: () => boolean, what: string, ms = 20000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) { expect(false, `timed out waiting for ${what}`); return false; } await sleep(50); }
  return true;
}

async function main() {
  const ext = await import("./extension.js");
  ext.activate(context as any);

  // VSC-5: interface language from the editor
  {
    await seen.commands.get("studium.openThisLesson")!(undefined);
    expect(seen.infos.at(-1) === hostPhrase("open_this_no_file", {}, "en"), "an English editor gets English host messages (vscode.env.language = en)");
  }

  // VSC-7: registrations
  expect(seen.commands.has("studium.openThisLesson") && seen.commands.has("studium.forgetMyData"), "the new commands are registered");
  expect(!!seen.uriHandler && typeof seen.uriHandler.handleUri === "function", "a URI handler is registered");
  expect(seen.serializers.has("studiumLesson"), "the lesson pane has a WebviewPanelSerializer");
  expect(seen.statusItems.length === 1 && seen.statusItems[0].command === "workbench.view.extension.studium", "a status-bar item opens the Studium view");

  // VSC-7: bad links are refused with a readable message, and never open a pane
  {
    await seen.uriHandler.handleUri({ path: "/open", toString: () => "vscode://holobiomicslab.studium-vscode/open" });
    expect(seen.errors.at(-1) === hostPhrase("uri_missing_bundle", {}, "en"), "a link without a bundle says so");
    await seen.uriHandler.handleUri(uriFor(join(lib, "nope", "lesson.json")));
    expect(seen.errors.at(-1)?.includes("not found") === true, "a link to a missing file says so");
    await seen.uriHandler.handleUri({ path: "/other", toString: () => "vscode://x/other" });
    expect(seen.panels.length === 0, "none of those opened a pane");
  }

  // VSC-6: an empty lessons root leaves the tree empty, so the welcome view shows
  {
    settings["bundlesRoot"] = emptyRoot;
    const tree = seen.treeProviders.get("studiumLessons");
    expect(tree.getChildren().length === 0, "no courses anywhere → the tree is empty (the welcome content takes over)");
    settings["bundlesRoot"] = lib;
    expect(tree.getChildren().length > 0, "a root with courses shows the tree");
  }

  // VSC-7 + ENG-03: open from a link; state lands in the extension storage with consent OFF
  {
    await seen.uriHandler.handleUri(uriFor(safePath));
    const pane = lastPanel();
    expect(!!pane && pane.viewType === "studiumLesson", "the link opens a lesson pane");
    expect(pane.posted.some((m: Json) => m.type === "render"), "the pane received the first scene");
    expect(pane.webview.html.includes('lang="en"'), "the pane document is in the editor's language");
    expect((globalStateData.get("studium.lastLesson") as Json)?.bundleRef === "safe/lesson.json", "the opened lesson is remembered for restoration");
    await pane.handler({ type: "respond", input: { kind: "ack" } });
    await waitFor(() => pane.posted.filter((m: Json) => m.type === "render").length >= 2, "the reproduction scene");
    // W4 needs_lead 1: the render after an answer carries the engine's navigation record and the C4 slot; the
    // host no longer folds navigation into a legacy explanation with a rule id.
    const second = pane.posted.filter((m: Json) => m.type === "render")[1];
    expect(typeof second?.navigation?.kind === "string", `the render after an answer carries its navigation record (got ${JSON.stringify(second?.navigation)})`);
    expect(!second?.explanation?.rule_id, "no rule id is passed to the pane as an explanation");
    expect(second && "self_rating" in second, "the render carries the self-rating slot (null when none is requested)");
    const stored = existsSync(storage) ? readdirSync(storage) : [];
    expect(stored.length > 0, `learner state is written under the extension storage without telemetry consent (found ${JSON.stringify(stored)})`);
    expect(!existsSync(join(lib, "data")), "and nothing is written into the bundles folder");

    // rateRecall: an invalid message never reaches a tool. A well-formed rating of a scene for which no rating was
    // requested (the intro is ungraded) is refused by rate_recall, and the pane gets the error. Changed: this used to
    // accept recall_rated OR action_error because rate_recall did not exist yet (W5); the successful path is now
    // required in the self-rating block below, on a production answer that asks for one.
    const before = pane.posted.length;
    await pane.handler({ type: "rateRecall", sceneId: "s-intro", grade: "perfect" });
    expect(pane.posted.length === before, "an invalid grade is dropped without a reply");
    await pane.handler({ type: "rateRecall", sceneId: "s-intro", grade: "good" });
    const reply = pane.posted.at(-1);
    expect(reply?.type === "action_error", `a rating nobody asked for is refused and the error shown (got ${reply?.type})`);

    // ENG-02: first run asks; cancel starts nothing
    const warningsBefore = seen.warnings.length;
    warningAnswer = () => undefined;
    await seen.commands.get("studium.runReproduction")!();
    expect(seen.warnings.length === warningsBefore + 1, "a reproduction asks for confirmation first");
    const modal = seen.warnings.at(-1)!;
    expect(modal.options["modal"] === true, "the confirmation is a modal");
    expect(modal.options["detail"].includes("MARK=1") && modal.options["detail"].includes(join(workspace, "sub")), "it shows the exact command and the run folder");
    expect(modal.items.length === 2, "it offers Run and Run-and-trust (cancel is implicit)");
    expect(seen.tasksRun.length === 0, "cancelling started nothing");
    // The fixture lesson is French: once a lesson is on screen its language wins over the editor's.
    expect(seen.infos.at(-1) === hostPhrase("run_declined", {}, "fr"), "and says so, in the lesson's language");

    // trust once
    warningAnswer = (items) => items[1];
    await seen.commands.get("studium.runReproduction")!();
    expect(seen.tasksRun.length === 1, "confirming runs the capsule");
    expect(((globalStateData.get("studium.trustedRuns") as string[]) ?? []).length === 1, "'trust' stores one fingerprint");
    // VSC-6: the run completes the lesson; the pane receives the completion screen's data, concepts by title.
    await waitFor(() => pane.posted.some((m: Json) => m.type === "done"), "the end of the lesson after the run");
    const done = pane.posted.find((m: Json) => m.type === "done");
    const completion = done?.completion;
    expect(Array.isArray(completion?.actions) && completion.actions.includes("restart") && completion.actions.includes("pick"),
      `the completion declares its actions (got ${JSON.stringify(completion?.actions)})`);
    const listed = [...(completion?.consolidated ?? []), ...(completion?.to_revisit ?? [])];
    expect(listed.every((c: Json) => c?.id === "c-kinetics" && c?.label === "Cinetique du premier ordre"),
      `any completion concept carries the bundle's title, not only the id (got ${JSON.stringify(listed)})`);
    pane.dispose();
  }

  // ENG-02: the same, unchanged bundle is not asked twice
  {
    await seen.uriHandler.handleUri(uriFor(safePath));
    const pane = lastPanel();
    await pane.handler({ type: "respond", input: { kind: "ack" } });
    await waitFor(() => pane.posted.filter((m: Json) => m.type === "render").length >= 2, "the reproduction scene (second open)");
    const warningsBefore = seen.warnings.length;
    await seen.commands.get("studium.runReproduction")!();
    expect(seen.warnings.length === warningsBefore && seen.tasksRun.length === 2, "a trusted bundle runs without a second prompt");
    pane.dispose();
  }

  // VSC-8: the pane's « Lancer la reproduction » button ({type:'run'}) runs the same flow inside the pane's gate
  {
    await seen.uriHandler.handleUri(uriFor(safePath));
    const pane = lastPanel();
    await pane.handler({ type: "respond", input: { kind: "ack" } });
    await waitFor(() => pane.posted.filter((m: Json) => m.type === "render").length >= 2, "the reproduction scene (pane button)");
    const tasksBefore = seen.tasksRun.length;
    const postedBefore = pane.posted.length;
    await pane.handler({ type: "run" });
    const after = pane.posted.slice(postedBefore).map((m: Json) => m.type);
    expect(seen.tasksRun.length === tasksBefore + 1, "the pane's run button runs the capsule");
    expect(after[0] === "action_pending" && after.includes("action_settled"), `the pane is told the run is pending, then settled (got ${after.join(",")})`);
    expect(after.includes("done"), "and the completed run ends the lesson in the pane");
    pane.dispose();
  }

  // ENG-02: a working_dir outside the workspace is refused before any prompt or task
  for (const [path, key] of [[escapePath, "run_refused_parent"], [absolutePath, "run_refused_absolute"]] as const) {
    await seen.uriHandler.handleUri(uriFor(path));
    const pane = lastPanel();
    await pane.handler({ type: "respond", input: { kind: "ack" } });
    await waitFor(() => pane.posted.filter((m: Json) => m.type === "render").length >= 2, `the reproduction scene (${key})`);
    const warningsBefore = seen.warnings.length;
    const tasksBefore = seen.tasksRun.length;
    await seen.commands.get("studium.runReproduction")!();
    expect(seen.errors.at(-1)?.includes(key === "run_refused_parent" ? "sort de votre espace" : "chemin absolu") === true, `${key}: the learner is told why`);
    expect(seen.warnings.length === warningsBefore && seen.tasksRun.length === tasksBefore, `${key}: no prompt, no task`);
    pane.dispose();
  }

  // VSC-7: a restored pane reopens its lesson and resumes
  {
    await seen.uriHandler.handleUri(uriFor(resumePath));
    const before = lastPanel();
    await before.handler({ type: "respond", input: { kind: "ack" } });
    await waitFor(() => before.posted.filter((m: Json) => m.type === "render").length >= 2, "the reproduction scene (before the reload)");
    before.dispose();
    const serializer = seen.serializers.get("studiumLesson");
    const restored = fakePanel("studiumLesson");
    await serializer.deserializeWebviewPanel(restored, undefined);
    expect(restored.webview.html.length > 0 && restored.webview.options.enableScripts === true, "a restored pane gets its content and options back");
    expect(restored.posted.some((m: Json) => m.type === "render"), "and its lesson is started again");
    // W5 review: it RESUMES. The last lesson opened had its intro acknowledged by this learner and is not
    // complete, so the restored pane opens on the reproduction scene, not on scene one.
    const firstRestored = restored.posted.find((m: Json) => m.type === "render");
    expect(firstRestored?.scene?.id === "s-repro", `the restored pane resumes after the answered scene (got ${firstRestored?.scene?.id})`);
    restored.dispose();
    await globalStateData.delete("studium.lastLesson");
    const orphan = fakePanel("studiumLesson");
    await serializer.deserializeWebviewPanel(orphan, undefined);
    expect(orphan.disposed, "a restored pane with nothing to restore is closed");
  }

  // ENG-03: forget my data erases storage, trust memory and the last lesson
  {
    warningAnswer = (items) => items[0];
    // The assistants' data (lesson-mcp under Claude Code or Codex) lives in <STUDIUM_HOME>/data: named, not erased.
    const harnessData = join(isolation.studiumHome, "data");
    mkdirSync(harnessData, { recursive: true });
    writeFileSync(join(harnessData, "keep.txt"), "harness state");
    await seen.commands.get("studium.forgetMyData")!();
    const prompt = seen.warnings.at(-1)?.message ?? "";
    expect(prompt.includes(harnessData), `the confirmation names where the assistants' data lives (got ${prompt})`);
    expect(existsSync(join(harnessData, "keep.txt")), "and that data is left in place");
    expect(!existsSync(storage) || readdirSync(storage).length === 0, "the stored learner data is erased");
    expect(!globalStateData.has("studium.trustedRuns") && !globalStateData.has("studium.lastLesson"), "the trust memory and the last lesson are forgotten");
    expect(seen.infos.at(-1) === hostPhrase("forget_data_done", {}, "fr"), "the learner is told it is done");
  }

  // C4 + VSC-6 end to end: a production answer asks for a self-rating; the rating is confirmed and moves no
  // mastery; the lesson ends on a completion screen whose actions the host answers.
  {
    mkdirSync(join(lib, "wave"), { recursive: true });
    const wavePath = join(lib, "wave", "lesson.json");
    // The wave fixture plus one quiz on c1: its production answers are unmeasured without a judge (they ask for a
    // self-rating), so the quiz is what gives c1 a graded attempt for the completion lists.
    const wave = JSON.parse(readFileSync(join(extensionPath, "src", "fixtures", "wave-scenes.json"), "utf8"));
    wave.scenes.splice(2, 0, {
      id: "s-quiz", type: "quiz", title: "Quiz", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 60,
      adaptation_hooks: [], question: "2+2 ?", choices: [{ id: "a", text: "3", correct: false }, { id: "b", text: "4", correct: true }],
      feedback_correct: "Oui", feedback_incorrect: "Non", hints: [],
    });
    writeFileSync(wavePath, JSON.stringify(wave));
    await seen.uriHandler.handleUri(uriFor(wavePath));
    const pane = lastPanel();
    const stateFiles = () => listFiles(storage).filter((f) => /state-[^/]*\.json$/.test(f));
    const conceptStates = () => stateFiles().map((f) => JSON.stringify(JSON.parse(readFileSync(f, "utf8")).concept_states ?? null)).join("|");
    let rated = false;
    let done: Json | undefined;
    for (let step = 0; step < 30 && !done; step++) {
      const scene = pane.posted.filter((m: Json) => m.type === "render").at(-1)?.scene;
      if (!scene) break;
      const input = scene.type === "quiz" ? { kind: "quiz_choice", choiceId: "b" }
        : freeTextInput(scene.type, "Une réponse rédigée par l'apprenant, avec ses propres mots.") ?? { kind: "ack" };
      const before = pane.posted.length;
      await pane.handler({ type: "respond", input });
      const next = pane.posted.slice(before).find((m: Json) => m.type === "render" || m.type === "done");
      if (!next) { expect(false, `answering ${scene.id} produced no render (got ${pane.posted.slice(before).map((m: Json) => m.type).join(",")})`); break; }
      const request = next.self_rating ?? next.verdict?.self_rating;
      if (!rated && request?.requested) {
        rated = true;
        const sceneId = request.scene_id ?? next.verdict?.scene_id;
        expect(sceneId === scene.id, `the self-rating request names the answered scene (${sceneId} vs ${scene.id})`);
        const masteryBefore = conceptStates();
        const postedBefore = pane.posted.length;
        await pane.handler({ type: "rateRecall", sceneId, grade: "good" });
        const reply = pane.posted.slice(postedBefore).at(-1);
        expect(reply?.type === "recall_rated" && reply.sceneId === sceneId && reply.grade === "good",
          `a requested rating is confirmed with recall_rated (got ${JSON.stringify(reply)})`);
        expect(masteryBefore.length > 0 && conceptStates() === masteryBefore, "the self-rating changed no concept state (C4/D5: never mastery)");
        const events = listFiles(storage).filter((f) => f.endsWith("events.jsonl")).map((f) => readFileSync(f, "utf8")).join("\n");
        expect(events.includes("recall_self_rated"), "the rating is recorded as a recall_self_rated event");
      }
      if (next.type === "done") done = next;
    }
    expect(rated, "a production answer asked the learner for a self-rating (C4)");
    expect(!!done, "the wave lesson reached its completion screen");
    const listed = [...(done?.completion?.consolidated ?? []), ...(done?.completion?.to_revisit ?? [])];
    expect(listed.length > 0 && listed.every((c: Json) => c.id === "c1" && c.label === "Concept 1"),
      `graded concepts are listed by title (got ${JSON.stringify(listed)})`);
    expect(!JSON.stringify(done?.completion ?? {}).match(/mastery|0\.\d{2}/), "the completion data carries no score");

    // « Revoir le parcours » restarts the lesson in the pane; « Choisir un autre cours » opens the picker.
    const beforeRestart = pane.posted.length;
    await pane.handler({ type: "restartLesson" });
    const restarted = pane.posted.slice(beforeRestart).find((m: Json) => m.type === "render");
    expect(restarted?.scene?.id === "s-intro", `restartLesson renders the first scene again (got ${restarted?.scene?.id})`);
    const beforePick = pane.posted.length;
    await pane.handler({ type: "pickCourse" });
    expect(pane.posted.slice(beforePick).some((m: Json) => m.type === "action_settled") && seen.executed.includes("studium.pickLesson"),
      "pickCourse settles the pane and opens the course picker");
    pane.dispose();
  }

  // W4 review: a community bundle (community-<item>.zip opened from « Contributions de la classe ») names its
  // concepts by title too; before, the host could only read a plain lesson.json and fell back to the bare id.
  {
    const wave = JSON.parse(readFileSync(join(extensionPath, "src", "fixtures", "wave-scenes.json"), "utf8"));
    wave.bundle_id = "wave-community-001"; // not yet completed by this learner
    wave.scenes.splice(1, 0, {
      id: "s-quiz", type: "quiz", title: "Quiz", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 60,
      adaptation_hooks: [], question: "2+2 ?", choices: [{ id: "a", text: "3", correct: false }, { id: "b", text: "4", correct: true }],
      feedback_correct: "Oui", feedback_incorrect: "Non", hints: [],
    });
    mkdirSync(join(lib, "wave", "community"), { recursive: true });
    writeFileSync(join(lib, "wave", "community", "community-item1.zip"), makeZip({ "lesson.json": JSON.stringify(wave) }));
    await seen.commands.get("studium.openLesson")!("wave/community/community-item1.zip", "community");
    const pane = lastPanel();
    await waitFor(() => pane.posted.some((m: Json) => m.type === "render"), "the community lesson's first scene");
    let done: Json | undefined;
    for (let step = 0; step < 30 && !done; step++) {
      const scene = pane.posted.filter((m: Json) => m.type === "render").at(-1)?.scene;
      if (!scene) break;
      const input = scene.type === "quiz" ? { kind: "quiz_choice", choiceId: "b" }
        : freeTextInput(scene.type, "Une réponse rédigée par l'apprenant, avec ses propres mots.") ?? { kind: "ack" };
      const before = pane.posted.length;
      await pane.handler({ type: "respond", input });
      const next = pane.posted.slice(before).find((m: Json) => m.type === "render" || m.type === "done");
      if (!next) { expect(false, `community: answering ${scene.id} produced no render`); break; }
      if (next.type === "done") done = next;
    }
    expect(!!done, "the community lesson reached its completion screen");
    const listed = [...(done?.completion?.consolidated ?? []), ...(done?.completion?.to_revisit ?? [])];
    expect(listed.length > 0 && listed.every((c: Json) => c.id === "c1" && c.label === "Concept 1"),
      `a community .zip lesson lists its concepts by title, not the bare id (got ${JSON.stringify(listed)})`);
    pane.dispose();
  }

  // W4 review: « Réviser maintenant » with nothing due is a calm notice in the pane, never an action error
  // (before, the pane showed « Échec de l'action » with the server's text, or an empty message).
  {
    settings["learnerId"] = "e2e-nothing-due"; // a learner with no review history
    await seen.uriHandler.handleUri(uriFor(safePath));
    const pane = lastPanel();
    await waitFor(() => pane.posted.some((m: Json) => m.type === "render"), "the first scene (nothing due)");
    const before = pane.posted.length;
    await pane.handler({ type: "reviewNow" });
    const reply = pane.posted.slice(before).at(-1);
    const notices = [hostPhrase("review_nothing_scheduled", {}, "fr"), hostPhrase("review_nothing_due", {}, "fr").split("{date}")[0]!];
    expect(reply?.type === "action_notice" && typeof reply.message === "string" && notices.some((n) => reply.message.startsWith(n)),
      `nothing due answers with a localized notice (got ${JSON.stringify(reply)})`);
    expect(!pane.posted.slice(before).some((m: Json) => m.type === "action_error"), "and no action error");
    settings["learnerId"] = "e2e-learner";
    pane.dispose();
  }
}

main().then(() => {
  expect(isolation.homeUntouched(), `I-10: the extension and its lesson-mcp wrote nothing into the home directory (${isolation.home})`);
  if (failures.length) {
    console.error(`FAIL — ${failures.length}/${checks} extension-host assertions failed:`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`OK — extension-host (fake vscode + real lesson-mcp) passed all ${checks} assertions.`);
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
