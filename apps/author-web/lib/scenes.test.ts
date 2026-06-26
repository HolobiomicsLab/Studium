import { describe, expect, it } from "vitest";
import {
  SpotTheFlawSceneSchema,
  ExplainBackSceneSchema,
  gradeSpotTheFlaw,
  gradeExplainBack,
  foldText,
  DEFAULT_RUBRIC,
  type SpotTheFlawScene,
  type ExplainBackScene,
} from "./scenes";

function baseFields(id: string) {
  return {
    id,
    title: "T",
    objective_refs: [],
    concept_refs: ["c-orbitales-formes"],
    estimated_seconds: 30,
    adaptation_hooks: [],
    rubric: DEFAULT_RUBRIC,
  };
}

function spotScene(): SpotTheFlawScene {
  return {
    ...baseFields("s1"),
    type: "spot_the_flaw",
    flawed_content: "La 2p a 1 nœud radial.",
    claims: [
      { id: "c1", text: "La 2p a 1 nœud radial", flaws_expected: ["0 nœud", "n−ℓ−1"] },
    ],
    model_correction: "La 2p a 0 nœud radial (n−ℓ−1 = 0).",
  };
}

function explainScene(): ExplainBackScene {
  return {
    ...baseFields("e1"),
    type: "explain_back",
    prompt: "Explique la forme d'une orbitale 2p.",
    key_points: [
      { id: "k1", text: "Forme bilobée", cues: ["bilobé", "deux lobes"] },
      { id: "k2", text: "Plan nodal", cues: ["plan nodal", "nœud"] },
    ],
    model_explanation: "Une 2p est bilobée avec un plan nodal.",
  };
}

describe("SpotTheFlawSceneSchema invariants", () => {
  it("accepts a well-formed scene", () => {
    expect(SpotTheFlawSceneSchema.safeParse(spotScene()).success).toBe(true);
  });

  it("rejects a claim with zero flaws_expected (>=1 invariant)", () => {
    const s = spotScene();
    s.claims[0].flaws_expected = [];
    const res = SpotTheFlawSceneSchema.safeParse(s);
    expect(res.success).toBe(false);
  });

  it("rejects zero claims", () => {
    const s = spotScene();
    s.claims = [];
    expect(SpotTheFlawSceneSchema.safeParse(s).success).toBe(false);
  });

  it("rejects empty flawed_content / model_correction", () => {
    const s = spotScene();
    s.flawed_content = "";
    expect(SpotTheFlawSceneSchema.safeParse(s).success).toBe(false);
  });
});

describe("ExplainBackSceneSchema invariants", () => {
  it("accepts a well-formed scene", () => {
    expect(ExplainBackSceneSchema.safeParse(explainScene()).success).toBe(true);
  });

  it("rejects a key_point with zero cues (>=1 invariant)", () => {
    const s = explainScene();
    s.key_points[0].cues = [];
    expect(ExplainBackSceneSchema.safeParse(s).success).toBe(false);
  });

  it("rejects zero key_points", () => {
    const s = explainScene();
    s.key_points = [];
    expect(ExplainBackSceneSchema.safeParse(s).success).toBe(false);
  });
});

describe("foldText", () => {
  it("folds accents, case, and superscripts/ℓ", () => {
    expect(foldText("n−ℓ−1")).toBe("n-l-1");
    expect(foldText("Nœud RADIAL")).toContain("radial");
  });
});

describe("gradeSpotTheFlaw (key-free)", () => {
  it("marks a claim covered iff the answer mentions a flaw keyword", () => {
    const res = gradeSpotTheFlaw(spotScene(), "il devrait y avoir 0 nœud, pas 1");
    expect(res.covered).toBe(1);
    expect(res.total).toBe(1);
    expect(res.items[0].covered).toBe(true);
    expect(res.items[0].hits).toContain("0 nœud");
  });

  it("marks a claim missed when no keyword matches", () => {
    const res = gradeSpotTheFlaw(spotScene(), "je ne sais pas");
    expect(res.covered).toBe(0);
    expect(res.items[0].covered).toBe(false);
  });

  it("folds notation so n-l-1 matches n−ℓ−1", () => {
    const res = gradeSpotTheFlaw(spotScene(), "la formule est n-l-1");
    expect(res.items[0].covered).toBe(true);
  });
});

describe("gradeExplainBack (key-free)", () => {
  it("counts each key point covered iff a cue appears", () => {
    const res = gradeExplainBack(explainScene(), "elle est bilobée mais j'oublie le reste");
    expect(res.total).toBe(2);
    expect(res.covered).toBe(1);
    expect(res.items[0].covered).toBe(true);
    expect(res.items[1].covered).toBe(false);
  });

  it("counts both when both cues appear", () => {
    const res = gradeExplainBack(
      explainScene(),
      "deux lobes séparés par un plan nodal"
    );
    expect(res.covered).toBe(2);
  });
});
