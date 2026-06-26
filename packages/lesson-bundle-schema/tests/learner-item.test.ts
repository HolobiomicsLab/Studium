import { describe, it, expect } from "vitest";
import {
  LAItemEnvelopeSchema,
  LAReviewStateSchema,
  LA_LEGAL_TRANSITIONS,
  laTransitionAllowed,
  SceneSchema,
  type LAReviewState,
} from "../src/index";

// A schema-pure quiz Scene (the atomistique "radial nodes" example from the plan).
const QUIZ_SCENE = {
  id: "s-la-001",
  type: "quiz",
  title: "Nœuds radiaux de la 3s",
  objective_refs: [],
  concept_refs: ["c-orbitales-formes"],
  estimated_seconds: 60,
  adaptation_hooks: [],
  question: "Combien de nœuds radiaux possède l'orbitale 3s ?",
  choices: [
    { id: "a", text: "0", correct: false },
    { id: "b", text: "1", correct: false },
    { id: "c", text: "2", correct: true },
    { id: "d", text: "3", correct: false },
  ],
  feedback_correct: "Oui : n−ℓ−1 = 3−0−1 = 2.",
  feedback_incorrect: "Rappel : nœuds radiaux = n−ℓ−1.",
  hints: ["n−ℓ−1"],
};

const ENVELOPE = {
  item_id: "11111111-1111-1111-1111-111111111111",
  course_id: "atomistique-l1",
  target_bundle_ref: "atomistique-l1.json",
  schema_version: "1.4",
  scene: QUIZ_SCENE,
  author_pseudonym: "hmac-deadbeef",
  created_at: "2026-06-26T10:00:00Z",
  review_state: "submitted",
  validation: { ok: true, validator_version: "validate_scene/1.0", errors: [] },
};

describe("LAItemEnvelope schema", () => {
  it("accepts a minimal submitted envelope", () => {
    expect(LAItemEnvelopeSchema.safeParse(ENVELOPE).success).toBe(true);
  });

  it("accepts the full Scene union (spot_the_flaw, explain_back), not quiz-only", () => {
    const spot = {
      ...ENVELOPE,
      scene: {
        id: "s-flaw", type: "spot_the_flaw", title: "Erreur plantée",
        objective_refs: [], concept_refs: [], estimated_seconds: 0, adaptation_hooks: [],
        flawed_content: "L'orbitale 3s a 3 nœuds radiaux.",
        claims: [{ id: "k1", text: "3 nœuds radiaux", flaws_expected: ["n−ℓ−1", "2"] }],
        model_correction: "n−ℓ−1 = 2.",
        rubric: { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 },
      },
    };
    const explain = {
      ...ENVELOPE,
      scene: {
        id: "s-eb", type: "explain_back", title: "Explique", objective_refs: [],
        concept_refs: [], estimated_seconds: 0, adaptation_hooks: [],
        prompt: "Explique la règle n−ℓ−1.",
        key_points: [{ id: "kp1", text: "compter les nœuds", cues: ["radial"] }],
        model_explanation: "Les nœuds radiaux valent n−ℓ−1.",
        rubric: { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 },
      },
    };
    expect(LAItemEnvelopeSchema.safeParse(spot).success).toBe(true);
    expect(LAItemEnvelopeSchema.safeParse(explain).success).toBe(true);
  });

  it("rejects an envelope whose scene is not a valid Scene", () => {
    const bad = { ...ENVELOPE, scene: { ...QUIZ_SCENE, type: "not_a_type" } };
    expect(LAItemEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown review_state", () => {
    expect(LAReviewStateSchema.safeParse("frozen").success).toBe(false);
  });

  // SCOPE-PURITY: the envelope's scene must itself be a valid Scene with NO
  // envelope keys leaking in. SceneSchema is strict via the discriminated
  // union — re-parsing the scene must succeed and round-trip unchanged.
  it("keeps the scene schema-pure: scene round-trips through SceneSchema unchanged", () => {
    const parsed = LAItemEnvelopeSchema.parse(ENVELOPE);
    const sceneRoundtrip = SceneSchema.safeParse(parsed.scene);
    expect(sceneRoundtrip.success).toBe(true);
    expect(sceneRoundtrip.success && sceneRoundtrip.data).toEqual(QUIZ_SCENE);
    // No governance/peer keys leaked into the scene body.
    for (const k of [
      "item_id", "course_id", "review_state", "author_pseudonym",
      "validation", "peer_signals", "reviewed_by",
    ]) {
      expect(k in (parsed.scene as Record<string, unknown>)).toBe(false);
    }
  });

  // SCOPE-PURITY (adversarial): governance/peer keys SMUGGLED into the scene body
  // must be stripped on parse — a learner cannot back-door an approved state, a fake
  // pseudonym, or a forged validation into the schema-pure Scene.
  it("strips envelope keys smuggled INTO the scene body", () => {
    const smuggled = {
      ...ENVELOPE,
      scene: {
        ...QUIZ_SCENE,
        author_pseudonym: "hmac-evil",
        review_state: "approved",
        validation: { ok: true, validator_version: "forged", errors: [] },
        reviewed_by: "teacher:evil",
        published_bundle_ref: "file:///etc/passwd",
      },
    };
    const parsed = LAItemEnvelopeSchema.parse(smuggled);
    for (const k of [
      "author_pseudonym", "review_state", "validation", "reviewed_by", "published_bundle_ref",
    ]) {
      expect(k in (parsed.scene as Record<string, unknown>)).toBe(false);
    }
    expect(parsed.scene).toEqual(QUIZ_SCENE);     // scene reduced to the clean schema-pure quiz
    expect(parsed.review_state).toBe("submitted"); // top-level governance unaffected by the smuggle
  });

  it("accepts a peer_signals aggregate when present (reserved P3)", () => {
    const withSignals = {
      ...ENVELOPE,
      review_state: "peer_review",
      peer_signals: { n_tests: 5, n_ratings: 3, mean_rating: 4.2, helpful_votes: 2 },
    };
    expect(LAItemEnvelopeSchema.safeParse(withSignals).success).toBe(true);
  });
});

describe("LA forward-only transition table", () => {
  const allStates = LAReviewStateSchema.options as readonly LAReviewState[];

  it("matches the canonical forward-only table", () => {
    expect(LA_LEGAL_TRANSITIONS).toEqual({
      submitted: ["peer_review", "approved", "rejected", "revision_requested"],
      peer_review: ["approved", "rejected", "revision_requested"],
      revision_requested: [],
      approved: ["published"],
      published: [],
      rejected: [],
    });
  });

  it("allows every legal transition", () => {
    for (const from of allStates) {
      for (const to of LA_LEGAL_TRANSITIONS[from]) {
        expect(laTransitionAllowed(from, to)).toBe(true);
      }
    }
  });

  it("forbids self-loops and backward edges", () => {
    expect(laTransitionAllowed("submitted", "submitted")).toBe(false);
    expect(laTransitionAllowed("approved", "submitted")).toBe(false);
    expect(laTransitionAllowed("published", "approved")).toBe(false);
    expect(laTransitionAllowed("rejected", "approved")).toBe(false);
    expect(laTransitionAllowed("revision_requested", "approved")).toBe(false);
  });
});
