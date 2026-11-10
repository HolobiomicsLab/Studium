// Panel audit 2026-11-10: what every adapter of the panel must carry (C3, A1), and the notice of a
// question that has already gone to the conversation (A9).
import { describe, it, expect, vi } from "vitest";
import { applyPanelAction, PanelActionSchema, PANEL_ACTION_TYPES, type PanelContext } from "./index.js";
import { phrase } from "./phrases.js";

describe("the actions an adapter must transport", () => {
  it("are exactly the action types the schema reads, each once", () => {
    const fromSchema = PanelActionSchema.options.map((option) => option.shape.type.value);
    expect([...PANEL_ACTION_TYPES].sort()).toEqual([...fromSchema].sort());
    expect(new Set(PANEL_ACTION_TYPES).size).toBe(PANEL_ACTION_TYPES.length);
    expect(Object.isFrozen(PANEL_ACTION_TYPES)).toBe(true);
  });
});

describe("ask", () => {
  const ctx = (): PanelContext => ({ sessionId: "s1", learnerId: "ana", bundleRef: "b", lessonTitle: "Leçon", conceptTitles: {} });
  const backend = () => ({
    getCurrentScene: vi.fn(async () => ({ scene: { id: "q", type: "concept", title: "Q", markdown: "x" }, index: 1, total: 2, locale: "fr" })),
    getSceneArtifacts: vi.fn(async () => []), getSessionState: vi.fn(async () => ({ concept_states: {}, history: [] })),
  });

  it("with the learner's words, says the question has gone to the conversation", async () => {
    const view = await applyPanelAction(backend() as never, ctx(), { type: "ask", text: "Pourquoi ?" });
    expect(view.message).toBe(phrase("panel_ask_sent_notice", {}, "fr"));
  });

  it("without words, sends the learner to the conversation", async () => {
    const view = await applyPanelAction(backend() as never, ctx(), { type: "ask" });
    expect(view.message).toBe(phrase("panel_ask_notice", {}, "fr"));
  });
});
