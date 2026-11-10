// packages/lesson-session-host/src/response-input-schema.ts  (shared zod for ResponseInput — DRY across drivers)
//
// One object with a `kind` and the optional fields the kinds take, checked per kind (HJ-7). The
// thirteen-branch union it replaces answered a missing field with "Invalid input" (MCP SDK 1.32) or a
// 13 KB dump of every branch's issues (older SDKs), and cost 3 KB of tool schema; this one names the
// field the kind needs in one line. The output is exactly what the union produced — only the fields
// the kind takes — plus `{kind: "reply", text}`, the learner's words as typed in a chat, which the
// host maps to the current scene's input (SessionHost.respond).
import { z } from "zod";
import type { ResponseInput } from "@studium/lesson-session";

/** The learner's reply as typed in a chat; the host turns it into the current scene's input. */
// A type alias, not an interface, so it stays assignable to Record<string, unknown> like ResponseInput.
export type ReplyInput = { kind: "reply"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 };
/** A quiz_choice that names no choice (lead decision I-4). The schema cannot list the displayed ids,
 * so it lets the input through and the host refuses it with them (reply-mapping checkDisplayedChoice). */
export type UnnamedQuizChoice = { kind: "quiz_choice"; confidence?: 0 | 1 | 2 | 3 | 4 };
/** What a driver may submit: an engine input, a chat reply the host maps to one, or an id-less
 * quiz_choice the host refuses. */
export type HostResponseInput = ResponseInput | ReplyInput | UnnamedQuizChoice;

/** Free-text kinds, by the scene type that takes them: see FREE_TEXT_KIND in operator-context.ts. */
const TEXT_KINDS = [
  "critique", "flaw_report", "explanation", "comparison", "summary_audit", "prompt_submission", "communication",
] as const;
export const RESPONSE_KINDS = ["ack", "quiz_choice", "confidence", "flaw_verdicts", ...TEXT_KINDS, "reply"] as const;
type ResponseKind = (typeof RESPONSE_KINDS)[number];

// Optional per-answer self-rated confidence (0..4) — capture-ready path to CONTINUOUS calibration (no
// UI supplies it yet; the live calibration input today is the meta-checkpoint). Any graded answer MAY
// carry it, and the engine then folds it into the concept's confidence_calibration that turn.
type Confidence = 0 | 1 | 2 | 3 | 4;
const confidenceValue = z.union(
  [z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)],
  { errorMap: () => ({ message: "a confidence is an integer from 0 to 4" }) },
);

const FlatResponseInput = z.object({
  kind: z.enum(RESPONSE_KINDS, {
    errorMap: () => ({ message: `kind must be one of ${RESPONSE_KINDS.join(", ")}` }),
  }).describe("reply {text, confidence?}: the learner's words, mapped to this scene's input; ack; quiz_choice {choiceId}; " +
    "confidence {value} or {pre, post}; flaw_verdicts {verdicts}; free text {text}: critique, flaw_report, " +
    "explanation, comparison, summary_audit, prompt_submission, communication"),
  choiceId: z.string().optional().describe("quiz_choice: a DISPLAYED choice id"),
  text: z.string().optional().describe("reply and free-text kinds: the learner's own words"),
  value: confidenceValue.optional().describe("confidence: 0 to 4"),
  pre: confidenceValue.optional(),
  post: confidenceValue.optional(),
  verdicts: z.array(z.object({ token: z.string(), flagged: z.boolean() })).optional()
    .describe("flaw_verdicts: one {token, flagged} per displayed deck token"),
  confidence: confidenceValue.optional().describe("optional, a graded answer: the learner's confidence 0 to 4"),
});
type Flat = z.infer<typeof FlatResponseInput>;

const isTextKind = (kind: ResponseKind): kind is (typeof TEXT_KINDS)[number] =>
  (TEXT_KINDS as readonly string[]).includes(kind);

/** Keep only the fields `input.kind` takes, or report the one it lacks. */
function toResponseInput(input: Flat, ctx: z.RefinementCtx): HostResponseInput {
  const missing = (field: string, what: string): never => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${input.kind} needs ${field} (${what})` });
    return z.NEVER;
  };
  const withConfidence = input.confidence === undefined ? {} : { confidence: input.confidence as Confidence };
  const kind = input.kind;
  if (kind === "ack") return { kind };
  if (kind === "quiz_choice") {
    // Without an id the host refuses it naming the displayed ids, which only the session knows (I-4).
    if (input.choiceId === undefined) return { kind, ...withConfidence };
    return { kind, choiceId: input.choiceId, ...withConfidence };
  }
  if (kind === "confidence") {
    if (input.value !== undefined) return { kind, value: input.value as Confidence };
    if (input.pre !== undefined && input.post !== undefined) return { kind, pre: input.pre as Confidence, post: input.post as Confidence };
    return missing(input.pre === undefined ? "value" : "post", "0 to 4; or pre and post, 0 to 4 each");
  }
  if (kind === "flaw_verdicts") {
    if (input.verdicts === undefined) return missing("verdicts", "one {token, flagged} per displayed deck token");
    return { kind, verdicts: input.verdicts, ...withConfidence };
  }
  if (input.text === undefined) return missing("text", kind === "reply" ? "the learner's reply" : "the learner's own words");
  if (kind === "reply") return { kind, text: input.text, ...withConfidence };
  if (isTextKind(kind)) return { kind, text: input.text, ...withConfidence };
  return z.NEVER; // unreachable: every kind is handled above
}

export const ResponseInputSchema = FlatResponseInput.transform(toResponseInput);
