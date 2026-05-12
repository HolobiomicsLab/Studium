/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import QuizScene from "./QuizScene";
import type { Scene } from "@studium/lesson-bundle-schema";

afterEach(cleanup);

const baseScene: Extract<Scene, { type: "quiz" }> = {
  id: "s_quiz",
  type: "quiz",
  title: "Question pH",
  objective_refs: [],
  concept_refs: ["c_ph"],
  estimated_seconds: 60,
  adaptation_hooks: [],
  question: "Quelle est la valeur normale du pH sanguin ?",
  choices: [
    { id: "a", text: "6.5", correct: false },
    { id: "b", text: "7.4", correct: true },
    { id: "c", text: "8.0", correct: false },
  ],
  feedback_correct: "Exact !",
  feedback_incorrect: "Pas tout à fait.",
  hints: [],
};

describe("QuizScene telemetry", () => {
  it("emits quiz_answered with correct=true on submit when correct choice selected", async () => {
    const emit = vi.fn();
    render(
      <QuizScene
        scene={baseScene}
        onSignal={vi.fn().mockResolvedValue(undefined)}
        onContinue={vi.fn()}
        emit={emit}
      />,
    );
    fireEvent.click(screen.getByLabelText(/7\.4/));
    fireEvent.click(screen.getByRole("button", { name: /soumettre/i }));
    await Promise.resolve();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "quiz_answered",
        scene_id: "s_quiz",
        correct: true,
      }),
    );
    const call = emit.mock.calls.find((c) => c[0].type === "quiz_answered");
    expect(call![0]).toEqual(
      expect.objectContaining({
        type: "quiz_answered",
        scene_id: "s_quiz",
        item_id: "b",
        correct: true,
        response_time_ms: expect.any(Number),
        confidence: expect.any(Number),
      }),
    );
  });

  it("emits quiz_answered with correct=false when incorrect choice selected", async () => {
    const emit = vi.fn();
    render(
      <QuizScene
        scene={baseScene}
        onSignal={vi.fn().mockResolvedValue(undefined)}
        onContinue={vi.fn()}
        emit={emit}
      />,
    );
    fireEvent.click(screen.getByLabelText(/6\.5/));
    fireEvent.click(screen.getByRole("button", { name: /soumettre/i }));
    await Promise.resolve();
    const call = emit.mock.calls.find((c) => c[0].type === "quiz_answered");
    expect(call![0].correct).toBe(false);
    expect(call![0].item_id).toBe("a");
  });

  it("does not throw when emit prop is not provided", async () => {
    render(
      <QuizScene
        scene={baseScene}
        onSignal={vi.fn().mockResolvedValue(undefined)}
        onContinue={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/7\.4/));
    fireEvent.click(screen.getByRole("button", { name: /soumettre/i }));
    await Promise.resolve();
    expect(screen.getByText(/exact/i)).toBeTruthy();
  });
});
