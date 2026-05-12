/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AICritiqueScene from "./AICritiqueScene";
import type { Scene } from "@studium/lesson-bundle-schema";

afterEach(cleanup);

const baseScene: Extract<Scene, { type: "ai_critique" }> = {
  id: "s_critique",
  type: "ai_critique",
  title: "Critique d'un raisonnement biaisé",
  objective_refs: [],
  concept_refs: ["c_bias"],
  estimated_seconds: 240,
  adaptation_hooks: [],
  claims: [
    {
      id: "claim_1",
      text: "Les LLMs comprennent les concepts.",
      flaws_expected: ["bias_anthropomorphism"],
    },
    {
      id: "claim_2",
      text: "Plus de paramètres = toujours mieux.",
      flaws_expected: ["bias_scaling_oversimplified"],
    },
  ],
  rubric: { completeness: 0.4, evidence_quality: 0.4, tone: 0.2 },
};

describe("AICritiqueScene", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("affiche les claims sans révéler les flaws_expected", () => {
    render(
      <AICritiqueScene scene={baseScene} onSignal={vi.fn()} onContinue={vi.fn()} />,
    );
    expect(screen.getByText(/comprennent les concepts/i)).toBeTruthy();
    expect(screen.getByText(/plus de paramètres/i)).toBeTruthy();
    expect(screen.queryByText(/bias_anthropomorphism/i)).toBeNull();
    expect(screen.queryByText(/bias_scaling/i)).toBeNull();
  });

  it("émet scene_entered au montage", async () => {
    const onSignal = vi.fn().mockResolvedValue(undefined);
    render(
      <AICritiqueScene scene={baseScene} onSignal={onSignal} onContinue={vi.fn()} />,
    );
    await Promise.resolve();
    expect(onSignal).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "scene_entered", scene_id: "s_critique" }),
    );
  });

  it("désactive le bouton submit tant que la critique est < 10 chars", () => {
    render(
      <AICritiqueScene scene={baseScene} onSignal={vi.fn()} onContinue={vi.fn()} />,
    );
    const submit = screen.getByRole("button", { name: /soumettre/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/critique-textarea/), {
      target: { value: "trop court" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("soumet et affiche le score + émet answer_submitted correct=true", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ score: 0.8, feedback: "Bonne identification du biais." }),
    });
    const onSignal = vi.fn().mockResolvedValue(undefined);
    render(
      <AICritiqueScene scene={baseScene} onSignal={onSignal} onContinue={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/critique-textarea/), {
      target: { value: "Cette affirmation suppose à tort que..." },
    });
    fireEvent.click(screen.getByRole("button", { name: /soumettre/i }));
    await waitFor(() => screen.getByTestId("critique-result"));
    expect(screen.getByText(/80%/)).toBeTruthy();
    expect(screen.getByText(/identification du biais/i)).toBeTruthy();
    const answer = onSignal.mock.calls.find((c) => c[0].kind === "answer_submitted");
    expect(answer![0]).toMatchObject({
      kind: "answer_submitted",
      concept_id: "c_bias",
      scene_id: "s_critique",
      correct: true,
    });
  });

  it("émet correct=false si score < 0.6", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ score: 0.4, feedback: "Critique superficielle." }),
    });
    const onSignal = vi.fn().mockResolvedValue(undefined);
    render(
      <AICritiqueScene scene={baseScene} onSignal={onSignal} onContinue={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/critique-textarea/), {
      target: { value: "Une critique pas si bonne que ça." },
    });
    fireEvent.click(screen.getByRole("button", { name: /soumettre/i }));
    await waitFor(() => screen.getByTestId("critique-result"));
    const answer = onSignal.mock.calls.find((c) => c[0].kind === "answer_submitted");
    expect(answer![0].correct).toBe(false);
  });

  it("affiche une erreur si l'endpoint répond non-2xx", async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 500 });
    render(
      <AICritiqueScene scene={baseScene} onSignal={vi.fn()} onContinue={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/critique-textarea/), {
      target: { value: "Une critique correcte." },
    });
    fireEvent.click(screen.getByRole("button", { name: /soumettre/i }));
    await waitFor(() => screen.getByRole("alert"));
    expect(screen.getByRole("alert").textContent).toMatch(/500/);
  });

  it("emits critique_submitted on successful evaluation", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ score: 0.8, feedback: "ok" }),
    });
    const emit = vi.fn();
    render(
      <AICritiqueScene
        scene={baseScene}
        onSignal={vi.fn().mockResolvedValue(undefined)}
        onContinue={vi.fn()}
        emit={emit}
      />,
    );
    fireEvent.change(screen.getByLabelText(/critique-textarea/), {
      target: { value: "Cette affirmation suppose à tort..." },
    });
    fireEvent.click(screen.getByRole("button", { name: /soumettre/i }));
    await waitFor(() => screen.getByTestId("critique-result"));
    const call = emit.mock.calls.find((c) => c[0].type === "critique_submitted");
    expect(call).toBeTruthy();
    expect(call![0]).toEqual(
      expect.objectContaining({
        type: "critique_submitted",
        scene_id: "s_critique",
        llm_score: 0.8,
        completion_rate: expect.any(Number),
      }),
    );
  });

  it("does not emit critique_submitted if evaluation fails", async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 500 });
    const emit = vi.fn();
    render(
      <AICritiqueScene
        scene={baseScene}
        onSignal={vi.fn().mockResolvedValue(undefined)}
        onContinue={vi.fn()}
        emit={emit}
      />,
    );
    fireEvent.change(screen.getByLabelText(/critique-textarea/), {
      target: { value: "Une critique correcte." },
    });
    fireEvent.click(screen.getByRole("button", { name: /soumettre/i }));
    await waitFor(() => screen.getByRole("alert"));
    const call = emit.mock.calls.find((c) => c[0].type === "critique_submitted");
    expect(call).toBeUndefined();
  });

  it("utilise le endpoint custom si fourni", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ score: 0.7, feedback: "ok" }),
    });
    render(
      <AICritiqueScene
        scene={baseScene}
        onSignal={vi.fn().mockResolvedValue(undefined)}
        onContinue={vi.fn()}
        endpoint="https://api.example.com/critique"
      />,
    );
    fireEvent.change(screen.getByLabelText(/critique-textarea/), {
      target: { value: "Une critique correcte." },
    });
    fireEvent.click(screen.getByRole("button", { name: /soumettre/i }));
    await waitFor(() => screen.getByTestId("critique-result"));
    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toBe("https://api.example.com/critique");
  });
});
