// packages/lesson-session-host/src/fsrs-memory.ts
//
// The FSRS scheduler the host uses: the adaptation engine's own module, not a copy (RT-3 — the host
// used to carry a "lockstep mirror" of it). Imported by file path because @studium/adaptation-engine
// is not yet a declared dependency of this package; host tests already import it the same way, and
// every runner of this TypeScript-source package (vitest, tsx, esbuild) resolves it. When this
// package.json declares the dependency, replace the path below with "@studium/adaptation-engine".
export {
  defaultMemoryState,
  retrievability,
  dueAt,
  isDue,
  reviewMemory,
  gradeFromAnswer,
  gradeFromSelfRating,
  reinforcementPriority,
  dueForReinforcement,
  SELF_RATING_GRADES,
  type ConceptMemoryState,
  type ReviewGrade,
  type SelfRating,
} from "../../adaptation-engine/src/fsrs.js";
