/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import SubmissionsQueue, {
  DecisionsDisabledError,
  formatSubmissionError,
  makeDecideAction,
  rememberName,
  rememberedName,
  REVIEWER_NAME_KEY,
} from "./SubmissionsQueue";
import type { LearnerItemView } from "@/lib/api";

const ITEM: LearnerItemView = {
  item_id: "it-abc123",
  course_id: "atomistique-l1",
  target_bundle_ref: "file://bundles/atomistique-l1/lesson.json",
  schema_version: "1.4",
  scene: {
    id: "s-learner-1",
    type: "quiz",
    title: "Noeuds radiaux de la 3s",
    question: "Combien de noeuds radiaux pour l'orbitale 3s ?",
    choices: [
      { id: "a", text: "0", correct: false },
      { id: "b", text: "2", correct: true },
      { id: "c", text: "3", correct: false },
    ],
    feedback_correct: "Oui : n - l - 1 = 3 - 0 - 1 = 2.",
    feedback_incorrect: "Revois la formule n - l - 1.",
    hints: [],
  },
  review_state: "submitted",
  validation: { ok: true, validator_version: "scene-synth-v1", errors: [] },
  created_at: "2026-06-26T10:00:00Z",
};

describe("SubmissionsQueue render", () => {
  it("forces the scene body visible (teacher cannot approve blind)", () => {
    const html = renderToStaticMarkup(
      createElement(SubmissionsQueue, { items: [ITEM], onDecide: () => {} }),
    );
    expect(html).toContain('data-testid="scene-body"');
    expect(html).toContain("Combien de noeuds radiaux");
    expect(html).toContain("Noeuds radiaux de la 3s");
  });

  it("shows the ANSWER KEY — the correct choice is marked", () => {
    const html = renderToStaticMarkup(
      createElement(SubmissionsQueue, { items: [ITEM], onDecide: () => {} }),
    );
    expect(html).toContain('data-testid="answer-key"');
    // the correct choice carries data-correct="true" + a "bonne réponse" tag
    expect(html).toContain('data-correct="true"');
    expect(html).toContain("bonne réponse");
    // the distractors are present but NOT marked correct
    expect(html).toContain('data-correct="false"');
  });

  it("shows the validation badge (ok)", () => {
    const html = renderToStaticMarkup(
      createElement(SubmissionsQueue, { items: [ITEM], onDecide: () => {} }),
    );
    expect(html).toContain('data-testid="validation-badge"');
    expect(html).toContain('data-ok="true"');
    expect(html).toContain("Validation OK");
  });

  it("renders a failed validation badge with error count", () => {
    const bad: LearnerItemView = {
      ...ITEM,
      validation: { ok: false, validator_version: "v1", errors: ["e1", "e2"] },
    };
    const html = renderToStaticMarkup(
      createElement(SubmissionsQueue, { items: [bad], onDecide: () => {} }),
    );
    expect(html).toContain('data-ok="false"');
    expect(html).toContain("2 erreurs");
  });

  it("renders a de-identified author tag (no identity)", () => {
    const html = renderToStaticMarkup(
      createElement(SubmissionsQueue, { items: [ITEM], onDecide: () => {} }),
    );
    expect(html).toContain("anonyme");
    expect(html).toContain("#ABC123");
    // there is no author_pseudonym field to leak in the first place
    expect(html).not.toContain("author_pseudonym");
  });

  it("renders the three moderation actions", () => {
    const html = renderToStaticMarkup(
      createElement(SubmissionsQueue, { items: [ITEM], onDecide: () => {} }),
    );
    expect(html).toContain("Approuver");
    expect(html).toContain("Demander révision");
    expect(html).toContain("Rejeter");
  });

  it("renders an empty-state when there are no submissions", () => {
    const html = renderToStaticMarkup(
      createElement(SubmissionsQueue, { items: [], onDecide: () => {} }),
    );
    expect(html).toContain('data-testid="empty-queue"');
  });
});

describe("makeDecideAction (page wiring)", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("approve POSTs course + decision to the dashboard's own route, never to scene-synth", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...ITEM, review_state: "published" }),
    });
    const action = makeDecideAction("atomistique-l1");
    await action("it-abc123", "approve");

    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe("/api/learner-items/it-abc123/decide");
    expect(call[1].method).toBe("POST");
    // The browser holds no credential: no bearer, no reviewer, no timestamp of its own.
    expect(call[1].headers.Authorization).toBeUndefined();
    const sent = JSON.parse(call[1].body);
    expect(sent).toEqual({ course_id: "atomistique-l1", decision: "approve" });
  });

  it("reject forwards the note_code", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...ITEM, review_state: "rejected" }),
    });
    const action = makeDecideAction("atomistique-l1");
    await action("it-abc123", "reject", "off_topic");
    const sent = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(sent.decision).toBe("reject");
    expect(sent.note_code).toBe("off_topic");
  });

  it("a 503 from the dashboard's server says decisions are disabled until the token is set", async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const error = await Promise.resolve(makeDecideAction("atomistique-l1")("it-abc123", "approve", undefined, "A. Teacher"))
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(DecisionsDisabledError);
    expect(formatSubmissionError(error)).toContain("STUDIUM_REVIEW_TOKEN");
  });
});

describe("reviewer name (what learners read on an approved contribution)", () => {
  it("without a name, Approve is disabled and says why; the other decisions stay available", () => {
    const html = renderToStaticMarkup(createElement(SubmissionsQueue, { items: [ITEM], onDecide: () => {}, initialName: "" }));
    expect(html).toContain("Votre nom, tel que les apprenants le liront");
    expect(html).toContain("Saisissez votre nom pour approuver");
    const approve = html.match(/<button[^>]*>Approuver<\/button>/)?.[0] ?? "";
    expect(approve).toContain("disabled");
    const hintId = html.match(/id="([^"]+)" role="status"/)?.[1];
    expect(hintId).toBeTruthy();
    expect(approve).toContain(`aria-describedby="${hintId}"`);
    expect(html.match(/<button[^>]*>Rejeter<\/button>/)?.[0]).not.toContain("disabled");
  });

  it("with a name, Approve is enabled and the page shows what learners will read", () => {
    const html = renderToStaticMarkup(createElement(SubmissionsQueue, { items: [ITEM], onDecide: () => {}, initialName: "  Mme Curie " }));
    expect(html.match(/<button[^>]*>Approuver<\/button>/)?.[0]).not.toContain("disabled");
    expect(html).toContain("Leçon proposée par une personne de la classe, validée par Mme Curie");
    expect(html).not.toContain("adresse électronique");
  });

  it("in English, and with a note when the name is an e-mail address", () => {
    const html = renderToStaticMarkup(createElement(SubmissionsQueue, { items: [ITEM], onDecide: () => {}, locale: "en", initialName: "m.curie@example.org" }));
    expect(html).toContain("Your name, as learners will read it");
    expect(html).toContain("Lesson contributed by a classmate, validated by m.curie@example.org");
    expect(html).toContain("this is an e-mail address; learners will see it");
  });

  it("makeDecideAction sends the typed name, trimmed, as reviewer_name", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ITEM });
    await makeDecideAction("atomistique-l1")("it-abc123", "approve", undefined, "  Mme Curie ");
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({
      course_id: "atomistique-l1", decision: "approve", reviewer_name: "Mme Curie",
    });
  });

  it("remembers the name in localStorage, and works when storage is blocked", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    } });
    rememberName("Mme Curie");
    expect(store.get(REVIEWER_NAME_KEY)).toBe("Mme Curie");
    expect(rememberedName()).toBe("Mme Curie");
    rememberName("  ");
    expect(store.has(REVIEWER_NAME_KEY)).toBe(false);
    vi.stubGlobal("window", { get localStorage(): Storage { throw new Error("blocked"); } });
    expect(() => rememberName("x")).not.toThrow();
    expect(rememberedName()).toBe("");
    vi.unstubAllGlobals();
  });
});
