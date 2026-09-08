// packages/lesson-bundle-schema/src/modulators.ts
//
// THE MODULATOR REGISTRY — the single source of truth for the M-series adaptation modulators.
//
// Historically the "M<n>" vocabulary was declared inconsistently in ≥4 places and described only in prose
// that contradicted itself (README, teacher-guide, planner comments), which is exactly what a reader —
// e.g. reviewing the principles section — trips over. This registry reconciles it, grounded in code.
//
// WHAT A MODULATOR IS (grounded): the engine NEVER branches on the modulator value — it matches rules on
// `when`/`action` and merely COPIES `rule.modulator` onto the emitted Decision, then surfaces it in
// explain()/telemetry (adaptation-engine/src/engine.ts:108-121, :145-152; learner-state never reads it).
// So a modulator is a DESCRIPTIVE / provenance tag naming the pedagogical intent of a rule — NOT a
// behaviour selector. Every definition here is therefore documentary.
//
// WHAT ACTUALLY FIRES (grounded in the rule fixtures + the graph router in lesson-session/src/session.ts):
//   M1 dominant, M3 once, M6 via graph routing. M2 is in the old enum but carried by ZERO rules (a ghost);
//   M4/M5 survive only in the legacy packages/lesson-schema and were never implemented as rule tags;
//   M7/M8 were never defined as modulators (every "M7"/"M8" string in the repo is a project-milestone
//   label — do NOT conflate that namespace with these modulators).
//
// The runtime ModulatorSchema is the ACTIVE set only, so a bundle can only tag a rule with a modulator the
// engine actually applies. The three other historical enum copies (learner-state Decision, the two Python
// mirrors) are kept literal and pinned to this registry by modulators.guard.test.ts.

import { z } from "zod";

export type ModulatorStatus = "active" | "retired";

export interface ModulatorDef {
  /** The M-series id. */
  readonly id: string;
  /** A short code-grounded descriptor. NOTE: where a name is a naming CHOICE (not pinned by code), that is
   *  flagged in `note` — the canonical pedagogical names are for the authoring trio to confirm. */
  readonly name: string;
  /** One-line definition, grounded in the rules that carry the modulator (or its historical status). */
  readonly definition: string;
  /** active = wired into the engine AND carried by ≥1 adaptation rule (it fires). retired = declared
   *  historically but never fires / never implemented as a modulator tag (kept for provenance + honesty). */
  readonly status: ModulatorStatus;
  /** Provenance / an open decision for the authoring trio (Élise / Tao / Isabelle). */
  readonly note?: string;
}

export const MODULATORS: readonly ModulatorDef[] = [
  {
    id: "M1",
    name: "mastery-adaptive pacing & routing",
    definition:
      "Routes on demonstrated competence: remediate (replay) on repeated same-concept errors, and " +
      "skip/accelerate past a concept once the mastery estimate is high — including graph-level skipping " +
      "of already-mastered concepts.",
    status: "active",
    note: "Behaviour solid (rule_2err_replay_concept, rule_mastery_high_skip, graph_skip_mastered); the " +
      "*label* is not pinned to a pedagogical name by any code.",
  },
  {
    id: "M2",
    name: "(unassigned)",
    definition: "No behaviour. Present in the old enum but carried by zero rules or decisions.",
    status: "retired",
    note: "A ghost: never emitted as a value anywhere (only the legacy scene example lists it). Decision " +
      "for the trio: leave retired, or assign it a real intervention.",
  },
  {
    id: "M3",
    name: "metacognitive calibration",
    definition:
      "When a learner's declared confidence diverges from their measured mastery beyond a threshold, " +
      "reveal the calibration panel so they confront over-/under-confidence.",
    status: "active",
    note: "Well-corroborated (rule_calibration_mismatch_show; engine + fixture + README all agree).",
  },
  {
    id: "M4",
    name: "(legacy)",
    definition: "Declared only in the legacy packages/lesson-schema; never implemented, never a rule tag.",
    status: "retired",
    note: "No code or comment assigns it a meaning. Decision for the trio: define or drop.",
  },
  {
    id: "M5",
    name: "anti-offloading",
    definition:
      "Hint use discounts the mastery credit of the eventual answer, so leaning on AI does not inflate the " +
      "competence estimate. Implemented as a cross-cutting ENGINE INVARIANT, not carried as a modulator tag.",
    status: "retired",
    note: "The behaviour is live (adaptation-engine beta-updater/fsrs, lesson-session-host host.ts) and " +
      "consistently DOCUMENTED as 'M5 anti-offloading' (README, planner comments) — but it is not emitted " +
      "as a modulator value. Decision for the trio: promote M5 into the tag vocabulary, or keep it an " +
      "engine invariant and stop calling it a modulator.",
  },
  {
    id: "M6",
    name: "prerequisite-gated remediation routing",
    definition:
      "Structural navigation of the prerequisite graph: gate a concept behind unmet prerequisites, and " +
      "after repeated remediation escalate one-way to a more heavily-scaffolded 'universe' (lower θ).",
    status: "active",
    note: "Behaviour solid (graph_prereq_gate, graph_universe_escalated in lesson-session/src/session.ts). " +
      "CONFLICT to resolve: README:71 labels M6 'explicability', which the code contradicts — no M6-tagged " +
      "path does explicability (that is a UI affordance). Name pending trio confirmation.",
  },
  // M7, M8: intentionally absent — never defined as modulators in code. Every "M7"/"M8" string in the repo
  // is a project-MILESTONE label (a separate namespace). Do not add them here without a real intervention.
] as const;

/** The ACTIVE modulator ids — the runtime vocabulary. Kept as a literal tuple so zod infers the union
 *  type ("M1" | "M3" | "M6"); modulators.guard.test.ts asserts this equals the registry's active filter. */
export const ACTIVE_MODULATOR_IDS = ["M1", "M3", "M6"] as const;

/** The runtime enum: a rule may only be tagged with a modulator the engine actually applies. */
export const ModulatorSchema = z.enum(ACTIVE_MODULATOR_IDS);
export type Modulator = z.infer<typeof ModulatorSchema>;

/** Convenience: the active ids as a plain string[] (for guards / doc generation). */
export const ACTIVE_MODULATORS: readonly string[] = [...ACTIVE_MODULATOR_IDS];
