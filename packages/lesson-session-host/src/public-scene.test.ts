import { describe, it, expect } from "vitest";
import type { Scene } from "@studium/lesson-bundle-schema";
import { publicScene, citedSources, REDACTED_SCENE_FIELDS } from "./public-scene.js";

// A minimal SceneBase the variant builders extend. Every attemptable field the learner needs to
// answer must SURVIVE publicScene; every answer-bearing field must be stripped.
function base(type: string): Record<string, unknown> {
  return {
    id: `s-${type}`, type, title: "T", objective_refs: [], concept_refs: ["c1"],
    estimated_seconds: 0, adaptation_hooks: [],
    render_assets: [{ kind: "svg", title: "fig", payload: "<svg/>" }],
  };
}

describe("publicScene — generic transport redaction", () => {
  it("removes the `correct` flag from every quiz choice but keeps choice text + question; withholds feedback + hints", () => {
    const quiz = {
      ...base("quiz"),
      question: "Why?",
      choices: [
        { id: "a", text: "A", correct: false },
        { id: "b", text: "B", correct: true },
      ],
      feedback_correct: "y", feedback_incorrect: "n", hints: ["hint one"],
    } as unknown as Scene;
    const pub = publicScene(quiz) as Record<string, unknown>;
    const choices = pub["choices"] as Array<Record<string, unknown>>;
    expect(choices.map((c) => c["id"])).toEqual(["a", "b"]);
    expect(choices.map((c) => c["text"])).toEqual(["A", "B"]);
    for (const c of choices) expect("correct" in c).toBe(false);
    // attemptable + render fields survive
    expect(pub["question"]).toBe("Why?");
    // the answer key in prose: both feedback texts and the hints are withheld until earned
    expect("hints" in pub).toBe(false);
    expect("feedback_correct" in pub).toBe(false);
    expect("feedback_incorrect" in pub).toBe(false);
    expect(pub["render_assets"]).toBeDefined();
    // does not mutate the source scene (server keeps the full scene)
    expect((quiz as Record<string, unknown>)["choices"]).toEqual([
      { id: "a", text: "A", correct: false },
      { id: "b", text: "B", correct: true },
    ]);
  });

  it("strips ai_critique claims, keeps rubric/title", () => {
    const sc = {
      ...base("ai_critique"),
      claims: [{ id: "k1", text: "x", flaws_expected: ["w"] }],
      rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
    } as unknown as Scene;
    const pub = publicScene(sc) as Record<string, unknown>;
    expect("claims" in pub).toBe(false);
    expect(pub["rubric"]).toBeDefined();
  });

  it("spot_the_flaw: strips claims + sound_claims + model_correction, keeps flawed_content", () => {
    const sc = {
      ...base("spot_the_flaw"),
      flawed_content: "N is 1s2 2s2 2p4",
      claims: [{ id: "k1", text: "wrong", flaws_expected: ["hund"] }],
      sound_claims: [{ id: "s1", text: "N has 7 electrons" }],
      model_correction: "N is 1s2 2s2 2p3",
      rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
    } as unknown as Scene;
    const pub = publicScene(sc) as Record<string, unknown>;
    expect("claims" in pub).toBe(false);
    expect("sound_claims" in pub).toBe(false); // OVER-DISTRUST answer key never reaches the client
    expect("model_correction" in pub).toBe(false);
    expect(pub["flawed_content"]).toBe("N is 1s2 2s2 2p4");
  });

  it("explain_back: strips key_points + model_explanation, keeps prompt", () => {
    const sc = {
      ...base("explain_back"),
      prompt: "Explain the nodal plane",
      key_points: [{ id: "k1", text: "x", cues: ["node"] }],
      model_explanation: "reveal",
      rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
    } as unknown as Scene;
    const pub = publicScene(sc) as Record<string, unknown>;
    expect("key_points" in pub).toBe(false);
    expect("model_explanation" in pub).toBe(false);
    expect(pub["prompt"]).toBe("Explain the nodal plane");
  });

  it("comparison: strips key_points + model_answer, keeps prompt + both artifacts", () => {
    const sc = {
      ...base("comparison"),
      prompt: "Compare", artifact_a: "AI version", artifact_b: "Teacher version",
      key_points: [{ id: "k1", text: "x", cues: ["diff"] }],
      model_answer: "reveal",
      rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
    } as unknown as Scene;
    const pub = publicScene(sc) as Record<string, unknown>;
    expect("key_points" in pub).toBe(false);
    expect("model_answer" in pub).toBe(false);
    expect(pub["prompt"]).toBe("Compare");
    expect(pub["artifact_a"]).toBe("AI version");
    expect(pub["artifact_b"]).toBe("Teacher version");
  });

  it("summary_audit: strips claims + model_correction, keeps source_content + ai_summary", () => {
    const sc = {
      ...base("summary_audit"),
      source_content: "the source", ai_summary: "the summary",
      claims: [{ id: "k1", text: "x", flaws_expected: ["omit"] }],
      model_correction: "reveal",
      rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
    } as unknown as Scene;
    const pub = publicScene(sc) as Record<string, unknown>;
    expect("claims" in pub).toBe(false);
    expect("model_correction" in pub).toBe(false);
    expect(pub["source_content"]).toBe("the source");
    expect(pub["ai_summary"]).toBe("the summary");
  });

  it("prompt_practice: strips key_points + model_prompt, keeps task + starter_prompt", () => {
    const sc = {
      ...base("prompt_practice"),
      task: "Write a prompt", starter_prompt: "Try: ...",
      key_points: [{ id: "k1", text: "x", cues: ["context"] }],
      model_prompt: "reveal",
      rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
    } as unknown as Scene;
    const pub = publicScene(sc) as Record<string, unknown>;
    expect("key_points" in pub).toBe(false);
    expect("model_prompt" in pub).toBe(false);
    expect(pub["task"]).toBe("Write a prompt");
    expect(pub["starter_prompt"]).toBe("Try: ...");
  });

  it("intro/concept scenes pass through unchanged (no answer-bearing fields)", () => {
    const sc = { ...base("concept"), markdown: "body" } as unknown as Scene;
    const pub = publicScene(sc) as Record<string, unknown>;
    expect(pub["markdown"]).toBe("body");
    expect(pub["id"]).toBe("s-concept");
  });

  it("strips communication_sim key_points + model_response, keeps scenario/prompt", () => {
    const sc = {
      ...base("communication_sim"),
      scenario: "explain to a peer", prompt: "why two lobes?",
      key_points: [{ id: "k", text: "x", cues: ["couloir"] }],
      model_response: "imagine deux zones comme un couloir",
      rubric: { completeness: 0.6, evidence_quality: 0.2, tone: 0.2 },
    } as unknown as Scene;
    const pub = publicScene(sc) as Record<string, unknown>;
    expect(pub["scenario"]).toBe("explain to a peer");
    expect(pub["prompt"]).toBe("why two lobes?");
    expect("key_points" in pub).toBe(false);
    expect("model_response" in pub).toBe(false);
  });

  it("the centralized field list names every model_* reveal + the answer-key arrays", () => {
    // Guard so a future scene type that reuses these field names is covered automatically.
    for (const f of ["claims", "sound_claims", "key_points", "model_correction", "model_explanation", "model_answer", "model_prompt", "model_response"]) {
      expect(REDACTED_SCENE_FIELDS).toContain(f);
    }
  });
});

describe("publicScene — verdict deck projection", () => {
  const deckScene = {
    id: "s-deck", type: "spot_the_flaw", title: "T", objective_refs: [], concept_refs: ["c1"],
    estimated_seconds: 0, adaptation_hooks: [],
    flawed_content: "a flawed reading",
    claims: [{ id: "f1", text: "k is dimensionless", flaws_expected: ["dim"] }],
    sound_claims: [{ id: "s1", text: "k is a first-order rate" }],
    model_correction: "fix", rubric: { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 },
    verdict_deck: true,
  } as unknown as Scene;

  it("emits an opaque-token deck (claim texts only) while still stripping the answer keys", () => {
    const pub = publicScene(deckScene) as Record<string, unknown>;
    expect("claims" in pub).toBe(false);        // flawed answer key stripped
    expect("sound_claims" in pub).toBe(false);  // over-distrust answer key stripped
    const deck = pub["deck"] as Array<Record<string, unknown>>;
    expect(deck).toHaveLength(2);
    expect(deck.map((d) => d["text"]).sort()).toEqual(["k is a first-order rate", "k is dimensionless"]);
    for (const item of deck) {
      expect(Object.keys(item).sort()).toEqual(["text", "token"]); // NO `flawed` label leaks
    }
  });

  it("emits no deck when verdict_deck is not set", () => {
    const noFlag = { ...(deckScene as unknown as Record<string, unknown>), verdict_deck: false } as unknown as Scene;
    expect("deck" in (publicScene(noFlag) as Record<string, unknown>)).toBe(false);
  });
});

// SL-5: a scene may cite the passages it rests on (`evidence`, contract C2). On a graded scene a cited
// passage can state the answer, so the projection withholds the citations until the learner has
// answered — they come back with the verdict (citedSources). A reading keeps them: they ARE the text.
describe("publicScene — cited passages", () => {
  const EVIDENCE = {
    bibliographic_refs: [{
      perspicacite_doc_id: "p:src:1", title: "Cours", authors: [], excerpt: "La réponse est trois.",
      relevance_score: 1, prov_derived_from: "https://example.org/cours",
    }],
    abs_asset: { asset_type: "equation_latex", payload_inline: "x^2", prov_derived_from: "doi:x" },
    enrichment_metadata: { enricher_version: "1", perspicacite_mode_used: "passages", timestamp: "t", degraded: false },
  };

  it("withholds the citations of a graded scene and keeps its display asset", () => {
    const quiz = { ...base("quiz"), question: "?", choices: [{ id: "a", text: "A", correct: true }],
      feedback_correct: "y", feedback_incorrect: "n", hints: [], evidence: EVIDENCE } as unknown as Scene;
    const pub = publicScene(quiz) as Record<string, unknown>;
    expect(JSON.stringify(pub)).not.toContain("La réponse est trois.");
    expect((pub["evidence"] as Record<string, unknown>)["abs_asset"]).toEqual(EVIDENCE.abs_asset);
    expect("bibliographic_refs" in (pub["evidence"] as Record<string, unknown>)).toBe(false);
  });

  it("keeps the citations of a reading", () => {
    const concept = { ...base("concept"), markdown: "m", evidence: EVIDENCE } as unknown as Scene;
    expect((publicScene(concept) as Record<string, unknown>)["evidence"]).toEqual(EVIDENCE);
  });

  it("releases them after the answer as {title, quote, url}", () => {
    const quiz = { ...base("quiz"), evidence: EVIDENCE } as unknown as Scene;
    expect(citedSources(quiz)).toEqual([{ title: "Cours", quote: "La réponse est trois.", url: "https://example.org/cours" }]);
    expect(citedSources(base("quiz") as unknown as Scene)).toEqual([]);
  });

  it("carries a citation's licence with its title and URL", () => {
    const scene = { ...base("concept"), evidence: {
      ...EVIDENCE,
      bibliographic_refs: [{ ...EVIDENCE.bibliographic_refs[0], license: "CC BY-SA 4.0" }],
    } } as unknown as Scene;
    expect(citedSources(scene)).toEqual([{
      title: "Cours", quote: "La réponse est trois.", url: "https://example.org/cours", license: "CC BY-SA 4.0",
    }]);
  });
});
