// packages/lesson-session-host/src/shuffle-choices.ts
import type { LessonBundle } from "@studium/lesson-bundle-schema";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

// Deterministic 32-bit hash of a string (FNV-1a). Same scene id -> same seed, on every
// process/reload, so the permutation is reproducible (replay drivers and cross-learner
// item analytics stay aligned) without storing anything.
function seedFrom(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — a tiny seeded PRNG returning [0, 1). Deterministic given the seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Anti-answer-leak transform for quiz scenes.
 *
 * The author path (eval/harness/author.py) emits a quiz's choices with the correct
 * option FIRST and labels ids by position (a, b, c…), so the correct answer is always
 * "a" / always first. A learner can then ace any course by always picking "a" without
 * reading — destroying the assessment's validity. This is a property of EVERY authored
 * bundle, not one course.
 *
 * Fix: at bundle-load time, permute each quiz scene's choices with a PRNG seeded by the
 * scene id (deterministic + reproducible) and RE-LETTER the ids by their new display
 * position. The `correct` flag travels with the option's content, so:
 *   - the correct answer lands at a per-question-varying position/letter (no leak),
 *   - grading stays correct because graders look choices up by id against THIS same
 *     (permuted) scene — presentation and grading share one representation,
 *   - display labels remain clean sequential a/b/c for any client.
 *
 * Returns a new bundle; the input is not mutated.
 */
export function shuffleQuizChoices(bundle: LessonBundle): LessonBundle {
  const scenes = bundle.scenes.map((scene) => {
    if (scene.type !== "quiz" || !Array.isArray(scene.choices) || scene.choices.length < 2) {
      return scene;
    }
    const order = [...scene.choices];
    const rand = mulberry32(seedFrom(scene.id));
    // Fisher–Yates with the seeded PRNG.
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    const choices = order.map((c, idx) => ({ ...c, id: LETTERS[idx] ?? c.id }));
    return { ...scene, choices };
  });
  return { ...bundle, scenes };
}
