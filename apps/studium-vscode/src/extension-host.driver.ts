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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostPhrase } from "./host-phrases.js";
import { freeTextInput } from "./scene-io.js";
import { isolateFromHome } from "./driver-isolation.js";
import { makeZip } from "./zip-fixture.js";
import { liveLessonMcpCount, parseToolResult, resolveServerLaunch } from "./mcp-connect.js";
import { MCP_PROVIDER_ID } from "./mcp-provider.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { phrase } from "./phrases.js";

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
// Laid out like VS Code's user data folder: <User>/globalStorage/<extension id>, so <User>/mcp.json is the
// user profile's MCP configuration the registration looks at (INT-STUDIUM-064).
const storage = join(scratch, "User", "globalStorage", "holobiomicslab.studium-vscode");
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
  outputLines: [] as string[], uriHandler: undefined as any, chatHandler: undefined as any, executed: [] as string[], serializers: new Map<string, any>(), treeProviders: new Map<string, any>(), statusItems: [] as any[],
  // BN-1 / BN-4 / BN-3: the file watchers the extension created (with their listeners), the buttons of each information
  // message, and the options of each quick pick.
  watchers: [] as FakeWatcher[], infoItems: [] as string[][], quickPickOptions: [] as Json[],
};
interface FakeWatcher { base: string; pattern: string; create: Array<(u: unknown) => void>; change: Array<(u: unknown) => void>; del: Array<(u: unknown) => void>; disposed: boolean }
let infoAnswer: ((message: string, items: string[]) => string | undefined) = () => undefined;
const windowStateListeners: Array<(state: { focused: boolean }) => void> = [];
let warningAnswer: ((items: string[]) => string | undefined) = () => undefined;
let quickPickAnswer: ((items: Json[]) => Json | undefined) = () => undefined;
let openDialogAnswer: string | undefined;
/** Every settings write, with its target (1 user, 2 workspace, 3 folder), and the error the next writes throw. */
const configWrites: Array<{ key: string; value: unknown; target: unknown }> = [];
let configWriteError: string | undefined;
const noop = () => ({ dispose() {} });
class FakeUri {
  scheme = "file";
  constructor(readonly fsPath: string) {}
  get path() { return this.fsPath; }
  toString() { return `file://${this.fsPath}`; }
  static file(p: string) { return new FakeUri(p); }
}
class FakeEmitter {
  private listeners: Array<(value: unknown) => void> = [];
  event = (listener: (value: unknown) => void) => { this.listeners.push(listener); return noop(); };
  fire(value?: unknown) { for (const listener of this.listeners) listener(value); }
  dispose() { this.listeners = []; }
}
/** INT-STUDIUM-064: what the editor's MCP API received, and the configuration listeners. */
const mcpApi = { providers: new Map<string, any>(), registerError: undefined as string | undefined };
const configListeners: Array<(e: { affectsConfiguration: (section: string) => boolean }) => void> = [];
class FakeMcpStdioServerDefinition {
  cwd: FakeUri | undefined;
  constructor(readonly label: string, public command: string, public args: string[] = [], public env: Json = {}, public version?: string) {}
}
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
  RelativePattern: class { constructor(public base: unknown, public pattern: string) {} },
  McpStdioServerDefinition: FakeMcpStdioServerDefinition,
  lm: {
    registerMcpServerDefinitionProvider: (id: string, provider: unknown) => {
      if (mcpApi.registerError) throw new Error(mcpApi.registerError);
      mcpApi.providers.set(id, provider);
      return { dispose() { mcpApi.providers.delete(id); } };
    },
  },
  TreeItem: class { constructor(public label: string, public collapsibleState?: number) {} },
  ThemeIcon: class { constructor(public id: string) {} },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { Beside: -2 }, ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }, TaskScope: { Workspace: 2 },
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
      // Like VS Code: workspace settings cannot be written when no folder or workspace is open.
      update: async (key: string, value: unknown, target?: unknown) => {
        if (configWriteError) throw new Error(configWriteError);
        if (target === 2 && !fakeVscode.workspace.workspaceFolders?.length && !fakeVscode.workspace.workspaceFile) {
          throw new Error("Unable to write to Workspace Settings because no workspace is opened. Please open a workspace first and try again.");
        }
        configWrites.push({ key, value, target });
        settings[key] = value;
      },
    }),
    registerNotebookSerializer: noop, openNotebookDocument: async () => ({}), onDidCloseNotebookDocument: noop,
    onDidChangeConfiguration: (listener: (e: any) => void) => { configListeners.push(listener); return noop(); },
    onDidChangeWorkspaceFolders: noop,
    createFileSystemWatcher: (pattern: any) => {
      const w: FakeWatcher = { base: String(pattern?.base?.fsPath ?? pattern?.base ?? ""), pattern: String(pattern?.pattern ?? pattern), create: [], change: [], del: [], disposed: false };
      seen.watchers.push(w);
      const on = (list: Array<(u: unknown) => void>) => (listener: (u: unknown) => void) => { list.push(listener); return noop(); };
      return { onDidCreate: on(w.create), onDidChange: on(w.change), onDidDelete: on(w.del), dispose() { w.disposed = true; } };
    },
  },
  notebooks: { createNotebookController: () => ({ dispose() {}, supportedLanguages: [] }) },
  chat: { createChatParticipant: (_id: string, handler: any) => { seen.chatHandler = handler; return { dispose() {}, iconPath: undefined }; } },
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
    createOutputChannel: () => ({ appendLine(line: string) { seen.outputLines.push(line); }, dispose() {} }),
    registerTreeDataProvider: (id: string, provider: unknown) => { seen.treeProviders.set(id, provider); return noop(); },
    createTreeView: (id: string, options: Json) => {
      seen.treeProviders.set(id, options.treeDataProvider);
      return { visible: true, onDidChangeVisibility: noop, dispose() {} };
    },
    state: { focused: true },
    onDidChangeWindowState: (listener: (state: { focused: boolean }) => void) => { windowStateListeners.push(listener); return noop(); },
    registerUriHandler: (h: unknown) => { seen.uriHandler = h; return noop(); },
    registerWebviewPanelSerializer: (type: string, s: unknown) => { seen.serializers.set(type, s); return noop(); },
    createStatusBarItem: () => { const item = { text: "", tooltip: "", command: "", shown: false, show() { item.shown = true; }, hide() { item.shown = false; }, dispose() {} }; seen.statusItems.push(item); return item; },
    showInformationMessage: (m: string, ...items: string[]) => { seen.infos.push(m); seen.infoItems.push(items); return Promise.resolve(infoAnswer(m, items)); },
    showErrorMessage: (m: string) => { seen.errors.push(m); return Promise.resolve(undefined); },
    showWarningMessage: (message: string, options: Json, ...items: string[]) => {
      seen.warnings.push({ message, options, items });
      return Promise.resolve(warningAnswer(items));
    },
    showQuickPick: async (items: Json[], options?: Json) => { seen.quickPickOptions.push(options ?? {}); return quickPickAnswer(items); },
    showOpenDialog: async () => (openDialogAnswer ? [new FakeUri(openDialogAnswer)] : undefined),
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
/** Whether two paths name the same folder (macOS puts the temporary folder behind a /private symlink). */
function sameFolder(a: string, b: string): boolean {
  try { return realpathSync(a) === realpathSync(b); } catch { return resolve(a) === resolve(b); }
}
/** The live watcher the extension created on a folder for a pattern. */
function watcherOn(base: string, pattern: string): FakeWatcher | undefined {
  return seen.watchers.filter((w) => !w.disposed && w.pattern === pattern && sameFolder(w.base, base)).at(-1);
}
/** A file event, as VS Code delivers it to the watcher's listeners. */
function fire(watcher: FakeWatcher | undefined, kind: "create" | "change" | "del", path: string) {
  for (const listener of watcher?.[kind] ?? []) listener(FakeUri.file(path));
}
/** A host phrase in either language: the extension speaks the language of the last lesson shown. */
const hostEither = (key: Parameters<typeof hostPhrase>[0], params: Json = {}) => [hostPhrase(key, params, "fr"), hostPhrase(key, params, "en")];
const lastPanel = () => seen.panels[seen.panels.length - 1];
async function waitFor(cond: () => boolean, what: string, ms = 20000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) { expect(false, `timed out waiting for ${what}`); return false; } await sleep(50); }
  return true;
}

async function main() {
  const ext = await import("./extension.js");
  // BN-1: the library an assistant's server writes to, <STUDIUM_HOME>/library, does not exist on a fresh install.
  const libraryRoot = join(isolation.studiumHome, "library");
  const libraryExistedBefore = existsSync(libraryRoot);
  ext.activate(context as any);
  {
    expect(!libraryExistedBefore && existsSync(libraryRoot), "activation creates the library folder, so its watcher works on a fresh install");
    const lessons = watcherOn(libraryRoot, "*/lesson.json");
    const sources = watcherOn(libraryRoot, "_sources/*.json");
    expect(!!lessons && lessons.create.length > 0 && lessons.change.length > 0,
      `the library's lessons are watched for create and change events (got ${JSON.stringify(seen.watchers.map((w) => [w.base, w.pattern]))})`);
    expect(!!sources && sources.create.length > 0 && sources.change.length > 0, "and so are its source sets (_sources/*.json)");
  }

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
    const listed = [...(completion?.consolidated ?? []), ...(completion?.practised ?? []), ...(completion?.not_measured ?? [])];
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
    // Changed (L-5): the learner is « tu » in the host messages too (« ton espace », was « votre espace »).
    expect(seen.errors.at(-1)?.includes(key === "run_refused_parent" ? "sort de ton espace" : "chemin absolu") === true, `${key}: the learner is told why`);
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

  // CQ-3 / CQ-4: the @studium chat streams the host's own text (the authoring notice of a self-study lesson
  // included) and sends the learner's words as {kind: "reply", text}, showing the host's refusal when it cannot
  // read them. Its lesson-mcp runs on the extension's storage, like the pane's.
  const chat = async (prompt: string, command?: string) => {
    let out = "";
    await seen.chatHandler({ prompt, command }, {}, { markdown: (text: string) => { out += text; } }, {});
    return out;
  };
  {
    const lesson = JSON.parse(readFileSync(join(extensionPath, "src", "fixtures", "wave-scenes.json"), "utf8"));
    lesson.bundle_id = "chat-wave-001";
    lesson.metadata.authoring = { mode: "self_study", author_is_learner: true };
    lesson.scenes.splice(2, 0, {
      id: "s-quiz", type: "quiz", title: "Quiz", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 60,
      adaptation_hooks: [], question: "2+2 ?", choices: [{ id: "a", text: "3", correct: false }, { id: "b", text: "4", correct: true }],
      feedback_correct: "Oui", feedback_incorrect: "Non", hints: [],
    });
    mkdirSync(join(lib, "chat"), { recursive: true });
    writeFileSync(join(lib, "chat", "lesson.json"), JSON.stringify(lesson));
    settings["bundlesRoot"] = lib;
    settings["bundleRef"] = "chat/lesson.json";
    const started = await chat("", "start");
    expect(started.includes("Leçon auto-rédigée"), `the chat shows the host's authoring notice on the first screen (got ${started.slice(0, 300)})`);
    await chat("continuer");
    const quiz = await chat("continuer");
    expect(quiz.includes("2+2"), `the chat reaches the quiz (got ${quiz.slice(0, 200)})`);
    const refused = await chat("purple");
    // Changed: the refusal used to embed the host's raw reason (English, agent-facing: « displayed choice ids: a, b;
    // reply with the learner's letter »). The learner now reads the localised line and how this scene is answered;
    // the raw reason goes to the output channel.
    expect(refused.startsWith(phrase("chat_refused", {}, "fr")), `an unreadable quiz reply shows the localised refusal (got ${refused})`);
    expect(!/displayed choice|reply with|learner|submit_/.test(refused), `no agent-facing host text reaches the learner (got ${refused})`);
    expect(refused.trim().endsWith(quiz.trim().split("\n\n").at(-1)!.trim()), `then how the quiz is answered (got ${refused})`);
    expect(seen.outputLines.some((l) => l.includes("displayed choice ids")), "the host's reason is logged to the output channel");
    // The host shuffles displayed choices: answer with the id it shows for "4".
    const right = /\*\*(\w+)\)\*\* 4\b/.exec(quiz)?.[1] ?? "b";
    const answered = await chat(`Réponse : ${right}`);
    expect(answered.includes("✓"), `« Réponse : ${right} » is mapped by the host (the old chat parser refused it) (got ${answered.slice(0, 200)})`);
    expect(!/errors_threshold|rule_\w/.test(started + quiz + refused + answered), "no reason code or rule id reaches the chat");
    const stored = listFiles(storage);
    expect(stored.length > 0, "the chat's lesson-mcp writes its learner state under the extension storage");
    settings["bundleRef"] = undefined;
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
    // SEC-4: the chat's own lesson-mcp was closed before the erase, so nothing it holds can be written back.
    expect(liveLessonMcpCount() === 0, `no lesson-mcp is left running after the erase (got ${liveLessonMcpCount()})`);
    await sleep(300);
    expect(!existsSync(storage) || listFiles(storage).length === 0, "and nothing was written back after it");
    settings["bundleRef"] = "chat/lesson.json";
    const restarted = await chat("continuer");
    settings["bundleRef"] = undefined;
    expect(restarted.includes(phrase("chat_started", { bundle: "chat/lesson.json" }, "fr")),
      `the chat starts a fresh lesson instead of answering on a closed server (got ${restarted.slice(0, 120)})`);
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
    // Changed (L-6): the lists are now consolidated / practised / not_measured (to_revisit is gone); one right quiz
    // answer makes c1 practised with one graded answer, never consolidated.
    const listed = [...(done?.completion?.consolidated ?? []), ...(done?.completion?.practised ?? []), ...(done?.completion?.not_measured ?? [])];
    expect(listed.length > 0 && listed.every((c: Json) => c.id === "c1" && c.label === "Concept 1"),
      `graded concepts are listed by title (got ${JSON.stringify(listed)})`);
    expect(JSON.stringify(done?.completion?.practised) === '[{"id":"c1","label":"Concept 1","answers":1}]' && !(done?.completion?.consolidated ?? []).length,
      `one right answer is practised (1 answer), never consolidated (got ${JSON.stringify(done?.completion)})`);
    expect(!JSON.stringify(done?.completion ?? {}).match(/mastery|0\.\d{2}/), "the completion data carries no score");
    // UX-11: the last answer asks for a rating; rating it sends the end screen the review date it produced.
    const lastRequest = done?.self_rating ?? done?.verdict?.self_rating;
    expect(lastRequest?.requested === true, "the lesson's last (production) answer asks for a rating");
    if (lastRequest?.requested) {
      const before = pane.posted.length;
      await pane.handler({ type: "rateRecall", sceneId: lastRequest.scene_id ?? done?.verdict?.scene_id, grade: "easy" });
      const reply = pane.posted.slice(before).at(-1);
      expect(reply?.type === "recall_rated" && typeof reply.completion?.next_review_at === "number",
        `the rating on the last scene carries the updated next review (got ${JSON.stringify(reply)})`);
    }

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
    const listed = [...(done?.completion?.consolidated ?? []), ...(done?.completion?.practised ?? []), ...(done?.completion?.not_measured ?? [])];
    expect(listed.length > 0 && listed.every((c: Json) => c.id === "c1" && c.label === "Concept 1"),
      `a community .zip lesson lists its concepts by title, not the bare id (got ${JSON.stringify(listed)})`);
    pane.dispose();
  }

  // Walkthrough 2026-11-07: the pane's « Rouvrir la leçon » (shown when the server lost the session) closes the stale
  // pane and opens the same lesson again, which resumes the learner's progress.
  {
    await seen.uriHandler.handleUri(uriFor(safePath));
    const pane = lastPanel();
    await waitFor(() => pane.posted.some((m: Json) => m.type === "render"), "the first scene (reopen)");
    const panesBefore = seen.panels.length;
    await pane.handler({ type: "reopen" });
    expect(pane.disposed, "reopen closes the stale pane");
    expect(seen.panels.length === panesBefore + 1, `reopen opens one new pane (got ${seen.panels.length - panesBefore})`);
    const fresh = lastPanel();
    await waitFor(() => fresh.posted.some((m: Json) => m.type === "render"), "the reopened lesson's scene");
    expect(fresh.posted.some((m: Json) => m.type === "render" && m.view?.bundle_ref === "safe/lesson.json"), "the new pane shows the same lesson");
    fresh.dispose();
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


  // INT-STUDIUM-064 (2): the extension offers its own bundled server to Copilot's agent mode, so building a lesson
  // in VS Code needs no Node and no command. Same lessons folder and data folder as the pane's server.
  {
    const provider = mcpApi.providers.get(MCP_PROVIDER_ID);
    expect(!!provider && typeof provider.provideMcpServerDefinitions === "function",
      `activation registers an MCP server definition provider under ${MCP_PROVIDER_ID}`);
    const provide = async (): Promise<any[]> => (await provider?.provideMcpServerDefinitions({ isCancellationRequested: false })) ?? [];
    const fireConfig = (section: string) => configListeners.forEach((l) => l({ affectsConfiguration: (s: string) => section === s || section.startsWith(`${s}.`) }));
    settings["bundlesRoot"] = lib;
    const savedJudge = process.env["LITELLM_BASE_URL"];
    process.env["LITELLM_BASE_URL"] = "";
    const defs = await provide();
    expect(defs.length === 1, `one server is offered (got ${defs.length})`);
    const def = defs[0] ?? {};
    const launch = resolveServerLaunch(extensionPath, repoRoot);
    expect(def.label === "Studium" && def.command === launch.command && JSON.stringify(def.args) === JSON.stringify(launch.args)
      && def.cwd?.fsPath === launch.cwd, `the definition starts the pane's lesson-mcp (got ${JSON.stringify({ label: def.label, command: def.command, args: def.args, cwd: def.cwd?.fsPath })})`);
    expect(def.env?.BUNDLES_ROOT === lib && def.env?.STUDIUM_DATA_DIR === storage && def.env?.LITELLM_BASE_URL === ""
      && def.env?.STUDIUM_TELEMETRY_CONSENT === null, `same lessons folder and data folder as the pane, no judge (got ${JSON.stringify(def.env)})`);
    const allowed = new Set(["BUNDLES_ROOT", "STUDIUM_DATA_DIR", "STUDIUM_TELEMETRY_CONSENT", "LITELLM_BASE_URL", "ELECTRON_RUN_AS_NODE"]);
    expect(Object.keys(def.env ?? {}).every((k) => allowed.has(k)), `nothing else is copied from the editor's environment (got ${Object.keys(def.env ?? {})})`);

    // Start it the way the editor does (the definition's env over the extension host's), and ask who it is.
    if (def.command) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
      for (const [k, v] of Object.entries(def.env as Json)) { if (v === null) delete env[k]; else env[k] = String(v); }
      const client = new Client({ name: "fake-copilot", version: "0" });
      await client.connect(new StdioClientTransport({ command: def.command, args: def.args, cwd: def.cwd?.fsPath, env, stderr: "pipe" }));
      const info = parseToolResult("get_server_info", await client.callTool({ name: "get_server_info", arguments: {} }));
      await client.close();
      expect(info["bundles_root"] === lib && info["data_dir"] === storage && info["model_backend"] === "none",
        `the started server reads the pane's lessons folder, keeps progress in the extension storage, calls no model (got ${JSON.stringify({ b: info["bundles_root"], d: info["data_dir"], m: info["model_backend"] })})`);
      expect(Array.isArray(info["tools"]) && info["tools"].includes("create_lesson") && info["tools"].includes("prepare_sources"),
        "the started server offers the authoring tools that build a lesson");
    }

    // The setting turns it off, and the editor is told the list changed.
    let changes = 0;
    provider?.onDidChangeMcpServerDefinitions?.(() => { changes++; });
    settings["registerMcpServer"] = false;
    fireConfig("studium.registerMcpServer");
    expect(changes >= 1, "changing a Studium setting tells the editor the server list changed");
    expect((await provide()).length === 0, "studium.registerMcpServer = false: no server is offered");
    expect(seen.outputLines.some((l) => l.includes("studium.registerMcpServer")), "the output channel says the setting turned it off");
    settings["registerMcpServer"] = true;
    expect((await provide()).length === 1, "back on: the server is offered again");

    // A server the user added by hand (code --add-mcp, mcp.json, Copilot's own file): no second one.
    const userMcp = join(scratch, "User", "mcp.json");
    writeFileSync(userMcp, JSON.stringify({ servers: { studium: { command: "npx", args: ["-y", "studium-mcp"], env: { LITELLM_BASE_URL: "" } } } }));
    expect((await provide()).length === 0, "a studium server in the user profile's mcp.json: the extension adds none");
    expect(seen.outputLines.some((l) => l.includes(userMcp)), "the output channel names the file that holds it");
    rmSync(userMcp);
    expect((await provide()).length === 1, "once that entry is gone, the built-in server is offered again");
    mkdirSync(join(workspace, ".vscode"), { recursive: true });
    writeFileSync(join(workspace, ".vscode", "mcp.json"), `{ // "studium": { "command": "npx" }
      "servers": { "other": { "command": "node", "args": ["x.js"] }, }, }`);
    expect((await provide()).length === 1, "a workspace mcp.json with only a commented-out studium: still offered");
    writeFileSync(join(workspace, ".mcp.json"), JSON.stringify({ mcpServers: { learn: { command: "npx", args: ["-y", "studium-mcp"] } } }));
    expect((await provide()).length === 0, "a workspace .mcp.json that runs studium-mcp: the extension adds none");
    rmSync(join(workspace, ".mcp.json"));
    process.env["COPILOT_HOME"] = join(scratch, "copilot");
    mkdirSync(join(scratch, "copilot"), { recursive: true });
    writeFileSync(join(scratch, "copilot", "mcp-config.json"), JSON.stringify({ mcpServers: { studium: { command: "npx", args: ["-y", "studium-mcp"] } } }));
    expect((await provide()).length === 0, "a studium server in Copilot's own mcp-config.json: the extension adds none");
    delete process.env["COPILOT_HOME"];
    expect((await provide()).length === 1, "and offered again when it is not there");

    // A judge configured in the environment VS Code was started from is kept, as for the pane.
    process.env["LITELLM_BASE_URL"] = "http://localhost:4000";
    expect((await provide())[0]?.env?.LITELLM_BASE_URL === "http://localhost:4000", "a configured judge is passed on");
    if (savedJudge === undefined) delete process.env["LITELLM_BASE_URL"]; else process.env["LITELLM_BASE_URL"] = savedJudge;

    // Editors without the API (VS Code before 1.101, forks) or with one that throws: nothing breaks.
    const { registerStudiumMcpServer } = await import("./mcp-registration.js");
    const deps = { locations: () => ({ bundlesRoot: lib, storageDir: storage, telemetryConsent: false }), repoRoot: () => repoRoot,
      enabled: () => true, log: (line: string) => { seen.outputLines.push(line); } };
    const savedLm = fakeVscode.lm;
    delete fakeVscode.lm;
    let outcome: unknown;
    try { outcome = registerStudiumMcpServer({ extensionPath, subscriptions: [] } as any, deps); } catch (e) { outcome = e; }
    expect(outcome === false, `no MCP API: registration is skipped without an error (got ${String(outcome)})`);
    expect(seen.outputLines.at(-1)?.includes("1.101") === true, "and the output channel says which VS Code it needs");
    fakeVscode.lm = savedLm;
    mcpApi.registerError = "Extension 'holobiomicslab.studium-vscode' CANNOT use API proposal: mcpConfigurationProvider";
    try { outcome = registerStudiumMcpServer({ extensionPath, subscriptions: [] } as any, deps); } catch (e) { outcome = e; }
    mcpApi.registerError = undefined;
    expect(outcome === false, `an API that refuses the registration: skipped without an error (got ${String(outcome)})`);
    settings["bundlesRoot"] = lib;
  }

  // Tester report 2026-11-24: VS Code freshly installed, no folder open, a lesson built by an assistant; choosing it in
  // « Choisir un cours » stopped on « Unable to write to Workspace Settings » and no lesson opened. Remembering the
  // choice must never block the open: with no folder it goes to the user settings, and when no settings file can be
  // written the lesson opens all the same, from the folder the learner chose.
  {
    makeLesson("picked", SAFE_RUN, "capsule-run-picked");
    const savedFolders = fakeVscode.workspace.workspaceFolders;
    const savedRoot = settings["bundlesRoot"];
    const pickPicked = (items: Json[]) => items.find((i) => i.ref === "picked/lesson.json") ?? items.find((i) => i.action === "folder");
    quickPickAnswer = pickPicked;
    openDialogAnswer = lib;
    const openPicked = async (what: string) => {
      const panesBefore = seen.panels.length;
      await seen.commands.get("studium.pickLesson")!();
      const pane = seen.panels.length > panesBefore ? lastPanel() : undefined;
      if (pane) await waitFor(() => pane.posted.some((m: Json) => m.type === "render" || m.type === "error"), `the picked lesson (${what})`);
      return pane;
    };

    // No folder open: the choice is saved in the user settings and the lesson opens.
    fakeVscode.workspace.workspaceFolders = undefined;
    settings["bundlesRoot"] = emptyRoot;
    settings["bundleRef"] = undefined;
    let errorsBefore = seen.errors.length;
    let writesBefore = configWrites.length;
    let pane = await openPicked("no folder");
    expect(seen.errors.length === errorsBefore, `no folder open: picking a lesson shows no error (got ${JSON.stringify(seen.errors.slice(errorsBefore))})`);
    expect(pane?.posted.some((m: Json) => m.type === "render" && m.view?.bundle_ref === "picked/lesson.json") === true,
      "no folder open: the picked lesson opens in the pane");
    const noFolderWrites = configWrites.slice(writesBefore);
    expect(noFolderWrites.length === 2 && noFolderWrites.every((w) => w.target === 1),
      `no folder open: the choice is saved in the user settings (got ${JSON.stringify(noFolderWrites)})`);
    expect(settings["bundlesRoot"] === lib && settings["bundleRef"] === "picked/lesson.json",
      "no folder open: the tree, the chat and the notebook read the saved course from the settings");
    pane?.dispose();

    // No settings file can be written (read-only, malformed, unsaved changes): the lesson opens anyway, from the
    // chosen folder, and the learner is told the choice was not saved.
    settings["bundlesRoot"] = emptyRoot;
    settings["bundleRef"] = undefined;
    configWriteError = "Unable to write into user settings. Please open the user settings to correct errors/warnings in it and try again.";
    errorsBefore = seen.errors.length;
    const warningsBefore = seen.warnings.length;
    globalStateData.delete("studium.lastLesson");
    pane = await openPicked("unwritable settings");
    configWriteError = undefined;
    expect(pane?.posted.some((m: Json) => m.type === "render" && m.view?.bundle_ref === "picked/lesson.json") === true,
      "unwritable settings: the picked lesson still opens, from the folder the learner chose");
    expect(seen.errors.length === errorsBefore, "unwritable settings: no error stops the open");
    expect(seen.warnings.slice(warningsBefore).some((w) => w.message.includes("Unable to write into user settings")),
      "unwritable settings: a notice says the choice was not saved, and why");
    const remembered = globalStateData.get("studium.lastLesson") as Json;
    expect(remembered?.bundlesRoot === lib && remembered?.bundleRef === "picked/lesson.json",
      "unwritable settings: a window reload still restores the lesson from the chosen folder");
    pane?.dispose();

    // A folder open: the choice stays the workspace's, as before.
    fakeVscode.workspace.workspaceFolders = savedFolders;
    settings["bundlesRoot"] = emptyRoot;
    writesBefore = configWrites.length;
    pane = await openPicked("folder open");
    const folderWrites = configWrites.slice(writesBefore);
    expect(folderWrites.length === 2 && folderWrites.every((w) => w.target === 2),
      `a folder open: the choice is saved in the workspace settings (got ${JSON.stringify(folderWrites)})`);
    expect(pane?.posted.some((m: Json) => m.type === "render" && m.view?.bundle_ref === "picked/lesson.json") === true,
      "a folder open: the picked lesson opens");
    pane?.dispose();

    quickPickAnswer = () => undefined;
    openDialogAnswer = undefined;
    settings["bundlesRoot"] = savedRoot;
    settings["bundleRef"] = undefined;
  }

  // 2026-11-25: a fresh install has no lesson. « Try the demo lesson » (welcome view, picker, walkthrough) opens the
  // « Discover Studium » lesson shipped with Studium, in VS Code's display language (here en, while the last lesson
  // played was French), from the shipped folder: it never
  // becomes the learner's course setting, and its first screen says it ships with Studium and no teacher checked it.
  {
    const savedRoot = settings["bundlesRoot"];
    settings["bundlesRoot"] = emptyRoot;
    settings["bundleRef"] = undefined;
    const writesBefore = configWrites.length;
    const errorsBefore = seen.errors.length;
    const opensDemo = async (what: string, run: () => Promise<unknown>) => {
      const panesBefore = seen.panels.length;
      await run();
      const pane = seen.panels.length > panesBefore ? lastPanel() : undefined;
      if (pane) await waitFor(() => pane.posted.some((m: Json) => m.type === "render" || m.type === "error"), `the demo lesson (${what})`);
      const render = pane?.posted.find((m: Json) => m.type === "render");
      expect(render?.view?.bundle_ref === "discover-studium-en/lesson.json", `${what}: the English demo opens (got ${render?.view?.bundle_ref})`);
      expect(JSON.stringify(render ?? {}).includes("Demo lesson shipped with Studium"), `${what}: its notice says it ships with Studium`);
      pane?.dispose();
    };
    expect(seen.commands.has("studium.openDemoLesson"), "the studium.openDemoLesson command is registered");
    await opensDemo("command", () => seen.commands.get("studium.openDemoLesson")!());
    quickPickAnswer = (items: Json[]) => {
      const demo = items.find((i) => i.action === "demo");
      expect(!!demo && items.indexOf(demo) === items.length - 2, "the picker offers the demo, just before choosing another folder");
      return demo;
    };
    await opensDemo("picker", () => seen.commands.get("studium.pickLesson")!());
    quickPickAnswer = () => undefined;
    expect(configWrites.length === writesBefore, "opening the demo writes no setting: the learner's course folder stays theirs");
    expect(seen.errors.length === errorsBefore, `opening the demo shows no error (got ${JSON.stringify(seen.errors.slice(errorsBefore))})`);
    settings["bundlesRoot"] = savedRoot;
  }

  // BN-4 + BN-1, end to end with the real server: the server the extension offers Copilot prepares sources and writes a
  // lesson into <STUDIUM_HOME>/library; the extension, told by its watchers, shows « preparing a lesson » in the status
  // bar, then announces the lesson (title, steps; Open, Later, Don't show again). Open plays it from the library, with
  // no settings write. The lessons folder here is another one (lib), so the tree lists the lesson under « Your library ».
  {
    const libraryRoot = join(isolation.studiumHome, "library");
    const lessonsWatcher = watcherOn(libraryRoot, "*/lesson.json");
    const sourcesWatcher = watcherOn(libraryRoot, "_sources/*.json");
    const status = seen.statusItems[0];
    const tree = seen.treeProviders.get("studiumLessons");
    let refreshes = 0;
    tree.onDidChangeTreeData(() => { refreshes++; });
    settings["bundlesRoot"] = lib;
    settings["bundleRef"] = undefined;

    const provider = mcpApi.providers.get(MCP_PROVIDER_ID);
    const def = ((await provider?.provideMcpServerDefinitions({ isCancellationRequested: false })) ?? [])[0];
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    for (const [k, v] of Object.entries((def?.env ?? {}) as Json)) { if (v === null) delete env[k]; else env[k] = String(v); }
    const client = new Client({ name: "fake-copilot-build", version: "0" });
    await client.connect(new StdioClientTransport({ command: def.command, args: def.args, cwd: def.cwd?.fsPath, env, stderr: "pipe" }));
    const replay = join(extensionPath, "src", "fixtures", "build-replay");
    const prepare = JSON.parse(readFileSync(join(replay, "prepare.json"), "utf8"));
    prepare.sources[0].path = join(replay, "photosynthese.md");
    const prepared = parseToolResult("prepare_sources", await client.callTool({ name: "prepare_sources", arguments: prepare }));
    const sourceSetId = String(prepared["source_set_id"] ?? "");
    const sourceSetPath = join(libraryRoot, "_sources", `${sourceSetId}.json`);
    expect(existsSync(sourceSetPath), `prepare_sources writes its source set into the library the extension watches (got ${JSON.stringify(prepared).slice(0, 200)})`);
    fire(sourcesWatcher, "create", sourceSetPath);
    const preparingText = hostEither("status_preparing");
    expect(status.shown && preparingText.includes(status.text), `the status bar says a lesson is being prepared (got ${status.text})`);
    expect(String(status.tooltip).includes("La photosynthèse : notes de cours (L1)"), `its tooltip names the source (got ${status.tooltip})`);

    const create = JSON.parse(readFileSync(join(replay, "create.json"), "utf8"));
    create.source_set_id = sourceSetId;
    const created = parseToolResult("create_lesson", await client.callTool({ name: "create_lesson", arguments: create }));
    await client.close();
    const lessonPath = join(libraryRoot, "photosynthese", "lesson.json");
    expect(existsSync(lessonPath), `create_lesson writes the lesson into the library (got ${JSON.stringify(created).slice(0, 300)})`);
    const written = existsSync(lessonPath) ? JSON.parse(readFileSync(lessonPath, "utf8")) : {};
    const title = String(written?.metadata?.title ?? "");
    const steps = Array.isArray(written?.scenes) ? written.scenes.length : 0;
    expect(written?.source_plan_id === sourceSetId, "the lesson cites the source set at its top level (source_plan_id)");

    const infosBefore = seen.infos.length;
    const writesBefore = configWrites.length;
    const panesBefore = seen.panels.length;
    const refreshesBefore = refreshes;
    infoAnswer = (message, items) => (message.includes(title) ? items[0] : undefined);
    fire(lessonsWatcher, "create", lessonPath);
    await waitFor(() => seen.infos.length > infosBefore, "the lesson-ready notice");
    const notice = seen.infos[infosBefore] ?? "";
    const items = seen.infoItems[infosBefore] ?? [];
    const locale = hostPhrase("lesson_ready", { title, steps }, "en") === notice ? "en" : "fr";
    expect(notice === hostPhrase("lesson_ready", { title, steps }, locale), `the notice names the lesson and its steps (got ${notice})`);
    expect(JSON.stringify(items) === JSON.stringify(["lesson_ready_open", "lesson_ready_later", "lesson_ready_never"].map((k) => hostPhrase(k as any, {}, locale))),
      `it offers Open, Later and Don't show again (got ${JSON.stringify(items)})`);
    expect(refreshes > refreshesBefore, "the Lessons view was refreshed");
    expect(!preparingText.includes(status.text) || !status.shown, `the lesson that cites the source set ends « preparing » (got ${status.text})`);
    const libraryNode = tree.getChildren().find((n: Json) => n.id === "library");
    expect(libraryNode?.children?.some((c: Json) => c.args?.[0] === "photosynthese/lesson.json" && c.args?.[1] === "library") === true,
      `the lessons folder is another one: « Your library » lists the new lesson (got ${JSON.stringify(libraryNode)})`);
    await waitFor(() => seen.panels.length > panesBefore && lastPanel().posted.some((m: Json) => m.type === "render" || m.type === "error"), "the lesson opened from the notice");
    const pane = lastPanel();
    const render = pane.posted.find((m: Json) => m.type === "render");
    expect(render?.view?.bundle_ref === "photosynthese/lesson.json", `Open plays the new lesson (got ${render?.view?.bundle_ref ?? JSON.stringify(pane.posted.find((m: Json) => m.type === "error"))})`);
    expect(sameFolder((globalStateData.get("studium.lastLesson") as Json)?.bundlesRoot ?? "", libraryRoot), "from the library");
    expect(configWrites.length === writesBefore, "and writes no setting (the settings write that failed for the tester is not on this path)");
    pane.dispose();

    // Critic 3: the build takes minutes and the learner works elsewhere. Unfocused, the notice waits; it is shown once
    // when the window comes back.
    infoAnswer = () => undefined;
    fakeVscode.window.state.focused = false;
    const second = join(libraryRoot, "photosynthese-bis", "lesson.json");
    mkdirSync(join(libraryRoot, "photosynthese-bis"), { recursive: true });
    copyFileSync(lessonPath, second);
    const unfocusedBefore = seen.infos.length;
    const refreshesUnfocused = refreshes;
    fire(lessonsWatcher, "create", second);
    await sleep(900);
    expect(seen.infos.length === unfocusedBefore, `window in the background: no notice yet (got ${JSON.stringify(seen.infos.slice(unfocusedBefore))})`);
    expect(refreshes > refreshesUnfocused, "but the Lessons view is refreshed");
    fakeVscode.window.state.focused = true;
    for (const listener of windowStateListeners) listener({ focused: true });
    await waitFor(() => seen.infos.length > unfocusedBefore, "the notice when the window comes back");
    for (const listener of windowStateListeners) listener({ focused: true });
    await sleep(100);
    // Opening the French lesson above switched the extension's language: compare in either language.
    expect(seen.infos.length === unfocusedBefore + 1 && hostEither("lesson_ready", { title, steps }).includes(seen.infos.at(-1) ?? ""),
      `the window comes back: the notice is shown once (got ${JSON.stringify(seen.infos.slice(unfocusedBefore))})`);

    // « Don't show again » is kept: later lessons refresh the view and are not announced. A change event counts too.
    infoAnswer = (_message, offered) => offered[2];
    const third = join(libraryRoot, "photosynthese-ter", "lesson.json");
    mkdirSync(join(libraryRoot, "photosynthese-ter"), { recursive: true });
    copyFileSync(lessonPath, third);
    const mutedBefore = seen.infos.length;
    fire(lessonsWatcher, "change", third);
    await waitFor(() => seen.infos.length > mutedBefore, "the notice on a change event");
    await sleep(50);
    expect(globalStateData.get("studium.lessonReadyMuted") === true, "Don't show again is kept in the global state");
    infoAnswer = () => undefined;
    const fourth = join(libraryRoot, "photosynthese-quater", "lesson.json");
    mkdirSync(join(libraryRoot, "photosynthese-quater"), { recursive: true });
    copyFileSync(lessonPath, fourth);
    const afterMute = seen.infos.length;
    const refreshesMuted = refreshes;
    fire(lessonsWatcher, "create", fourth);
    await sleep(900);
    expect(seen.infos.length === afterMute && refreshes > refreshesMuted, "after Don't show again: refreshed, not announced");
    globalStateData.delete("studium.lessonReadyMuted");

    // The lessons folder (studium.bundlesRoot), when it is not the library, is watched to refresh the list only: a pull
    // that touches many lessons must not announce each one. Its watcher follows the setting.
    const fireConfig = (section: string) => configListeners.forEach((l) => l({ affectsConfiguration: (s: string) => section === s || section.startsWith(`${s}.`) }));
    fireConfig("studium.bundlesRoot");
    const folderWatcher = watcherOn(lib, "*/lesson.json");
    expect(!!folderWatcher, `the lessons folder is watched too (got ${JSON.stringify(seen.watchers.filter((w) => !w.disposed).map((w) => [w.base, w.pattern]))})`);
    makeLesson("fresh", SAFE_RUN, "capsule-run-fresh");
    const folderInfos = seen.infos.length;
    const folderRefreshes = refreshes;
    fire(folderWatcher, "create", join(lib, "fresh", "lesson.json"));
    await sleep(900);
    expect(refreshes > folderRefreshes, "a lesson written into the lessons folder refreshes the list");
    expect(seen.infos.length === folderInfos, `and is never announced (got ${JSON.stringify(seen.infos.slice(folderInfos))})`);
    settings["bundlesRoot"] = emptyRoot;
    fireConfig("studium.bundlesRoot");
    expect(!!folderWatcher?.disposed && !!watcherOn(emptyRoot, "*/lesson.json"), "changing studium.bundlesRoot moves that watcher");
    settings["bundlesRoot"] = libraryRoot;
    fireConfig("studium.bundlesRoot");
    expect(seen.watchers.filter((w) => !w.disposed && w.pattern === "*/lesson.json" && sameFolder(w.base, libraryRoot)).length === 1
      && !watcherOn(emptyRoot, "*/lesson.json"), "a lessons folder that is the library gets no second watcher");

    // BN-3: the picker of an empty lessons folder says where the learner's lesson will come from (it used to fall back to
    // « Choose a course to open » whenever the demo was listed); with courses it asks to choose.
    settings["bundlesRoot"] = emptyRoot;
    quickPickAnswer = () => undefined;
    await seen.commands.get("studium.pickLesson")!();
    const emptyPlaceholder = seen.quickPickOptions.at(-1)?.placeHolder;
    expect([phrase("picker_empty_demo", {}, "fr"), phrase("picker_empty_demo", {}, "en")].includes(emptyPlaceholder),
      `no course in the folder: the picker says a lesson the assistant writes appears here, and to try the demo meanwhile (got ${emptyPlaceholder})`);
    settings["bundlesRoot"] = lib;
    await seen.commands.get("studium.pickLesson")!();
    const fullPlaceholder = seen.quickPickOptions.at(-1)?.placeHolder;
    expect([phrase("picker_choose", {}, "fr"), phrase("picker_choose", {}, "en")].includes(fullPlaceholder), `with courses, it asks to choose one (got ${fullPlaceholder})`);
    fireConfig("studium.bundlesRoot");
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
