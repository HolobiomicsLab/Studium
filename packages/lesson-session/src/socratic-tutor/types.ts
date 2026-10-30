// types.ts
import type { ReasoningSignal } from "@studium/reasoning-scorer";
import type { Locale } from "../phrases.js";

export type TutorMoveKind =
  | "invite_test" | "acknowledge_extend" | "redirect_question"
  | "probe_justification" | "probe_synthesis" | "scaffold_hint";

export interface TutorMove {
  text: string;
  move_kind: TutorMoveKind;
  revealed: boolean; // LLM self-report — ADVISORY ONLY (the deterministic guardrail is ground truth)
}

export interface TutorInput {
  topic: string;
  seedClaim: string;
  learnerTurn: string;
  signal: ReasoningSignal;
  confidence: number;
  history: { role: "learner" | "tutor"; text: string }[];
  /** The lesson's language (RT-9): the tutor replies in it. The session always sets it; a caller
   * that omits it gets the historical French. */
  locale?: Locale;
}
