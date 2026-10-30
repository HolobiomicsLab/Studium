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
    expect(feedback).toContain("« PASSAGE-QUI-RÉPOND » — Atkins (https://doi.org/10.1000/x)");
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
  });
});
