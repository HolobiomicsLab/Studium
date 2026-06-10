// apps/lesson-server/src/test-support.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const _dirs: string[] = [];
export function cleanupTmp(): void { for (const d of _dirs.splice(0)) rmSync(d, { recursive: true, force: true }); }

export const MINI_BUNDLE = {
  schema_version: "1.4", bundle_id: "mini-001", source_plan_id: "p",
  metadata: { title: "M", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [
    { id: "s0", type: "intro", title: "I", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "hi" },
    { id: "s1", type: "quiz", title: "Q", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
      question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }], feedback_correct: "y", feedback_incorrect: "n", hints: [] },
    { id: "s2", type: "meta_checkpoint", title: "MC", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
      pre_question: "p", post_question: "q", scale_labels: ["1", "2", "3", "4", "5"] },
  ],
  rules: [], validated_by: "teacher", validated_at: "2026-06-10T08:00:00Z",
};

export function writeMiniBundle(): { root: string; ref: string } {
  const root = mkdtempSync(join(tmpdir(), "ls-srv-")); _dirs.push(root);
  writeFileSync(join(root, "mini.json"), JSON.stringify(MINI_BUNDLE));
  return { root, ref: "mini.json" };
}
