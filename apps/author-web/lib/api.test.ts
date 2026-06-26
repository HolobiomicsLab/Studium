import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  validateLearnerScene,
  submitLearnerItem,
  type QuizScene,
} from "./api";

const SCENE_SYNTH_URL = "http://localhost:8002";

function sampleScene(): QuizScene {
  return {
    id: "la-quiz-1",
    type: "quiz",
    title: "Quiz : nœuds radiaux de la 2p",
    objective_refs: [],
    concept_refs: ["c-orbitales-formes"],
    estimated_seconds: 30,
    adaptation_hooks: [],
    question: "Combien de nœuds radiaux a une orbitale 2p ?",
    choices: [
      { id: "a", text: "0", correct: true },
      { id: "b", text: "1", correct: false },
      { id: "c", text: "2", correct: false },
    ],
    feedback_correct: "Exact : n−ℓ−1 = 2−1−1 = 0.",
    feedback_incorrect: "Revois la formule n−ℓ−1.",
    hints: ["n=2, ℓ=1"],
  };
}

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("validateLearnerScene", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to /learner-items/validate with {course_id, scene}", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        okJson({ ok: true, validator_version: "v1", errors: [] })
      );

    const scene = sampleScene();
    const res = await validateLearnerScene(scene, "atomistique-l1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SCENE_SYNTH_URL}/learner-items/validate`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    const payload = JSON.parse(init?.body as string);
    expect(payload).toEqual({ course_id: "atomistique-l1", scene });
    expect(res).toEqual({ ok: true, validator_version: "v1", errors: [] });
  });

  it("surfaces a red verdict (ok:false + errors) without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson({
        ok: false,
        validator_version: "v1",
        errors: ["choices: exactly one correct required"],
      })
    );
    const res = await validateLearnerScene(sampleScene(), "atomistique-l1");
    expect(res.ok).toBe(false);
    expect(res.errors).toContain("choices: exactly one correct required");
  });

  it("throws on a non-2xx HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad course",
      json: async () => ({}),
    } as unknown as Response);
    await expect(
      validateLearnerScene(sampleScene(), "wrong-course")
    ).rejects.toThrow(/400/);
  });
});

describe("submitLearnerItem", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to /learner-items with the snake_case submit payload", async () => {
    const scene = sampleScene();
    const view = {
      item_id: "uuid-1",
      course_id: "atomistique-l1",
      target_bundle_ref: "atomistique-l1/lesson.json",
      schema_version: "1.4",
      scene,
      review_state: "submitted",
      validation: { ok: true, validator_version: "v1", errors: [] },
      created_at: "2026-06-26T10:00:00Z",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okJson(view));

    const res = await submitLearnerItem({
      courseId: "atomistique-l1",
      targetBundleRef: "atomistique-l1/lesson.json",
      authorHandle: "etu-42",
      createdAt: "2026-06-26T10:00:00Z",
      scene,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SCENE_SYNTH_URL}/learner-items`);
    expect(init?.method).toBe("POST");
    const payload = JSON.parse(init?.body as string);
    expect(payload).toEqual({
      course_id: "atomistique-l1",
      target_bundle_ref: "atomistique-l1/lesson.json",
      author_handle: "etu-42",
      created_at: "2026-06-26T10:00:00Z",
      scene,
    });
    // The form only ever creates a 'submitted' item (rule-003).
    expect(res.review_state).toBe("submitted");
    // The view never carries author identity.
    expect(res).not.toHaveProperty("author_pseudonym");
  });

  it("throws on a 422 validation failure from the backend", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "scene failed validation",
      json: async () => ({}),
    } as unknown as Response);
    await expect(
      submitLearnerItem({
        courseId: "atomistique-l1",
        targetBundleRef: "atomistique-l1/lesson.json",
        authorHandle: "etu-42",
        createdAt: "2026-06-26T10:00:00Z",
        scene: sampleScene(),
      })
    ).rejects.toThrow(/422/);
  });
});
