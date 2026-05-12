/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ReproductionScene from "./ReproductionScene";
import type { Scene } from "@studium/lesson-bundle-schema";

afterEach(cleanup);

const baseScene: Extract<Scene, { type: "reproduction" }> = {
  id: "s_repro",
  type: "reproduction",
  title: "Mesure de pH",
  objective_refs: [],
  concept_refs: ["c_ph"],
  estimated_seconds: 120,
  adaptation_hooks: [],
  task_card_id: "task_001",
  steps: [
    {
      step_id: "1",
      instruction: "Saisir la valeur de pH mesurée",
      expected_input_schema: { type: "number" },
      expected_output: "7.4",
    },
    {
      step_id: "2",
      instruction: "Saisir la température",
      expected_input_schema: { type: "number" },
      expected_output: "25",
    },
  ],
};

describe("ReproductionScene", () => {
  it("affiche le titre, le task_card_id et chaque consigne", () => {
    render(<ReproductionScene scene={baseScene} onSignal={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /mesure de ph/i })).toBeTruthy();
    expect(screen.getByText(/task_001/)).toBeTruthy();
    expect(screen.getByText(/saisir la valeur de ph/i)).toBeTruthy();
    expect(screen.getByText(/saisir la température/i)).toBeTruthy();
  });

  it("émet scene_entered au montage", async () => {
    const onSignal = vi.fn().mockResolvedValue(undefined);
    render(<ReproductionScene scene={baseScene} onSignal={onSignal} onContinue={vi.fn()} />);
    await Promise.resolve();
    expect(onSignal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "scene_entered", scene_id: "s_repro" }),
    );
  });

  it("émet answer_submitted correct=true quand toutes les étapes correspondent", async () => {
    const onSignal = vi.fn().mockResolvedValue(undefined);
    render(<ReproductionScene scene={baseScene} onSignal={onSignal} onContinue={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("étape 1"), { target: { value: "7.4" } });
    fireEvent.change(screen.getByLabelText("étape 2"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /valider/i }));
    await Promise.resolve();
    const answer = onSignal.mock.calls.find((c) => c[0].kind === "answer_submitted");
    expect(answer).toBeTruthy();
    expect(answer![0]).toMatchObject({
      kind: "answer_submitted",
      concept_id: "c_ph",
      scene_id: "s_repro",
      correct: true,
    });
  });

  it("émet answer_submitted correct=false et liste les étapes ratées", async () => {
    const onSignal = vi.fn().mockResolvedValue(undefined);
    render(<ReproductionScene scene={baseScene} onSignal={onSignal} onContinue={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("étape 1"), { target: { value: "9.9" } });
    fireEvent.change(screen.getByLabelText("étape 2"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /valider/i }));
    await Promise.resolve();
    const answer = onSignal.mock.calls.find((c) => c[0].kind === "answer_submitted");
    expect(answer![0].correct).toBe(false);
    const matches = screen.getAllByText((_, el) =>
      el?.tagName === "P" && /1 étape/i.test(el.textContent ?? "") && /à revoir/i.test(el.textContent ?? "")
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  it("appelle onContinue après validation", async () => {
    const onContinue = vi.fn();
    render(
      <ReproductionScene
        scene={baseScene}
        onSignal={vi.fn().mockResolvedValue(undefined)}
        onContinue={onContinue}
      />,
    );
    fireEvent.change(screen.getByLabelText("étape 1"), { target: { value: "7.4" } });
    fireEvent.change(screen.getByLabelText("étape 2"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /valider/i }));
    await Promise.resolve();
    fireEvent.click(screen.getByRole("button", { name: /continuer/i }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("normalise la comparaison (espaces, casse)", async () => {
    const onSignal = vi.fn().mockResolvedValue(undefined);
    render(<ReproductionScene scene={baseScene} onSignal={onSignal} onContinue={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("étape 1"), { target: { value: "  7.4 " } });
    fireEvent.change(screen.getByLabelText("étape 2"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: /valider/i }));
    await Promise.resolve();
    const answer = onSignal.mock.calls.find((c) => c[0].kind === "answer_submitted");
    expect(answer![0].correct).toBe(true);
  });
});
