// packages/lesson-session-host/src/session-workspace.study-loop.test.ts
//
// The file channel (.studium-session/) and the study loop (sprint 2026-10-30, W2): a bare `{text}`
// on a quiz or a confidence checkpoint is read the way a chat reply is (HJ-4) instead of reaching
// the grader without a choice, and the passages a scene cites reach feedback.md after the answer,
// never task.md before it (SL-5).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";
import { SessionWorkspace } from "./session-workspace.js";

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "ws-study-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const base = (id: string, type: string) => ({
  id, type, title: `Scène ${id}`, objective_refs: [], concept_refs: ["c-signe"], estimated_seconds: 30, adaptation_hooks: [],
});
const BUNDLE = {
  schema_version: "1.4", bundle_id: "ws-study", source_plan_id: "p",
  metadata: { title: "Leçon fichier", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
  concepts: [{ id: "c-signe", title: "Signe", description: "d", bloom_level_target: "understand" }],
  scenes: [
    { ...base("s-q", "quiz"), question: "Le signe change-t-il ?",
      choices: [{ id: "a", text: "Oui", correct: true }, { id: "b", text: "Non", correct: false }],
      feedback_correct: "BRAVO-RÉVÉLÉ", feedback_incorrect: "RATÉ-RÉVÉLÉ", hints: [],
      evidence: {
        bibliographic_refs: [{ perspicacite_doc_id: "d1", doi: "10.1000/x", title: "Atkins", authors: ["Atkins"],
          excerpt: "PASSAGE-QUI-RÉPOND", relevance_score: 0.9, prov_derived_from: "kb:chimie" }],
        enrichment_metadata: { enricher_version: "1", perspicacite_mode_used: "passages", timestamp: "2026-10-01T00:00:00Z", degraded: false },
      } },
    { ...base("s-m", "meta_checkpoint"), pre_question: "Ta confiance ?", post_question: "Et maintenant ?",
      scale_labels: ["aucune", "faible", "moyenne", "bonne", "totale"] },
  ],
  rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
};

describe("SessionWorkspace and the study loop", () => {
  it("reads {text} on a quiz and a checkpoint as a reply, and cites the passage only after the answer", async () => {
    const root = tmp();
    writeFileSync(join(root, "lesson.json"), JSON.stringify(BUNDLE));
    const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
    const { sessionId, presentation } = await host.create("lesson.json", "ana");
    const right = (presentation.scene as unknown as { choices: Array<{ id: string; text: string }> }).choices.find((c) => c.text === "Oui")!.id;
    const dir = tmp();
    const ws = new SessionWorkspace(host, dir);

    await ws.writeStep(sessionId);
    const task = readFileSync(join(dir, "task.md"), "utf8");
    expect(task).toContain("Le signe change-t-il ?");
    for (const secret of ["PASSAGE-QUI-RÉPOND", "BRAVO-RÉVÉLÉ"]) expect(task).not.toContain(secret);

    writeFileSync(join(dir, "response.json"), JSON.stringify({ text: `réponse ${right}` }));
    expect((await ws.ingest(sessionId)).transition).toBe("next");
    const feedback = readFileSync(join(dir, "feedback.md"), "utf8");
    expect(feedback).toContain("BRAVO-RÉVÉLÉ");
    // L-5 requires non-breaking spaces inside French guillemets on every learner surface.
    expect(feedback).toContain("«\u00a0PASSAGE-QUI-RÉPOND\u00a0» — Atkins (https://doi.org/10.1000/x)");
    expect(host.getState(sessionId).history.find((h) => h.signal.kind === "answer_submitted")?.signal)
      .toMatchObject({ scene_id: "s-q", correct: true });

    writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "3 sur 4" }));
    await ws.ingest(sessionId);
    expect(host.getState(sessionId).history.some((h) => h.signal.kind === "confidence_declared")).toBe(true);
  });

  it("gives the last answer of a lesson its feedback and its sources too", async () => {
    const root = tmp();
    writeFileSync(join(root, "lesson.json"), JSON.stringify({ ...BUNDLE, scenes: [BUNDLE.scenes[0]] }));
    const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
    const { sessionId, presentation } = await host.create("lesson.json", "ana");
    const right = (presentation.scene as unknown as { choices: Array<{ id: string; text: string }> }).choices.find((c) => c.text === "Oui")!.id;
    const dir = tmp();
    const ws = new SessionWorkspace(host, dir);
    await ws.writeStep(sessionId);
    writeFileSync(join(dir, "response.json"), JSON.stringify({ kind: "quiz_choice", choiceId: right }));
    expect((await ws.ingest(sessionId)).done).toBe(true);
    const feedback = readFileSync(join(dir, "feedback.md"), "utf8");
    expect(feedback).toContain("BRAVO-RÉVÉLÉ");
    expect(feedback).toContain("PASSAGE-QUI-RÉPOND");
    // L-6 applies to the file surface too: one correct answer is practice, not consolidation.
    expect(feedback).toContain("Signe — Travaillée (1 réponse)");
    expect(feedback).not.toContain("consolidée");
  });

  it("prints a reading scene's source and licence in task.md", async () => {
    const root = tmp();
    const evidence = { bibliographic_refs: [{ perspicacite_doc_id: "d1", title: "Atkins", authors: ["Atkins"],
      excerpt: "PASSAGE-LISIBLE", relevance_score: 0.9, prov_derived_from: "https://example.org/chimie", license: "CC BY 4.0" }],
      enrichment_metadata: { enricher_version: "1", perspicacite_mode_used: "passages", timestamp: "2026-10-01T00:00:00Z", degraded: false } };
    writeFileSync(join(root, "lesson.json"), JSON.stringify({ ...BUNDLE,
      scenes: [{ ...base("s-r", "concept"), markdown: "Lis le passage.", evidence }] }));
    const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
    const { sessionId } = await host.create("lesson.json", "ana");
    const dir = tmp();
    await new SessionWorkspace(host, dir).writeStep(sessionId);
    expect(readFileSync(join(dir, "task.md"), "utf8"))
      .toContain("**Source**\n\n> «\u00a0PASSAGE-LISIBLE\u00a0» — Atkins (https://example.org/chimie), CC BY 4.0");
  });

  it("shows the stale teacher approval notice on the file channel's first screen", async () => {
    const root = tmp();
    writeFileSync(join(root, "lesson.json"), JSON.stringify(BUNDLE));
    writeFileSync(join(root, "approval.json"), JSON.stringify({ schema: "studium-approval/1", bundle_sha256: "old-bytes", reviewer: "Dr Example" }));
    const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
    const { sessionId } = await host.create("lesson.json", "ana");
    const dir = tmp();
    await new SessionWorkspace(host, dir).writeStep(sessionId);
    expect(readFileSync(join(dir, "task.md"), "utf8"))
      .toContain("Attention\u00a0: cette leçon a été modifiée depuis son approbation par l'enseignant.");
  });

  it("pauses for an explicit recall rating after an unjudged production answer (H6)", async () => {
    const explain = { ...base("s-e", "explain_back"), prompt: "Explique le changement de signe.",
      key_points: [{ id: "kp", text: "Le signe suit la phase.", cues: ["signe"] }],
      model_explanation: "Le signe change avec la phase.",
      rubric: { completeness: 1, evidence_quality: 1, tone: 1 } };
    const root = tmp();
    writeFileSync(join(root, "lesson.json"), JSON.stringify({ ...BUNDLE, scenes: [explain, BUNDLE.scenes[0]] }));
    const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
    const { sessionId } = await host.create("lesson.json", "ana");
    const dir = tmp();
    const ws = new SessionWorkspace(host, dir);
    await ws.writeStep(sessionId);
    writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "Le signe change." }));

    const answered = await ws.ingest(sessionId);
    expect(answered).toEqual({ done: false, transition: "awaiting_recall" });
    expect(await ws.pendingRecall(sessionId)).toEqual({ sceneId: "s-e" });
    const feedback = readFileSync(join(dir, "feedback.md"), "utf8");
    expect(feedback).toContain("Aucun juge ne l'a évaluée");
    expect(feedback).not.toMatch(/[✓✗]/);
    expect(feedback).toContain("je ne savais pas");
    expect(feedback).toContain('{\n  "kind": "recall",\n  "grade": "good"\n}');
    expect(readFileSync(join(dir, "task.md"), "utf8")).toContain('"kind": "recall"');

    writeFileSync(join(dir, "response.json"), JSON.stringify({ kind: "recall", grade: "good" }));
    const rated = await ws.ingest(sessionId);
    expect(rated).toEqual({ done: false, transition: "recall_rated" });
    expect(await ws.pendingRecall(sessionId)).toBeNull();
    expect(readFileSync(join(dir, "feedback.md"), "utf8")).toContain("Prochaine révision");
    expect(readFileSync(join(dir, "task.md"), "utf8")).toContain("Le signe change-t-il ?");
  });

  it("keeps a last-scene completion open until its requested recall rating is recorded (H6)", async () => {
    const explain = { ...base("s-e", "explain_back"), prompt: "Explique le changement de signe.",
      key_points: [{ id: "kp", text: "Le signe suit la phase.", cues: ["signe"] }],
      model_explanation: "Le signe change avec la phase.",
      rubric: { completeness: 1, evidence_quality: 1, tone: 1 } };
    const root = tmp();
    writeFileSync(join(root, "lesson.json"), JSON.stringify({ ...BUNDLE, scenes: [explain] }));
    const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
    const { sessionId } = await host.create("lesson.json", "ana");
    const dir = tmp();
    const ws = new SessionWorkspace(host, dir);
    await ws.writeStep(sessionId);
    writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "Le signe change." }));
    expect(await ws.ingest(sessionId)).toEqual({ done: false, transition: "awaiting_recall" });
    writeFileSync(join(dir, "response.json"), JSON.stringify({ kind: "recall", grade: "hard" }));
    expect(await ws.ingest(sessionId)).toEqual({ done: true, transition: "complete" });
    // A self-rating schedules a review without measuring mastery, including on the last scene.
    const completion = readFileSync(join(dir, "feedback.md"), "utf8");
    expect(completion).toContain("Signe — Pas encore mesurée");
    expect(completion).toContain("Prochaine révision");
    expect(completion).not.toContain("Aucune révision");
  });
});
