import type { EngineInterface, Register } from "claude-code";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { StudiumPanelView } from "../types/index.js";
import { register } from "./register.js";

type PortableNode = PortableElement | string;
type PortableElement = {
  type: string;
  key?: string;
  props: Record<string, unknown>;
  children: PortableNode[];
};
type HookHandler = (
  engine: EngineInterface,
  event: Record<string, unknown>,
  next: (event: Record<string, unknown>) => unknown,
) => unknown;

const PANEL: StudiumPanelView = {
  schema: "studium/panel-view/1",
  kind: "scene",
  session_id: "session-1",
  learner_id: "learner-1",
  bundle_ref: "atomistique-l1/lesson.json",
  lesson_title: "Atomistique",
  locale: "fr",
  strings: { pane_hint: "Indice" },
  progress: { index: 2, total: 9 },
  scene: {
    id: "s1-quiz-fer",
    type: "quiz",
    question: "Combien contient-il de neutrons ?",
    choices: [{ id: "a", text: "26" }, { id: "b", text: "30" }],
  },
  scene_assets: [],
  modalityPreference: "balanced",
  reviewDue: [],
  calibration: [],
  mastery: {},
  actions: ["respond", "hint", "end"],
};

const PANE_EVENT = {
  plugin: "studium-panel",
  component: "Pane",
  requestId: "studium",
  surface: "desktop",
  props: {
    title: "Studium",
    isFocused: false,
    bodyColumns: 60,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
};

function element(type: string) {
  return (props: Record<string, unknown>): PortableElement => ({
    type,
    key: typeof props.key === "string" ? props.key : undefined,
    props,
    children: Array.isArray(props.children) ? props.children as PortableNode[] : [],
  });
}

function find(root: PortableNode | PortableNode[], predicate: (element: PortableElement) => boolean): PortableElement | undefined {
  if (Array.isArray(root)) {
    for (const child of root) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof root === "string") return undefined;
  if (predicate(root)) return root;
  return find(root.children, predicate);
}

function response(panel: StudiumPanelView = PANEL) {
  return { structuredContent: { panel } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

class Host {
  readonly calls: Array<{ server: string; tool: string; args: unknown }> = [];
  readonly opens: unknown[] = [];
  readonly toasts: string[] = [];
  readonly commands: unknown[] = [];
  readonly results: Array<Promise<unknown>> = [];
  readonly state = new Map<string, { value: unknown; version: number }>();
  readonly engine: EngineInterface;

  constructor(panel?: StudiumPanelView) {
    if (panel) this.state.set("studium-panel.panel", {
      value: { shape: "panel-view-1", value: panel },
      version: 1,
    });
    const table = {
      Box: element("Box"), Button: element("Button"), Markdown: element("Markdown"), Text: element("Text"),
    };
    this.engine = {
      command: {
        register: async (input: { name: string }) => { this.commands.push(input); return { command: input.name }; },
      },
      mcp: {
        call: async (server: string, tool: string, args: unknown) => {
          this.calls.push({ server, tool, args });
          const result = this.results.shift();
          if (!result) throw new Error("No portable MCP response queued");
          return result;
        },
      },
      state: {
        get: async (ref: { plugin: string; key: string }) => this.state.get(`${ref.plugin}.${ref.key}`) ?? { value: undefined, version: 0 },
        set: async (ref: { plugin: string; key: string }, value: unknown) => {
          const key = `${ref.plugin}.${ref.key}`;
          const version = (this.state.get(key)?.version ?? 0) + 1;
          this.state.set(key, { value, version });
          return { set: true, version };
        },
      },
      ui: {
        open: async (input: unknown) => { this.opens.push(input); return { isPlaced: true }; },
        toast: (message: string) => { this.toasts.push(message); },
        resolve: () => table,
      },
    } as unknown as EngineInterface;
  }

  queue(result: unknown | Promise<unknown>): void {
    this.results.push(Promise.resolve(result));
  }

  value<T>(key: "panel" | "endConfirmation" | "deckFlags"): T {
    const shaped = this.state.get(`studium-panel.${key}`)?.value as { value: T } | undefined;
    if (!shaped) throw new Error(`Missing state ${key}`);
    return shaped.value;
  }
}

function captureHooks() {
  const hooks = new Map<string, HookHandler>();
  const on = ((event: string, matcherOrHandler: unknown, handler?: unknown) => {
    const candidate = typeof matcherOrHandler === "function" ? matcherOrHandler : handler;
    hooks.set(event, candidate as HookHandler);
  }) as Parameters<Register>[0];
  register(on, {});
  return (event: string): HookHandler => {
    const hook = hooks.get(event);
    if (!hook) throw new Error(`Missing hook ${event}`);
    return hook;
  };
}

describe("portable Claude host boundary", () => {
  let hook: ReturnType<typeof captureHooks>;

  beforeEach(() => {
    hook = captureHooks();
  });

  test("registers /studium without opening a pane at session start", async () => {
    const host = new Host();
    await hook("session.start")(host.engine, {}, event => event);
    expect(host.commands).toEqual([expect.objectContaining({ name: "studium" })]);
    expect(host.opens).toEqual([]);
  });

  test("returns actionable usage instead of opening without a bundle", async () => {
    const host = new Host();
    expect(await hook("command.run")(host.engine, { args: "" }, event => event)).toEqual({
      text: "No active Studium lesson. Open one with /studium <bundle_ref>.",
      exitCode: 1,
    });
    expect(host.calls).toEqual([]);
  });

  test("opens a bundle, renders it, shows pending state, and sends a quiz action", async () => {
    const host = new Host();
    host.queue(response());
    const commandResult = await hook("command.run")(host.engine, { args: PANEL.bundle_ref }, event => event);
    expect(commandResult).toEqual({ text: "Opened Studium — Atomistique." });
    // INT-STUDIUM-058 § 2.4: a native pane cannot be detected by the server, so the adapter says so.
    expect(host.calls[0]).toEqual({ server: "studium-lesson", tool: "open_lesson_panel", args: { bundle_ref: PANEL.bundle_ref, surface: "pane" } });
    expect(host.opens).toEqual([{ id: "studium", title: "Atomistique" }]);

    const tree = await hook("ui.render")(host.engine, PANE_EVENT, event => event) as PortableElement;
    const choice = find(tree, element => element.key === "choice-b");
    expect(choice).toBeDefined();
    const onPress = choice?.props.onPress as (() => Promise<void>) | undefined;
    expect(onPress).toBeTypeOf("function");

    const reply = deferred<unknown>();
    host.queue(reply.promise);
    const pressing = onPress!();
    await vi.waitFor(() => expect(host.calls).toHaveLength(2));
    expect(host.value<StudiumPanelView>("panel").pending).toBe("Envoi de ta réponse…");
    const pendingTree = await hook("ui.render")(host.engine, PANE_EVENT, event => event) as PortableElement;
    expect(find(pendingTree, element => element.type === "Text" && element.props.size === "title")?.props.dimColor).toBe(true);

    reply.resolve(response());
    await pressing;
    expect(host.calls[1]).toEqual({
      server: "studium-lesson",
      tool: "panel_action",
      args: { session_id: "session-1", action: { type: "respond", input: { kind: "quiz_choice", choiceId: "b" } } },
    });
    expect(host.value<StudiumPanelView>("panel").pending).toBeUndefined();
  });

  test("requires two separate end actions before confirmed erasure", async () => {
    const host = new Host(PANEL);
    host.queue(response());
    let tree = await hook("ui.render")(host.engine, PANE_EVENT, event => event) as PortableElement;
    let button = find(tree, element => element.key === "end");
    await (button?.props.onPress as () => Promise<void>)();
    expect((host.calls[0]?.args as { action: unknown }).action).toEqual({ type: "end", confirmed: false });
    expect(host.value<boolean>("endConfirmation")).toBe(true);

    host.queue(response());
    tree = await hook("ui.render")(host.engine, PANE_EVENT, event => event) as PortableElement;
    button = find(tree, element => element.key === "end");
    await (button?.props.onPress as () => Promise<void>)();
    expect((host.calls[1]?.args as { action: unknown }).action).toEqual({ type: "end", confirmed: true });
  });

  test("reports an answer failure after exposing it in the pane", async () => {
    const host = new Host(PANEL);
    const failed = deferred<unknown>();
    host.queue(failed.promise);
    const running = hook("command.run")(host.engine, { args: "answer b" }, event => event);
    await vi.waitFor(() => expect(host.calls).toHaveLength(1));
    failed.reject(new Error("server offline"));
    await expect(running).resolves.toEqual({
      text: "Studium did not send the answer: server offline.",
      exitCode: 1,
    });
    expect(host.value<StudiumPanelView>("panel"))
      .toMatchObject({ kind: "error", message: "server offline", pending: undefined });
  });

  // Walkthrough 2026-11-07: an answer on a session the server lost leaves the notice in the pane; its button opens the
  // same lesson for the same learner, once, and only when pressed.
  test("a lost session: the notice replaces the scene, and « Rouvrir la leçon » opens the same lesson again", async () => {
    const host = new Host(PANEL);
    host.queue({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: "session not found: session-1 (the server may have restarted, or the session was closed): call start_lesson_session…" }) }] });
    await hook("command.run")(host.engine, { args: "answer b" }, event => event);
    expect(host.calls).toHaveLength(1);
    const tree = await hook("ui.render")(host.engine, PANE_EVENT, event => event) as PortableElement;
    const shown = texts(tree).join("\n");
    expect(shown).toContain("Séance perdue (le serveur a redémarré ou la séance a été fermée).");
    expect(shown).toContain("/studium atomistique-l1/lesson.json");
    expect(find(tree, element => element.key === "choice-b")).toBeUndefined();
    expect(host.calls).toHaveLength(1); // nothing retried on its own
    host.queue(response({ ...PANEL, session_id: "session-2" }));
    await (find(tree, element => element.key === "reopen")?.props.onPress as () => Promise<void>)();
    expect(host.calls[1]).toEqual({ server: "studium-lesson", tool: "open_lesson_panel",
      args: { bundle_ref: "atomistique-l1/lesson.json", learner_id: "learner-1", surface: "pane" } });
    expect(host.value<StudiumPanelView>("panel")).toMatchObject({ kind: "scene", session_id: "session-2" });
  });

  // INT-STUDIUM-058, task 2.5: status line, voices, help ladder and the ask gesture of a version-2 view.
  const V2: StudiumPanelView = {
    ...PANEL, schema: "studium/panel-view/2",
    actions: ["respond", "hint", "end", "ask"],
    orientation: { step: { index: 2, total: 9 }, reviews_due: 0, waiting: "answer" },
    status_line: "Atomistique · étape 2/9 · 12 min · à toi de répondre",
    voices: { scene: { kind: "author", name: "Prof. Test", reviewed: true, drafted_by: "teacher" }, verdict: { kind: "key" } },
    verdict: { scene_id: "s0", graded: true, feedback: "Bien vu." },
    help: { rungs: [
      { kind: "reread", available: true },
      { kind: "hint", available: true, cost: "un indice réduit le crédit de cette réponse" },
      { kind: "explain", available: false, why_not: "essaie d'abord de répondre" },
      { kind: "reference", available: false, why_not: "la référence s'affiche après ta réponse" },
    ] },
    prompts: [], attention: "normal", surface: { rank: 3, kind: "pane", available: ["text", "pane"] },
  };
  const texts = (node: PortableNode | PortableNode[]): string[] => {
    if (Array.isArray(node)) return node.flatMap(texts);
    if (typeof node === "string") return [node];
    const own = typeof node.props.children === "string" ? [node.props.children] : [];
    const markdown = typeof node.props.text === "string" ? [node.props.text] : [];
    return [...own, ...markdown, ...texts(node.children)];
  };
  const label = (button: PortableElement | undefined): string => (button ? texts(button).join("") : "");

  test("a version-2 view: the status line leads, each block names its voice, the ladder shows every rung", async () => {
    const host = new Host(V2);
    const tree = await hook("ui.render")(host.engine, PANE_EVENT, event => event) as PortableElement;
    const shown = texts(tree);
    expect(shown[0]).toBe("Atomistique"); // the lesson's title
    expect(shown[1]).toBe("Atomistique · étape 2/9 · 12 min · à toi de répondre"); // then the status line
    expect(shown).not.toContain("Étape 2 sur 9"); // the step is said once
    expect(texts(find(tree, element => element.key === "voice-scene")!)).toEqual(["Leçon validée par Prof. Test"]);
    expect(texts(find(tree, element => element.key === "voice-verdict")!)).toEqual(["Évalué par la clé de l'auteur"]);
    // The scene's voice comes before the question, the verdict's before its feedback.
    expect(shown.indexOf("Leçon validée par Prof. Test")).toBeLessThan(shown.indexOf("Combien contient-il de neutrons ?"));
    expect(shown.indexOf("Évalué par la clé de l'auteur")).toBeLessThan(shown.indexOf("Bien vu."));

    expect(label(find(tree, element => element.key === "help-reread"))).toBe("Relire");
    expect(label(find(tree, element => element.key === "help-hint"))).toBe("Indice — un indice réduit le crédit de cette réponse");
    const explain = find(tree, element => element.key === "help-explain");
    expect(label(explain)).toBe("Explication — essaie d'abord de répondre");
    expect(explain?.props.dimColor).toBe(true); // closed: greyed, with its reason
    expect(find(tree, element => element.key === "help-hint")?.props.dimColor).toBe(false);
    expect(find(tree, element => element.key === "hint")).toBeUndefined(); // one hint control, in the ladder
    expect(label(find(tree, element => element.key === "ask"))).toBe("Poser une question");
  });

  test("a closed rung says why and sends nothing; an open hint and « Poser une question » send their action", async () => {
    const host = new Host(V2);
    let tree = await hook("ui.render")(host.engine, PANE_EVENT, event => event) as PortableElement;
    await (find(tree, element => element.key === "help-explain")?.props.onPress as () => unknown)();
    await (find(tree, element => element.key === "help-reread")?.props.onPress as () => unknown)();
    expect(host.toasts).toEqual(["essaie d'abord de répondre", "Le texte de cet écran est au-dessus."]);
    expect(host.calls).toEqual([]);

    host.queue(response(V2));
    await (find(tree, element => element.key === "help-hint")?.props.onPress as () => Promise<void>)();
    expect((host.calls[0]?.args as { action: unknown }).action).toEqual({ type: "hint" });

    host.queue(response({ ...V2, kind: "notice", message: "Pose ta question dans la conversation. La leçon t'attend ici, à la même étape." }));
    tree = await hook("ui.render")(host.engine, PANE_EVENT, event => event) as PortableElement;
    await (find(tree, element => element.key === "ask")?.props.onPress as () => Promise<void>)();
    expect(host.calls[1]).toEqual({ server: "studium-lesson", tool: "panel_action", args: { session_id: "session-1", action: { type: "ask" } } });
    const after = await hook("ui.render")(host.engine, PANE_EVENT, event => event) as PortableElement;
    expect(texts(after)).toContain("Pose ta question dans la conversation. La leçon t'attend ici, à la même étape.");
  });

  test("a version-1 view keeps its step line and its single hint button", async () => {
    const host = new Host(PANEL);
    const tree = await hook("ui.render")(host.engine, PANE_EVENT, event => event) as PortableElement;
    expect(texts(tree)[1]).toBe("Étape 2 sur 9");
    expect(find(tree, element => element.key === "hint")).toBeDefined();
    expect(find(tree, element => element.key === "help-hint")).toBeUndefined();
    expect(find(tree, element => element.key === "ask")).toBeUndefined();
  });

  test("turns pick-course into localized, actionable native help", async () => {
    const host = new Host({ ...PANEL, actions: ["pickCourse"] });
    const tree = await hook("ui.render")(host.engine, PANE_EVENT, event => event) as PortableElement;
    const button = find(tree, element => element.key === "pickCourse");
    (button?.props.onPress as () => void)();
    expect(host.toasts).toEqual(["Ouvre une autre leçon avec /studium <bundle_ref>."]);
    expect(host.calls).toEqual([]);
  });
});
