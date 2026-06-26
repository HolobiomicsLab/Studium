/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import SubmissionsQueue, { makeDecideAction } from "./SubmissionsQueue";
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

  it("approve POSTs reviewer (course-token-derived) + explicit timestamp", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...ITEM, review_state: "published" }),
    });
    const action = makeDecideAction(
      "atomistique-l1",
      () => "2026-06-26T12:34:56Z",
    );
    await action("it-abc123", "approve");

    const call = (global.fetch as any).mock.calls[0];
    expect(call[0]).toBe(
      "http://localhost:8002/learner-items/it-abc123/decide",
    );
    expect(call[1].method).toBe("POST");
    expect(call[1].headers["X-Course-Token"]).toBe("atomistique-l1");
    const sent = JSON.parse(call[1].body);
    expect(sent.decision).toBe("approve");
    expect(sent.reviewer).toBe("urn:studium:teacher:atomistique-l1");
    expect(sent.reviewed_at).toBe("2026-06-26T12:34:56Z");
  });

  it("reject forwards the note_code", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...ITEM, review_state: "rejected" }),
    });
    const action = makeDecideAction("atomistique-l1", () => "2026-06-26T12:00:00Z");
    await action("it-abc123", "reject", "off_topic");
    const sent = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(sent.decision).toBe("reject");
    expect(sent.note_code).toBe("off_topic");
  });
});
