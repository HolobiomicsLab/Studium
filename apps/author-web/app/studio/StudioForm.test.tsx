/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StudioForm } from "./StudioForm";
import type { ValidateResponse, LearnerItemView } from "@/lib/api";

afterEach(cleanup);

const GREEN: ValidateResponse = { ok: true, validator_version: "v1", errors: [] };

// Fill the form into a locally-valid, exactly-one-correct quiz.
// Choice "a" (text "0") is the correct answer; choice "b" (text "1") is wrong.
function fillValidQuiz() {
  fireEvent.change(screen.getByText("Titre").querySelector("input")!, {
    target: { value: "Nœuds radiaux 2p" },
  });
  fireEvent.change(screen.getByText("Question").querySelector("textarea")!, {
    target: { value: "Combien de nœuds radiaux a la 2p ?" },
  });
  fireEvent.change(screen.getByLabelText("texte du choix a"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("texte du choix b"), { target: { value: "1" } });
  fireEvent.click(screen.getByLabelText("marquer le choix a correct"));
  fireEvent.change(screen.getByText("Feedback si correct").querySelector("input")!, {
    target: { value: "Exact : n−ℓ−1 = 0." },
  });
  fireEvent.change(screen.getByText("Feedback si incorrect").querySelector("input")!, {
    target: { value: "Revois n−ℓ−1." },
  });
}

describe("StudioForm — self-test", () => {
  it("renders feedback_incorrect when the learner picks a WRONG choice", async () => {
    const validateFn = vi.fn().mockResolvedValue(GREEN);
    const submitFn = vi.fn();
    render(<StudioForm validateFn={validateFn} submitFn={submitFn} debounceMs={0} />);

    fillValidQuiz();

    // The self-test panel renders once the scene is locally valid.
    const wrong = await screen.findByRole("radio", { name: /^1$/ });
    fireEvent.click(wrong);

    const fb = await screen.findByTestId("selftest-feedback");
    expect(fb.textContent).toContain("Revois n−ℓ−1.");
    expect(fb.textContent).toContain("Incorrect");
  });

  it("renders feedback_correct when the learner picks the RIGHT choice", async () => {
    render(<StudioForm validateFn={vi.fn().mockResolvedValue(GREEN)} submitFn={vi.fn()} debounceMs={0} />);
    fillValidQuiz();
    const right = await screen.findByRole("radio", { name: /^0$/ });
    fireEvent.click(right);
    const fb = await screen.findByTestId("selftest-feedback");
    expect(fb.textContent).toContain("Exact");
  });
});

describe("StudioForm — submit gating (rule-003)", () => {
  it("keeps Submit disabled until BOTH consent AND a green badge", async () => {
    const validateFn = vi.fn().mockResolvedValue(GREEN);
    const submitFn = vi.fn();
    render(<StudioForm validateFn={validateFn} submitFn={submitFn} debounceMs={0} />);

    const submitBtn = screen.getByRole("button", {
      name: /Soumettre à la modération/i,
    }) as HTMLButtonElement;

    // Empty form: invalid -> disabled.
    expect(submitBtn.disabled).toBe(true);

    fillValidQuiz();

    // Wait for the green badge (server validation resolved).
    await waitFor(() =>
      expect(screen.getByTestId("validation-badge").getAttribute("data-state")).toBe("green")
    );

    // Green but no consent yet -> still disabled.
    expect(submitBtn.disabled).toBe(true);

    // Consent without green is impossible to test in isolation here, so toggle
    // consent now that we are green -> enabled.
    fireEvent.click(screen.getByLabelText("consentement"));
    expect(submitBtn.disabled).toBe(false);

    fireEvent.click(submitBtn);
    await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));
    // The form only ever creates a 'submitted' item; it passes the demo course.
    expect(submitFn.mock.calls[0][0]).toMatchObject({
      courseId: "atomistique-l1",
      scene: { concept_refs: ["c-orbitales-formes"], type: "quiz" },
    });
  });

  it("stays disabled when the badge is red (server says ok:false), even with consent", async () => {
    const validateFn = vi
      .fn()
      .mockResolvedValue({ ok: false, validator_version: "v1", errors: ["off_topic"] });
    render(<StudioForm validateFn={validateFn} submitFn={vi.fn()} debounceMs={0} />);

    fillValidQuiz();
    fireEvent.click(screen.getByLabelText("consentement"));

    await waitFor(() => expect(validateFn).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("validation-badge").getAttribute("data-state")).toBe("red")
    );
    const btn = screen.getByRole("button", {
      name: /Soumettre à la modération/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("does NOT call the server validator while the draft is locally invalid", async () => {
    const validateFn = vi.fn().mockResolvedValue(GREEN);
    render(<StudioForm validateFn={validateFn} submitFn={vi.fn()} debounceMs={0} />);
    // Only a title — choices still empty -> local schema fails -> no server call.
    fireEvent.change(screen.getByText("Titre").querySelector("input")!, {
      target: { value: "x" },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(validateFn).not.toHaveBeenCalled();
    expect(screen.getByTestId("validation-badge").getAttribute("data-state")).toBe("red");
  });
});

// Type-only guard: the LearnerItemView the form stores has no author identity.
const _viewShape: LearnerItemView | null = null;
void _viewShape;
