/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DiscussionScene from "./DiscussionScene";
import type { Scene } from "@studium/lesson-bundle-schema";

vi.mock("@studium/reasoning-scorer", () => ({
  classifyTurn: vi.fn(async () => ({ signal: "justification", confidence: 0.8 })),
}));

afterEach(cleanup);

const SCENE: Extract<Scene, { type: "discussion" }> = {
  id: "s_disc_1",
  type: "discussion",
  title: "Débat",
  objective_refs: [],
  concept_refs: [],
  estimated_seconds: 600,
  adaptation_hooks: [],
  topic: "Topic A",
  seed_claim: "Claim X",
  target_signals: ["justification", "counterexample"],
  max_turns: 3,
};

describe("DiscussionScene", () => {
  it("renders seed_claim and turn input", () => {
    const emit = vi.fn();
    render(<DiscussionScene scene={SCENE} emit={emit} onSignal={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.getByText(/Claim X/)).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("emits reasoning_signal when student submits a turn", async () => {
    const emit = vi.fn();
    render(<DiscussionScene scene={SCENE} emit={emit} onSignal={vi.fn()} onContinue={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Because X explains Y." } });
    fireEvent.click(screen.getByRole("button", { name: /envoyer/i }));
    await new Promise(r => setTimeout(r, 50));
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "reasoning_signal", scene_id: "s_disc_1" }),
    );
  });

  it("disables submit when max_turns reached", async () => {
    const emit = vi.fn();
    render(<DiscussionScene scene={{ ...SCENE, max_turns: 1 }} emit={emit} onSignal={vi.fn()} onContinue={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "turn 1" } });
    fireEvent.click(screen.getByRole("button", { name: /envoyer/i }));
    await new Promise(r => setTimeout(r, 50));
    const sendBtn = screen.getByRole("button", { name: /envoyer/i }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });
});
