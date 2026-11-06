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

  test("turns pick-course into localized, actionable native help", async () => {
    const host = new Host({ ...PANEL, actions: ["pickCourse"] });
    const tree = await hook("ui.render")(host.engine, PANE_EVENT, event => event) as PortableElement;
    const button = find(tree, element => element.key === "pickCourse");
    (button?.props.onPress as () => void)();
    expect(host.toasts).toEqual(["Ouvre une autre leçon avec /studium <bundle_ref>."]);
    expect(host.calls).toEqual([]);
  });
});
