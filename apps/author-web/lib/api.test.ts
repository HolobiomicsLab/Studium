import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  validateLearnerScene,
  submitLearnerItem,
  submitPeerReview,
  listSubmittedItems,
  type QuizScene,
  type SpotTheFlawScene,
  type ExplainBackScene,
  type LearnerItemView,
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

function sampleSpotScene(): SpotTheFlawScene {
  return {
    id: "la-spot-1",
    type: "spot_the_flaw",
    title: "Repérer l'erreur : nœuds 2p",
    objective_refs: [],
    concept_refs: ["c-orbitales-formes"],
    estimated_seconds: 60,
    adaptation_hooks: [],
    flawed_content: "La 2p possède 1 nœud radial.",
    claims: [
      { id: "c1", text: "La 2p possède 1 nœud radial", flaws_expected: ["0 nœud", "n−ℓ−1"] },
    ],
    model_correction: "La 2p possède 0 nœud radial (n−ℓ−1 = 0).",
    rubric: { completeness: 0.5, evidence_quality: 0.3, tone: 0.2 },
  };
}

function sampleExplainScene(): ExplainBackScene {
  return {
    id: "la-explain-1",
    type: "explain_back",
    title: "Ré-explique la forme 2p",
    objective_refs: [],
    concept_refs: ["c-orbitales-formes"],
    estimated_seconds: 90,
    adaptation_hooks: [],
    prompt: "Explique la forme d'une orbitale 2p.",
    key_points: [{ id: "k1", text: "Bilobée", cues: ["bilobé", "deux lobes"] }],
    model_explanation: "Une 2p est bilobée avec un plan nodal.",
    rubric: { completeness: 0.5, evidence_quality: 0.3, tone: 0.2 },
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

describe("Scene union — spot_the_flaw + explain_back over the same endpoints", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates a spot_the_flaw scene unchanged ({course_id, scene})", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okJson({ ok: true, validator_version: "v1", errors: [] }));
    const scene = sampleSpotScene();
    await validateLearnerScene(scene, "atomistique-l1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SCENE_SYNTH_URL}/learner-items/validate`);
    const payload = JSON.parse(init?.body as string);
    expect(payload).toEqual({ course_id: "atomistique-l1", scene });
    // The flaw answer key rides along verbatim (it is server-validated, not redacted here).
    expect(payload.scene.type).toBe("spot_the_flaw");
    expect(payload.scene.claims[0].flaws_expected.length).toBeGreaterThanOrEqual(1);
  });

  it("submits an explain_back scene with the snake_case payload", async () => {
    const scene = sampleExplainScene();
    const view = {
      item_id: "uuid-eb",
      course_id: "atomistique-l1",
      target_bundle_ref: "atomistique-l1/lesson.json",
      schema_version: "1.4",
      scene,
      review_state: "submitted",
      validation: { ok: true, validator_version: "v1", errors: [] },
      created_at: "2026-06-26T10:00:00Z",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson(view));
    const res = await submitLearnerItem({
      courseId: "atomistique-l1",
      targetBundleRef: "atomistique-l1/lesson.json",
      authorHandle: "etu-7",
      createdAt: "2026-06-26T10:00:00Z",
      scene,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SCENE_SYNTH_URL}/learner-items`);
    const payload = JSON.parse(init?.body as string);
    expect(payload.scene.type).toBe("explain_back");
    expect(payload.scene.key_points[0].cues.length).toBeGreaterThanOrEqual(1);
    expect(res.scene.type).toBe("explain_back");
    expect(res.review_state).toBe("submitted");
  });
});

describe("listSubmittedItems (Workflow B discovery)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function sampleView(): LearnerItemView {
    return {
      item_id: "uuid-1",
      course_id: "atomistique-l1",
      target_bundle_ref: "atomistique-l1/lesson.json",
      schema_version: "1.4",
      scene: sampleScene(),
      review_state: "submitted",
      validation: { ok: true, validator_version: "v1", errors: [] },
      created_at: "2026-06-26T10:00:00Z",
    };
  }

  it("GETs /learner-items?course=...&state=submitted and unwraps {items}", async () => {
    const view = sampleView();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okJson({ items: [view] }));

    const res = await listSubmittedItems({ course: "atomistique-l1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(url as string);
    expect(u.origin + u.pathname).toBe(`${SCENE_SYNTH_URL}/learner-items`);
    expect(u.searchParams.get("course")).toBe("atomistique-l1");
    // Defaults to the moderation-pending 'submitted' queue.
    expect(u.searchParams.get("state")).toBe("submitted");
    expect(init?.method).toBe("GET");
    // Returns the bare array of client-safe views (no author identity present).
    expect(res).toEqual([view]);
    expect(res[0]).not.toHaveProperty("author_pseudonym");
  });

  it("throws on a non-2xx list response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
      json: async () => ({}),
    } as unknown as Response);
    await expect(listSubmittedItems({ course: "atomistique-l1" })).rejects.toThrow(/500/);
  });
});

describe("submitPeerReview (Workflow B)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs {passed, rating, helpful} to /learner-items/{id}/peer-review", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        okJson({ item_id: "uuid-1", review_count: 1, review_state: "peer_review" })
      );
    const res = await submitPeerReview({
      itemId: "uuid-1",
      passed: true,
      rating: 4,
      helpful: true,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SCENE_SYNTH_URL}/learner-items/uuid-1/peer-review`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      passed: true,
      rating: 4,
      helpful: true,
    });
    expect(res.review_count).toBe(1);
  });

  it("sends SCALARS ONLY — no peer identity, no free text in the body", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        okJson({ item_id: "uuid-1", review_count: 1, review_state: "peer_review" })
      );
    await submitPeerReview({ itemId: "uuid-1", passed: false, rating: 2, helpful: false });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    // Exactly the three scalar keys — nothing else rides along.
    expect(Object.keys(body).sort()).toEqual(["helpful", "passed", "rating"]);
    // Belt-and-suspenders: no identity / no free-text fields by any common name.
    for (const forbidden of [
      "author",
      "author_handle",
      "author_pseudonym",
      "peer",
      "peer_id",
      "reviewer",
      "comment",
      "note",
      "text",
      "feedback",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it("throws on a non-2xx peer-review response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "not found",
      json: async () => ({}),
    } as unknown as Response);
    await expect(
      submitPeerReview({ itemId: "missing", passed: false, rating: 1, helpful: false })
    ).rejects.toThrow(/404/);
  });
});
