// packages/lesson-session-host/src/authoring.ts
//
// Who wrote the lesson, stated the same way on every surface: the start_lesson_session response,
// the operator context (and so task.md), and each presentation the host serves (the pane reads it).
// Texts and prefixes come from spec 2026-10-30 « apprenant autonome » (Contrat commun), as revised
// by the production sprint of the same day: C3 (an agent-drafted variant), C5 (the approval record)
// and D5 (without a judge, the notice states that a self-rating schedules reviews, never mastery).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import type { Presentation } from "@studium/lesson-session";

/** C5: whether `<course>/approval.json` exists and is bound to this exact lesson.json. */
export interface ApprovalStatus {
  recorded: boolean;
  /** The record's bundle_sha256 equals the sha256 of the lesson.json bytes that were loaded. */
  matches: boolean;
  reviewer?: string;
  reviewed_at?: string;
}

/** `{ mode, author_is_learner, validated, judge, notice, approval }`, the block on `Presentation.authoring`. */
export type AuthoringBlock = NonNullable<Presentation["authoring"]> & { approval: ApprovalStatus };

/** C3: who drafted the lesson's content and keys. */
export type DraftedBy = "agent" | "learner" | "teacher";

/** `validated_by` placeholders that mean no teacher validated the bundle. */
const UNVALIDATED_PREFIXES = ["DRAFT", "SELF-STUDY"] as const;

const OPEN_BOOK = {
  fr: "Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert). ",
  en: "Self-authored lesson: quiz and spot-the-flaw keys were written by the learner (open book). ",
};
const AGENT_DRAFTED = {
  fr: "Leçon rédigée par l'IA à partir de vos sources, non vérifiée par un enseignant : chaque question cite son " +
    "passage ; contestez une clé qui vous semble fausse. ",
  en: "AI-drafted lesson from your sources, not checked by a teacher: each item cites its passage; challenge any " +
    "key you think is wrong. ",
};
const NO_JUDGE = {
  fr: "Sans juge modèle, les scènes de production ne sont pas évaluées : comparez votre réponse à la réponse modèle " +
    "et notez votre rappel ; cette note règle vos révisions, jamais votre maîtrise. Seules les reproductions " +
    "exécutées portent une évaluation externe.",
  en: "Without a judge model, production scenes are not assessed: compare your answer with the model answer and " +
    "rate your recall; that rating schedules your reviews and never changes your mastery. Only executed " +
    "reproductions carry an external assessment.",
};
const WITH_JUDGE = {
  fr: "Les scènes de production, jugées par le modèle, et les reproductions exécutées portent l'évaluation.",
  en: "Production scenes, judged by the model, and executed reproductions carry the assessment.",
};

function noticeTexts(prefix: { fr: string; en: string }) {
  return Object.freeze({
    fr: Object.freeze({ without_judge: prefix.fr + NO_JUDGE.fr, with_judge: prefix.fr + WITH_JUDGE.fr }),
    en: Object.freeze({ without_judge: prefix.en + NO_JUDGE.en, with_judge: prefix.en + WITH_JUDGE.en }),
  });
}

/** The learner-facing notice of a self-study lesson the learner drafted, by locale and by whether a
 * judge model grades the production scenes (without one, `certifiedCorrect` certifies none of them). */
export const SELF_STUDY_NOTICE = noticeTexts(OPEN_BOOK);
/** C3: the notice of a self-study lesson an agent drafted from the learner's sources. */
export const AGENT_DRAFTED_NOTICE = noticeTexts(AGENT_DRAFTED);

const NO_APPROVAL: ApprovalStatus = Object.freeze({ recorded: false, matches: false });

/** C3: `metadata.authoring.drafted_by` when set, else by mode — a self-study lesson was drafted by
 * the learner (the bundles built before C3), anything else by a teacher. Read without relying on
 * the schema declaring the field, so older schema builds that strip it fall back to the mode. */
export function draftedByOf(metadata: Pick<LessonBundle["metadata"], "authoring">): DraftedBy {
  const authoring = metadata.authoring as ({ drafted_by?: unknown } & NonNullable<typeof metadata.authoring>) | undefined;
  const declared = authoring?.drafted_by;
  if (declared === "agent" || declared === "learner" || declared === "teacher") return declared;
  return authoring?.mode === "self_study" ? "learner" : "teacher";
}

/** False when `validated_by` is a DRAFT or SELF-STUDY placeholder. */
export function isTeacherValidated(validatedBy: string): boolean {
  return !UNVALIDATED_PREFIXES.some((prefix) => validatedBy.startsWith(prefix));
}

/**
 * Describe who wrote `bundle` for a host that has (`judge: true`) or lacks a judge model. Absent
 * `metadata.authoring` reads as a teacher bundle; `validated` is false when `validated_by` is a
 * DRAFT or SELF-STUDY placeholder; `notice` is the self-study notice for that drafter and judge
 * setting, in French for a French bundle and in English for any other language, null otherwise;
 * `approval` is what the host read next to the lesson (none when not given).
 */
export function authoringOf(
  bundle: Pick<LessonBundle, "metadata" | "validated_by">,
  host: { judge: boolean; approval?: ApprovalStatus },
): AuthoringBlock {
  const mode = bundle.metadata.authoring?.mode ?? "teacher";
  const texts = draftedByOf(bundle.metadata) === "agent" ? AGENT_DRAFTED_NOTICE : SELF_STUDY_NOTICE;
  const notices = texts[isFrench(bundle.metadata.language) ? "fr" : "en"];
  return {
    mode,
    author_is_learner: bundle.metadata.authoring?.author_is_learner ?? false,
    validated: isTeacherValidated(bundle.validated_by),
    judge: host.judge,
    notice: mode === "self_study" ? notices[host.judge ? "with_judge" : "without_judge"] : null,
    approval: { ...(host.approval ?? NO_APPROVAL) },
  };
}

/**
 * C5, read side: `<courseDir>/approval.json` (`studium-approval/1`, written by
 * `experience_packet.py approve`) and whether its `bundle_sha256` is the sha256 of the lesson.json
 * that was loaded. Fail-safe: a missing, unreadable or foreign record reads as not recorded.
 */
export async function readApproval(courseDir: string | null, lessonSha256: string | null): Promise<ApprovalStatus> {
  if (courseDir === null || lessonSha256 === null) return { ...NO_APPROVAL };
  let record: unknown;
  try { record = JSON.parse(await readFile(join(courseDir, "approval.json"), "utf8")); }
  catch { return { ...NO_APPROVAL }; }
  if (typeof record !== "object" || record === null) return { ...NO_APPROVAL };
  const r = record as Record<string, unknown>;
  if (r["schema"] !== "studium-approval/1" || typeof r["bundle_sha256"] !== "string") return { ...NO_APPROVAL };
  const status: ApprovalStatus = { recorded: true, matches: r["bundle_sha256"] === lessonSha256 };
  // Bounded: the record is a file anyone with write access to the library can edit.
  if (typeof r["reviewer"] === "string") status.reviewer = r["reviewer"].slice(0, 200);
  if (typeof r["reviewed_at"] === "string") status.reviewed_at = r["reviewed_at"].slice(0, 64);
  return status;
}

/** Same normalisation as the session's locale: the first two letters of the language tag. */
function isFrench(language: string): boolean {
  return language.trim().slice(0, 2).toLowerCase() === "fr";
}
