// packages/lesson-session/src/grading/active-learning-graders.test.ts
// spot_the_flaw + explain_back graders: reuse the CritiqueEvaluator port and degrade offline to the
// deterministic flaw/coverage matcher (the self-contained demo grades with no API key).
import { describe, it, expect } from "vitest";
import type { Scene } from "@studium/lesson-bundle-schema";
import { grade } from "./index.js";
import type { CritiqueEvaluator } from "../ports.js";
import { StubCritiqueEvaluator } from "../adapters/critique-evaluator.js";

const flawScene: Extract<Scene, { type: "spot_the_flaw" }> = {
  id: "flaw1", type: "spot_the_flaw", title: "t", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 60, adaptation_hooks: [],
  flawed_content: "N is 1s2 2s2 2p4 with paired electrons.",
  claims: [
    { id: "f-hund", text: "paired not parallel", flaws_expected: ["hund", "spin"] },
    { id: "f-count", text: "wrong count", flaws_expected: ["2p3"] },
  ],
  model_correction: "N is 1s2 2s2 2p3, Hund's rule, 3 unpaired.",
  rubric: { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 },
};

const explainScene: Extract<Scene, { type: "explain_back" }> = {
  id: "exp1", type: "explain_back", title: "t", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 60, adaptation_hooks: [],
  prompt: "Explain why the 2p has two lobes.",
  key_points: [
    { id: "kp1", text: "wavefunction", cues: ["fonction"] },
    { id: "kp2", text: "sign", cues: ["signe"] },
    { id: "kp3", text: "nodal plane", cues: ["nodal"] },
    { id: "kp4", text: "probability", cues: ["probab"] },
  ],
  model_explanation: "wavefunction changes sign across a nodal plane.",
  rubric: { completeness: 0.6, evidence_quality: 0.2, tone: 0.2 },
};

const pass: CritiqueEvaluator = { async evaluate() { return { score: 0.8, feedback: "good" }; } };
const fail: CritiqueEvaluator = { async evaluate() { return { score: 0.3, feedback: "weak" }; } };

describe("spot_the_flaw grader", () => {
  it("all flaws named + passing score → correct; critique_submitted + ai_audit_result", async () => {
    const r = await grade(flawScene, { kind: "flaw_report", text: "viole la regle de hund, spin paralleles, 2p3" }, { critiqueEvaluator: pass });
    expect(r.signal).toMatchObject({ kind: "answer_submitted", concept_id: "c1", correct: true, difficulty: 0.7 });
    expect(r.telemetry.map((e) => e.type)).toEqual(["critique_submitted", "ai_audit_result"]);
    expect(r.telemetry[0]).toMatchObject({ scene_type: "spot_the_flaw", llm_score: 0.8, completion_rate: 1 }); // 3/3 flaws matched
    expect(r.telemetry[1]).toMatchObject({ planted_errors: 3, true_positives: 3, missed: 0 });
  });

  it("Bloom level overrides the difficulty fallback", async () => {
    const r = await grade(flawScene, { kind: "flaw_report", text: "hund" }, { critiqueEvaluator: pass, bloomLevel: "apply" });
    expect(r.signal).toMatchObject({ difficulty: 0.6 }); // apply, not the 0.7 fallback
  });

  it("offline (Stub) is deterministic: empty answer → no flaws → correct:false", async () => {
    const r = await grade(flawScene, { kind: "flaw_report", text: "rien à signaler" }, { critiqueEvaluator: new StubCritiqueEvaluator() });
    expect(r.signal).toMatchObject({ correct: false });
    expect(r.telemetry[1]).toMatchObject({ true_positives: 0, missed: 3 });
  });

  it("rejects the wrong input kind", async () => {
    await expect(grade(flawScene, { kind: "critique", text: "x" }, { critiqueEvaluator: pass })).rejects.toThrow();
  });
});

describe("explain_back grader", () => {
  it("full coverage + passing score → correct; critique_submitted only (no ai_audit_result)", async () => {
    const r = await grade(explainScene, { kind: "explanation", text: "la fonction d'onde change de signe, plan nodal, probabilite nulle" }, { critiqueEvaluator: pass });
    expect(r.signal).toMatchObject({ kind: "answer_submitted", concept_id: "c1", correct: true, difficulty: 0.7 });
    expect(r.telemetry.map((e) => e.type)).toEqual(["critique_submitted"]);
    expect(r.telemetry[0]).toMatchObject({ scene_type: "explain_back", llm_score: 0.8, completion_rate: 1 }); // 4/4 key points covered
  });

  it("offline (Stub) scores by key-point coverage: half covered → 0.5 < 0.6 → correct:false", async () => {
    const r = await grade(explainScene, { kind: "explanation", text: "il y a une fonction et un signe" }, { critiqueEvaluator: new StubCritiqueEvaluator() });
    expect(r.telemetry[0]).toMatchObject({ completion_rate: 0.5 }); // fonction + signe = 2/4
    expect(r.signal).toMatchObject({ correct: false });
  });

  it("fail evaluator → correct:false even if coverage is high", async () => {
    const r = await grade(explainScene, { kind: "explanation", text: "fonction signe nodal probab" }, { critiqueEvaluator: fail });
    expect(r.signal).toMatchObject({ correct: false });
  });

  it("accepts the explanation kind and rejects a mismatched kind", async () => {
    const ok = await grade(explainScene, { kind: "explanation", text: "fonction signe nodal probab" }, { critiqueEvaluator: pass });
    expect(ok.signal).toMatchObject({ kind: "answer_submitted", correct: true });
    await expect(grade(explainScene, { kind: "quiz_choice", choiceId: "a" }, { critiqueEvaluator: pass })).rejects.toThrow();
  });
});

// --- wave-1 active-learning scenes -----------------------------------------

const comparisonScene: Extract<Scene, { type: "comparison" }> = {
  id: "cmp1", type: "comparison", title: "t", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 60, adaptation_hooks: [],
  prompt: "Relève la valeur ajoutée du cours enseignant.",
  artifact_a: "Cours IA.", artifact_b: "Cours enseignant.",
  key_points: [
    { id: "kp1", text: "exemple ancré", cues: ["exemple"] },
    { id: "kp2", text: "fil pédagogique", cues: ["fil"] },
  ],
  model_answer: "L'enseignant ajoute un exemple ancré et un fil.",
  rubric: { completeness: 0.6, evidence_quality: 0.2, tone: 0.2 },
};

const summaryAuditScene: Extract<Scene, { type: "summary_audit" }> = {
  id: "aud1", type: "summary_audit", title: "t", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 60, adaptation_hooks: [],
  source_content: "Le texte source mentionne la règle de Hund et le spin.",
  ai_summary: "Résumé qui oublie Hund.",
  claims: [
    { id: "o-hund", text: "omet Hund", flaws_expected: ["hund"] },
    { id: "o-spin", text: "omet le spin", flaws_expected: ["spin"] },
  ],
  model_correction: "Le résumé omet la règle de Hund et le spin.",
  rubric: { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 },
};

const promptPracticeScene: Extract<Scene, { type: "prompt_practice" }> = {
  id: "pp1", type: "prompt_practice", title: "t", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 60, adaptation_hooks: [],
  task: "Rédige un prompt pour expliquer Hund.",
  key_points: [
    { id: "kp1", text: "consigne claire", cues: ["consigne"] },
    { id: "kp2", text: "contexte", cues: ["contexte"] },
    { id: "kp3", text: "contrainte", cues: ["contrainte"] },
    { id: "kp4", text: "format de sortie", cues: ["format"] },
  ],
  model_prompt: "Tu es un tuteur. Consigne, contexte, contrainte, format.",
  rubric: { completeness: 0.6, evidence_quality: 0.2, tone: 0.2 },
};

describe("comparison grader", () => {
  it("full coverage + passing score → correct; critique_submitted only (no ai_audit_result)", async () => {
    const r = await grade(comparisonScene, { kind: "comparison", text: "il ajoute un exemple ancré et un fil pédagogique" }, { critiqueEvaluator: pass });
    expect(r.signal).toMatchObject({ kind: "answer_submitted", concept_id: "c1", correct: true, difficulty: 0.7 });
    expect(r.telemetry.map((e) => e.type)).toEqual(["critique_submitted"]);
    expect(r.telemetry[0]).toMatchObject({ scene_type: "comparison", llm_score: 0.8, completion_rate: 1 }); // 2/2 covered
  });

  it("offline (Stub) scores by key-point coverage: half covered → 0.5 < 0.6 → correct:false", async () => {
    const r = await grade(comparisonScene, { kind: "comparison", text: "juste un exemple" }, { critiqueEvaluator: new StubCritiqueEvaluator() });
    expect(r.telemetry[0]).toMatchObject({ completion_rate: 0.5 }); // exemple = 1/2
    expect(r.signal).toMatchObject({ correct: false });
  });

  it("Bloom level overrides the difficulty fallback; rejects the wrong input kind", async () => {
    const r = await grade(comparisonScene, { kind: "comparison", text: "exemple fil" }, { critiqueEvaluator: pass, bloomLevel: "evaluate" });
    expect(r.signal).toMatchObject({ difficulty: 0.8 });
    await expect(grade(comparisonScene, { kind: "explanation", text: "x" }, { critiqueEvaluator: pass })).rejects.toThrow();
  });
});

describe("summary_audit grader", () => {
  it("all omissions named + passing score → correct; critique_submitted + ai_audit_result", async () => {
    const r = await grade(summaryAuditScene, { kind: "summary_audit", text: "le résumé oublie la règle de hund et le spin" }, { critiqueEvaluator: pass });
    expect(r.signal).toMatchObject({ kind: "answer_submitted", concept_id: "c1", correct: true, difficulty: 0.7 });
    expect(r.telemetry.map((e) => e.type)).toEqual(["critique_submitted", "ai_audit_result"]);
    expect(r.telemetry[0]).toMatchObject({ scene_type: "summary_audit", llm_score: 0.8, completion_rate: 1 }); // 2/2 caught
    expect(r.telemetry[1]).toMatchObject({ planted_errors: 2, true_positives: 2, missed: 0 });
  });

  it("offline (Stub) is deterministic: empty answer → no catches → correct:false", async () => {
    const r = await grade(summaryAuditScene, { kind: "summary_audit", text: "rien à signaler" }, { critiqueEvaluator: new StubCritiqueEvaluator() });
    expect(r.signal).toMatchObject({ correct: false });
    expect(r.telemetry[1]).toMatchObject({ true_positives: 0, missed: 2 });
  });

  it("rejects the wrong input kind", async () => {
    await expect(grade(summaryAuditScene, { kind: "flaw_report", text: "x" }, { critiqueEvaluator: pass })).rejects.toThrow();
  });
});

const communicationSimScene: Extract<Scene, { type: "communication_sim" }> = {
  id: "com1", type: "communication_sim", title: "t", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 60, adaptation_hooks: [],
  scenario: "Un camarade de TD pas au point te demande de l'aide.",
  prompt: "Explique pourquoi la 2p a deux lobes, sans jargon.",
  key_points: [
    { id: "kp1", text: "deux zones", cues: ["deux zones"] },
    { id: "kp2", text: "sans jargon", cues: ["sans"] },
    { id: "kp3", text: "couloir vide", cues: ["ne passe jamais"] },
    { id: "kp4", text: "analogie", cues: ["comme"] },
  ],
  model_response: "Deux zones comme deux pièces, et au milieu l'électron ne passe jamais, sans formule.",
  rubric: { completeness: 0.6, evidence_quality: 0.2, tone: 0.2 },
};

describe("communication_sim grader", () => {
  it("full cue coverage + passing score → correct; critique_submitted only (no ai_audit_result)", async () => {
    const r = await grade(communicationSimScene, { kind: "communication", text: "deux zones, comme deux pièces, où l'électron ne passe jamais au milieu, et tout ça sans formule" }, { critiqueEvaluator: pass });
    expect(r.signal).toMatchObject({ kind: "answer_submitted", concept_id: "c1", correct: true, difficulty: 0.7 });
    expect(r.telemetry.map((e) => e.type)).toEqual(["critique_submitted"]);
    expect(r.telemetry[0]).toMatchObject({ scene_type: "communication_sim", llm_score: 0.8, completion_rate: 1 }); // 4/4 cues
  });

  it("offline (Stub) scores by cue coverage: half covered → 0.5 < 0.6 → correct:false", async () => {
    const r = await grade(communicationSimScene, { kind: "communication", text: "il y a deux zones, comme deux pièces" }, { critiqueEvaluator: new StubCritiqueEvaluator() });
    expect(r.telemetry[0]).toMatchObject({ completion_rate: 0.5 }); // "deux zones" + "comme" = 2/4
    expect(r.signal).toMatchObject({ correct: false });
  });

  it("fail evaluator → correct:false even if coverage is high; rejects the wrong input kind", async () => {
    const r = await grade(communicationSimScene, { kind: "communication", text: "deux zones comme ne passe jamais sans" }, { critiqueEvaluator: fail });
    expect(r.signal).toMatchObject({ correct: false });
    await expect(grade(communicationSimScene, { kind: "explanation", text: "x" }, { critiqueEvaluator: pass })).rejects.toThrow();
  });
});

describe("prompt_practice grader", () => {
  it("full cue coverage + passing score → correct; critique_submitted only (no ai_audit_result)", async () => {
    const r = await grade(promptPracticeScene, { kind: "prompt_submission", text: "consigne claire, contexte donné, contrainte de longueur, format markdown" }, { critiqueEvaluator: pass });
    expect(r.signal).toMatchObject({ kind: "answer_submitted", concept_id: "c1", correct: true, difficulty: 0.7 });
    expect(r.telemetry.map((e) => e.type)).toEqual(["critique_submitted"]);
    expect(r.telemetry[0]).toMatchObject({ scene_type: "prompt_practice", llm_score: 0.8, completion_rate: 1 }); // 4/4 cues
  });

  it("offline (Stub) scores by cue coverage: half covered → 0.5 < 0.6 → correct:false", async () => {
    const r = await grade(promptPracticeScene, { kind: "prompt_submission", text: "une consigne et un contexte" }, { critiqueEvaluator: new StubCritiqueEvaluator() });
    expect(r.telemetry[0]).toMatchObject({ completion_rate: 0.5 }); // consigne + contexte = 2/4
    expect(r.signal).toMatchObject({ correct: false });
  });

  it("fail evaluator → correct:false even if coverage is high; rejects the wrong input kind", async () => {
    const r = await grade(promptPracticeScene, { kind: "prompt_submission", text: "consigne contexte contrainte format" }, { critiqueEvaluator: fail });
    expect(r.signal).toMatchObject({ correct: false });
    await expect(grade(promptPracticeScene, { kind: "critique", text: "x" }, { critiqueEvaluator: pass })).rejects.toThrow();
  });
});
