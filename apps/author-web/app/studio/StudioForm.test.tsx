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

// --------------------------------------------------------------------------- //
// Scene-type selector + the new active-learning editors.
// --------------------------------------------------------------------------- //

function selectSceneType(type: string) {
  fireEvent.change(screen.getByLabelText("type de scène"), { target: { value: type } });
}

// Fill a locally-valid spot_the_flaw draft: one flawed claim with one expected flaw.
function fillValidSpotTheFlaw() {
  fireEvent.change(screen.getByText("Titre").querySelector("input")!, {
    target: { value: "Repérer l'erreur : nœuds 2p" },
  });
  fireEvent.change(screen.getByLabelText("contenu erroné"), {
    target: { value: "La 2p a 1 nœud radial." },
  });
  fireEvent.change(screen.getByLabelText("assertion erronée 1"), {
    target: { value: "La 2p a 1 nœud radial" },
  });
  fireEvent.change(screen.getByLabelText("défaut attendu 1.1"), {
    target: { value: "0 nœud" },
  });
  fireEvent.change(screen.getByLabelText("cours corrigé"), {
    target: { value: "La 2p a 0 nœud radial." },
  });
}

// Fill a locally-valid explain_back draft: one key point with one cue.
function fillValidExplainBack() {
  fireEvent.change(screen.getByText("Titre").querySelector("input")!, {
    target: { value: "Ré-explique la forme 2p" },
  });
  fireEvent.change(screen.getByLabelText("consigne"), {
    target: { value: "Explique la forme d'une orbitale 2p." },
  });
  fireEvent.change(screen.getByLabelText("idée-clé 1"), {
    target: { value: "Bilobée" },
  });
  fireEvent.change(screen.getByLabelText("indice 1.1"), {
    target: { value: "bilobé" },
  });
  fireEvent.change(screen.getByLabelText("explication de référence"), {
    target: { value: "Une 2p est bilobée avec un plan nodal." },
  });
}

describe("StudioForm — spot_the_flaw editor", () => {
  it("validates + submits a schema-pure spot_the_flaw payload", async () => {
    const validateFn = vi.fn().mockResolvedValue(GREEN);
    const submitFn = vi.fn().mockResolvedValue({ review_state: "submitted" });
    render(<StudioForm validateFn={validateFn} submitFn={submitFn} debounceMs={0} />);

    selectSceneType("spot_the_flaw");
    fillValidSpotTheFlaw();

    await waitFor(() =>
      expect(screen.getByTestId("validation-badge").getAttribute("data-state")).toBe("green")
    );
    // The server validator was called with a spot_the_flaw scene.
    expect(validateFn.mock.calls.at(-1)![0]).toMatchObject({ type: "spot_the_flaw" });

    fireEvent.click(screen.getByLabelText("consentement"));
    fireEvent.click(screen.getByRole("button", { name: /Soumettre à la modération/i }));
    await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));

    const payload = submitFn.mock.calls[0][0];
    expect(payload.courseId).toBe("atomistique-l1");
    expect(payload.scene).toMatchObject({
      type: "spot_the_flaw",
      concept_refs: ["c-orbitales-formes"],
      flawed_content: "La 2p a 1 nœud radial.",
      model_correction: "La 2p a 0 nœud radial.",
    });
    expect(payload.scene.claims[0].flaws_expected).toEqual(["0 nœud"]);
    expect(payload.scene.rubric).toEqual({ completeness: 0.5, evidence_quality: 0.3, tone: 0.2 });
  });

  it("stays locally INVALID (no server call) until each claim has >=1 flaw", async () => {
    const validateFn = vi.fn().mockResolvedValue(GREEN);
    render(<StudioForm validateFn={validateFn} submitFn={vi.fn()} debounceMs={0} />);

    selectSceneType("spot_the_flaw");
    // Title + flawed content + correction, claim text, but flaw keyword left blank.
    fireEvent.change(screen.getByText("Titre").querySelector("input")!, { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("contenu erroné"), { target: { value: "faux" } });
    fireEvent.change(screen.getByLabelText("assertion erronée 1"), { target: { value: "c" } });
    fireEvent.change(screen.getByLabelText("cours corrigé"), { target: { value: "vrai" } });

    await new Promise((r) => setTimeout(r, 10));
    expect(validateFn).not.toHaveBeenCalled();
    expect(screen.getByTestId("validation-badge").getAttribute("data-state")).toBe("red");
  });

  it("hides the answer key until the author submits a mock answer, then reveals coverage", async () => {
    render(<StudioForm validateFn={vi.fn().mockResolvedValue(GREEN)} submitFn={vi.fn()} debounceMs={0} />);
    selectSceneType("spot_the_flaw");
    fillValidSpotTheFlaw();

    // Reveal panel is present, but the answer key (coverage list / model correction) is NOT yet shown.
    await screen.findByRole("button", { name: "Voir le corrigé" });
    expect(screen.queryByTestId("reveal")).toBeNull();
    expect(screen.queryByTestId("coverage-c1")).toBeNull();

    // Author writes a mock answer that catches the flaw, then reveals.
    fireEvent.change(screen.getByLabelText("réponse de l'apprenant"), {
      target: { value: "il y a 0 nœud, pas 1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Voir le corrigé" }));

    const reveal = await screen.findByTestId("reveal");
    expect(reveal).toBeTruthy();
    expect(screen.getByTestId("coverage-c1").getAttribute("data-covered")).toBe("yes");
    expect(screen.getByTestId("coverage-score").textContent).toContain("1 / 1");
  });
});

describe("StudioForm — explain_back editor", () => {
  it("validates + submits a schema-pure explain_back payload", async () => {
    const validateFn = vi.fn().mockResolvedValue(GREEN);
    const submitFn = vi.fn().mockResolvedValue({ review_state: "submitted" });
    render(<StudioForm validateFn={validateFn} submitFn={submitFn} debounceMs={0} />);

    selectSceneType("explain_back");
    fillValidExplainBack();

    await waitFor(() =>
      expect(screen.getByTestId("validation-badge").getAttribute("data-state")).toBe("green")
    );
    expect(validateFn.mock.calls.at(-1)![0]).toMatchObject({ type: "explain_back" });

    fireEvent.click(screen.getByLabelText("consentement"));
    fireEvent.click(screen.getByRole("button", { name: /Soumettre à la modération/i }));
    await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));

    const payload = submitFn.mock.calls[0][0];
    expect(payload.scene).toMatchObject({
      type: "explain_back",
      concept_refs: ["c-orbitales-formes"],
      prompt: "Explique la forme d'une orbitale 2p.",
      model_explanation: "Une 2p est bilobée avec un plan nodal.",
    });
    expect(payload.scene.key_points[0].cues).toEqual(["bilobé"]);
  });

  it("rejects a key point with no cue (red badge, no server call)", async () => {
    const validateFn = vi.fn().mockResolvedValue(GREEN);
    render(<StudioForm validateFn={validateFn} submitFn={vi.fn()} debounceMs={0} />);
    selectSceneType("explain_back");
    fireEvent.change(screen.getByText("Titre").querySelector("input")!, { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("consigne"), { target: { value: "explique" } });
    fireEvent.change(screen.getByLabelText("idée-clé 1"), { target: { value: "k" } });
    fireEvent.change(screen.getByLabelText("explication de référence"), { target: { value: "ref" } });
    // cue left empty.
    await new Promise((r) => setTimeout(r, 10));
    expect(validateFn).not.toHaveBeenCalled();
    expect(screen.getByTestId("validation-badge").getAttribute("data-state")).toBe("red");
  });

  it("reveals key-point coverage only AFTER a mock answer", async () => {
    render(<StudioForm validateFn={vi.fn().mockResolvedValue(GREEN)} submitFn={vi.fn()} debounceMs={0} />);
    selectSceneType("explain_back");
    fillValidExplainBack();

    await screen.findByRole("button", { name: "Voir le corrigé" });
    expect(screen.queryByTestId("reveal")).toBeNull();

    fireEvent.change(screen.getByLabelText("réponse de l'apprenant"), {
      target: { value: "elle est bilobée" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Voir le corrigé" }));

    await screen.findByTestId("reveal");
    expect(screen.getByTestId("coverage-k1").getAttribute("data-covered")).toBe("yes");
  });
});

// Type-only guard: the LearnerItemView the form stores has no author identity.
const _viewShape: LearnerItemView | null = null;
void _viewShape;
