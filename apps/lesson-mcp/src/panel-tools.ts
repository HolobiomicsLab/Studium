// MCP adapter for the pure panel presenter; sessions remain owned by SessionHost.
import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SessionHost, ResponseInputSchema, publicPresentation, publicTransition, loadResolvedBundle,
  orientationOf, statusLine, voicesOf, helpOf,
} from "@studium/lesson-session-host";
import { scanCatalog } from "../../../packages/lesson-session-host/src/lesson-catalog.js";
import { reviewContext } from "../../../packages/lesson-panel/src/pane-messages.js";
import {
  presentPanel, applyPanelAction, PanelActionSchema, ClientMsSchema, type PanelBackend, type PanelContext, type PanelView, type Payload, type Surface,
} from "../../../packages/lesson-panel/src/index.js";
import * as imageAssets from "../../studium-vscode/src/asset-path.js";
import type { ToolResult } from "./operations.js";

import { lessonHtml, graphHtml } from "../../lesson-panel-ui/dist/resources.js";

export const PANEL_TOOL_NAMES = ["open_lesson_panel", "get_panel_view", "panel_action"] as const;

// The extension is CJS; source tsx and bundled builds expose it differently.
const { inlineImageAsset } = (Reflect.get(imageAssets, "default") as typeof imageAssets | undefined) ?? imageAssets;

/** Adapt the existing host operations; disk access stays outside lesson-panel. */
export function hostBackend(host: SessionHost, bundlesRoot: string): PanelBackend {
  return {
    getCurrentScene: async id => publicPresentation(host.currentPresentation(id)),
    getSceneArtifacts: async id => host.sceneArtifacts(id),
    getSessionState: async id => host.getState(id),
    // A panel, a pane and a form are the fast lane: the companion brief says so (companion.ts).
    submitResponse: async (id, input) => publicTransition(await host.respond(id, ResponseInputSchema.parse(input), "fast")),
    submitTurn: async (id, text) => {
      await host.submitTurn(id, text);
      return { reasoning: host.lastReasoning(id), tutor: host.lastTutorMove(id) };
    },
    requestHint: async id => host.requestHint(id, "fast"),
    rateRecall: (id, sceneId, grade) => host.rateRecall(id, sceneId, grade, "fast"),
    startReviewSession: async learnerId => {
      const r = await host.startReview(learnerId);
      return r.status === "nothing_due" ? r : { ...r, session_id: r.sessionId, presentation: publicPresentation(r.presentation) };
    },
    startLessonSession: async (bundleRef, learnerId) => {
      const r = await host.create(bundleRef, learnerId);
      return { ...r, session_id: r.sessionId, presentation: publicPresentation(r.presentation) };
    },
    forgetSession: id => host.forget(id),
    getNextReinforcement: id => host.reinforcementStatusForSession(id),
    setSessionLanguage: async (id, language) => host.setPresentationLanguage(id, language),
    // The map view reads the exportable record (INT-STUDIUM-058 § 2.7), never get_workflow_graph.
    getConceptMapRecord: async id => host.conceptMapRecord(id),
    // A contest made on a panel, a pane or a form is an act of the fast lane.
    contestConcept: async (id, conceptId, claim) => ({ questions: (await host.contest(id, conceptId, claim, "fast")).questions }),
    // INT-STUDIUM-058 § 2.6: the session's book decides what is proposed; forms are « available » when
    // the client can show them and the lesson is not played in them.
    getPrompts: async (id, ask) => host.sessionPrompts(id, {
      locale: ask.locale, attention: ask.attention, surfaceRank: ask.surface.rank, formsAvailable: ask.surface.available.includes("form"),
    }),
    settlePrompt: async (id, promptId, outcome) => ({ kind: host.settlePrompt(id, promptId, outcome).kind }),
    getOrientation: async (id, ask) => {
      const orientation = orientationOf(host, id);
      const assessed = ask.verdict?.assessed_by;
      return {
        orientation, status_line: statusLine(orientation, ask.lessonTitle, ask.locale),
        voices: voicesOf(host, id, assessed === "key" || assessed === "judge" ? { assessed_by: assessed } : null),
        help: helpOf(host, id, ask.locale),
      };
    },
    inlineImage: async (asset, bundleRef) => {
      if (!asset.path || (asset.kind !== "image" && asset.kind !== "executed_result")) return asset;
      try {
        const roots = [bundlesRoot, ...(host.libraryRoot ? [host.libraryRoot] : [])];
        const resolved = await loadResolvedBundle(roots, bundleRef);
        return resolved.baseDir ? inlineImageAsset(resolved.root, resolved.path, asset) : asset;
      } catch { return asset; }
    },
  };
}

type SurfaceKind = Surface["kind"];
const SURFACE_KINDS = ["text", "form", "pane", "panel"] as const satisfies readonly SurfaceKind[];
const SURFACE_RANK: Record<SurfaceKind, Surface["rank"]> = { panel: 3, pane: 3, form: 2, text: 1 };

/** INT-STUDIUM-058 § 2.4, the surface ladder. What the client declared says which surfaces exist: an
 * MCP Apps panel (rank 3), forms (rank 2), the conversation (rank 1, always). A native pane cannot be
 * detected, so its adapter says so by asking for it. `asked` is the adapter's or the learner's choice;
 * one the client cannot render falls to the best surface below it. */
export function negotiateSurface(client: { ui: boolean; forms: boolean }, asked?: SurfaceKind): Surface {
  const available: SurfaceKind[] = [
    "text", ...(client.forms ? ["form" as const] : []), ...(client.ui ? ["panel" as const] : []), ...(asked === "pane" ? ["pane" as const] : []),
  ];
  const best = (ceiling: number): SurfaceKind =>
    available.filter(kind => SURFACE_RANK[kind] <= ceiling).sort((a, b) => SURFACE_RANK[b] - SURFACE_RANK[a])[0] ?? "text";
  const kind = asked === undefined ? best(3) : available.includes(asked) ? asked : best(SURFACE_RANK[asked]);
  return { rank: SURFACE_RANK[kind], kind, available };
}

/** Below a panel nothing on screen takes the learner's actions: one line tells the model how the
 * lesson goes on. */
const CONTINUE_ON: Record<1 | 2, string> = {
  2: "Surface: forms. Call play_in_forms with this session_id: the learner reads and answers in forms, without a model turn.",
  1: "Surface: conversation. Show the learner the display_markdown of get_current_scene as it is, and send their own reply with submit_response.",
};

/** The view as its reader needs it. A panel or a pane draws it and takes its labels from `strings`,
 * the interface's phrase catalogue (some 24 kB). Below a panel nothing draws the view: its reader is
 * a model, and the catalogue is left out. */
function forSurface(panel: PanelView): PanelView {
  const rank = panel.surface?.rank;
  return rank === 1 || rank === 2 ? { ...panel, strings: {} } : panel;
}

function panelResult(view: PanelView) {
  const panel = forSurface(view);
  const stem = panel.scene?.question ?? panel.scene?.prompt ?? panel.scene?.title ?? panel.message ?? "";
  const rank = panel.kind === "scene" ? panel.surface?.rank : undefined;
  const summary = [
    `${panel.lesson_title} — ${panel.progress.index}/${panel.progress.total}`, stem, `Actions: ${panel.actions.join(", ")}`,
    ...(rank === 1 || rank === 2 ? [CONTINUE_ON[rank]] : []),
  ].join("\n");
  return {
    structuredContent: { panel },
    content: [{ type: "text" as const, text: JSON.stringify({ panel }) }, { type: "text" as const, text: summary }],
  };
}

function toolError(error: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }], isError: true as const };
}

/** Per-server contexts retain earned feedback, including transitions from the native run protocol. */
class Panels {
  readonly contexts = new Map<string, PanelContext>();
  readonly busy = new Set<PanelContext>();
  readonly backend: PanelBackend;
  /** `client` reads what the connected client declared it can render (see negotiateSurface). */
  constructor(readonly host: SessionHost, private readonly client: () => { ui: boolean; forms: boolean }) {
    this.backend = hostBackend(host, host.bundlesRoot);
  }

  /** The session's panel context. Its surface is negotiated when the context is created, and again
   * whenever a call asks for one (`options.surface`). */
  async context(id: string, options: Payload = {}): Promise<PanelContext> {
    const state = this.host.getState(id); // Validate liveness even for a cached view.
    const existing = this.contexts.get(id);
    if (existing) {
      if (options.surface !== undefined) existing.surface = negotiateSurface(this.client(), options.surface);
      return existing;
    }
    const roots = [this.host.bundlesRoot, ...(this.host.libraryRoot ? [this.host.libraryRoot] : [])];
    const catalog = options.bundle_ref ? null : await scanCatalog(roots.map(dir => ({ dir, kind: "bundles" })));
    const ref = options.bundle_ref ?? catalog?.lessons.find(l => l.bundle_id === state.lesson_id)?.bundle_ref ?? "";
    const resolved = ref ? await loadResolvedBundle(roots, ref) : null;
    const ctx: PanelContext = {
      sessionId: id, learnerId: options.learner_id ?? this.host.defaultLearnerId,
      bundleRef: ref, lessonTitle: resolved?.bundle.metadata.title ?? state.lesson_id,
      conceptTitles: Object.fromEntries((resolved?.bundle.concepts ?? []).map(c => [c.id, c.title])),
      surface: negotiateSurface(this.client(), options.surface),
    };
    this.contexts.set(id, ctx);
    return ctx;
  }

  async open(options: Payload): Promise<PanelView> {
    if (!options.session_id && !options.bundle_ref) throw new Error("pass bundle_ref or session_id");
    const started = options.session_id ? null : await this.backend.startLessonSession(options.bundle_ref, options.learner_id ?? this.host.defaultLearnerId);
    const ctx = await this.context(options.session_id ?? started!.session_id, options);
    if (options.show_mastery !== undefined) ctx.showMastery = options.show_mastery;
    if (options.modality_preference !== undefined) ctx.modalityPreference = options.modality_preference;
    if (options.locale !== undefined) ctx.locale = options.locale;
    if (options.attention !== undefined) ctx.attention = options.attention;
    return presentPanel(this.backend, ctx);
  }

  async act(id: string, action: z.infer<typeof PanelActionSchema>): Promise<PanelView> {
    const ctx = await this.context(id);
    if (this.busy.has(ctx)) throw new Error("a panel action is already in progress");
    this.busy.add(ctx);
    try {
      const view = await applyPanelAction(this.backend, ctx, action);
      if (ctx.sessionId !== id || (action.type === "end" && action.confirmed)) this.contexts.delete(id);
      if (!(action.type === "end" && action.confirmed)) this.contexts.set(ctx.sessionId, ctx);
      return view;
    } finally { this.busy.delete(ctx); }
  }

  async observe(name: string, args: Payload, result: ToolResult): Promise<void> {
    if (result.isError) return;
    const reply = JSON.parse(result.content[0]?.text ?? "{}");
    if (name === "start_lesson_session" || (name === "start_review_session" && reply.status === "started")) {
      const started = await this.context(reply.session_id, args);
      if (reply.review) started.review = reviewContext(reply);
    }
    const ctx = this.contexts.get(args.session_id);
    if (ctx && reply.transition) { ctx.transition = reply.transition; delete ctx.effects; }
    if (name === "forget_session" || name === "end_session") {
      this.contexts.delete(args.session_id);
      if (args.learner_id) for (const [id, context] of this.contexts) {
        if (context.learnerId === args.learner_id) this.contexts.delete(id);
      }
    }
  }
}

const UI_EXTENSION = "io.modelcontextprotocol/ui";
const UI_MIME = "text/html;profile=mcp-app";
const UI_META = { ui: { csp: { resourceDomains: ["https://cdn.jsdelivr.net"] }, prefersBorder: true } };

/** Advertise resources only to clients that negotiated the MCP Apps extension. */
function registerPanelUi(server: McpServer) {
  const tools = new Map<string, RegisteredTool>();
  const supportsUi = () => Boolean(server.server.getClientCapabilities()?.extensions?.[UI_EXTENSION]);
  const resources = [["lesson", lessonHtml], ["graph", graphHtml]].map(([kind, html]) => {
    const uri = `ui://studium/${kind}-panel.html`;
    const resource = server.registerResource(`studium-${kind}-panel`, uri, { mimeType: UI_MIME, _meta: UI_META }, async () => {
      if (!supportsUi()) throw new Error("MCP Apps capability was not negotiated");
      return { contents: [{ uri, mimeType: UI_MIME, text: html!, _meta: UI_META }] };
    });
    resource.disable();
    return resource;
  });
  const previous = server.server.oninitialized;
  server.server.oninitialized = () => {
    previous?.();
    if (!supportsUi()) return;
    for (const resource of resources) resource.enable();
    for (const [name, tool] of tools) {
      const kind = name === "get_workflow_graph" ? "graph" : "lesson";
      tool.update({ _meta: { ui: { resourceUri: `ui://studium/${kind}-panel.html` } } });
    }
  };
  return (name: string, tool: RegisteredTool) => {
    if (name === "get_workflow_graph" || (PANEL_TOOL_NAMES as readonly string[]).includes(name)) tools.set(name, tool);
  };
}

/** Register panel actions and negotiate optional resources without changing legacy replies. */
export function registerPanelTools(server: McpServer, host: SessionHost) {
  const panels = new Panels(host, () => {
    const declared = server.server.getClientCapabilities();
    return { ui: Boolean(declared?.extensions?.[UI_EXTENSION]), forms: Boolean(declared?.elicitation) };
  });
  const attachTool = registerPanelUi(server);
  const session = { session_id: z.string().min(1) };
  const surface = z.enum(SURFACE_KINDS).optional()
    .describe("The surface to play on. Omit it: the server picks the best one this client renders. \"pane\" is for a native pane adapter; \"text\" when the learner prefers the conversation.");
  const openTool = server.registerTool("open_lesson_panel", {
    description: "Open or resume a lesson by bundle_ref or existing session_id, on the best surface this client renders (a panel, forms, or the conversation). Returns a public PanelView whose `surface` says which, and a short summary that says how to continue; wait for the learner's own actions. Below a panel the view's `strings` (the interface's labels) is empty: nothing draws it.",
    inputSchema: {
      bundle_ref: z.string().min(1).optional(), session_id: z.string().min(1).optional(), learner_id: z.string().min(1).optional(),
      show_mastery: z.boolean().optional(), modality_preference: z.enum(["balanced", "visual", "textual"]).optional(), locale: z.enum(["fr", "en"]).optional(),
      surface,
      attention: z.enum(["quiet", "normal", "coached"]).optional().describe("How much the session may propose: nothing, the default, or more."),
    },
  }, async args => { try { return panelResult(await panels.open(args)); } catch (e) { return toolError(e); } });
  const getTool = server.registerTool("get_panel_view", {
    description: "Read the current public lesson panel, including earned feedback and completion.", inputSchema: { ...session, surface },
  }, async ({ session_id, surface: asked }) => {
    try {
      return panelResult(await presentPanel(panels.backend, await panels.context(session_id, asked === undefined ? {} : { surface: asked })));
    } catch (e) { return toolError(e); }
  });
  const actionTool = server.registerTool("panel_action", {
    description: "Apply the learner's own panel action. end erases progress only with confirmed:true; pickCourse asks the host to open its course picker; ask hands over to the conversation and leaves the scene as it is; setLanguage, setAttention and replan change how the lesson is shown, never an answer; openMap adds the concept map to the view (map: each concept's state, the answers behind it with their day, who assessed them and the hints taken, what the state establishes and what it does not) until closeMap, from forms upwards and for a lesson, not a review session; contest {concept_id, claim} is the learner's own declaration on a concept of the open map, known for a concept not acquired, unsure for an acquired one: the claim changes no mastery and skips no scene, the lesson asks check questions on that concept (two, or one when it has a single key-graded scene on it, the outcome then being partial), graded as any answer, then resumes where the learner was; a contest the state does not take, or made while another is under way, is refused in one line. Never contest for the learner. prompt {id, outcome} is the learner's answer to a proposal of the view (prompts: a review that is due, a break, the map, forms): accept does what it said, dismiss keeps the scene, and the server keeps the outcome; it proposes nothing while an answer is owed and no more than the attention level allows. Never answer a prompt for the learner, and add no proposal of your own during a session. client_ms, optional, is the delay in milliseconds between the learner's previous action and its display, as the surface measured it.",
    // client_ms is validated here and read by nothing yet: the interaction log (INT-STUDIUM-058, lot 7)
    // records it under consent. Surfaces send it from now on, so they need no change then.
    inputSchema: { ...session, action: PanelActionSchema, client_ms: ClientMsSchema.optional() },
  }, async ({ session_id, action }) => {
    try { return panelResult(await panels.act(session_id, action)); } catch (e) { return toolError(e); }
  });
  attachTool("open_lesson_panel", openTool);
  attachTool("get_panel_view", getTool);
  attachTool("panel_action", actionTool);
  return {
    attachTool,
    names: PANEL_TOOL_NAMES,
    observe: async (name: string, args: Payload, result: ToolResult) => {
      try { await panels.observe(name, args, result); }
      catch { /* Panel bookkeeping must not change legacy replies. */ }
    },
  };
}
