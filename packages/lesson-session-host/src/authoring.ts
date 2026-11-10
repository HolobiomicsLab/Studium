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
import { frenchSpacing } from "../../lesson-session/src/phrases.js";

/** C5: whether an approval record (`approval.json` next to lesson.json, or the `approval.json` member
 * of a lesson .zip) exists and is bound to this exact lesson.json. The record is the only source of
 * the "validated" status (owner decision 2026-11-10); `validated_by` text never grants it. */
export interface ApprovalStatus {
  /** A well-formed `studium-approval/1` record naming its reviewer was found. */
  recorded: boolean;
  /** The record's bundle_sha256 equals the sha256 of the lesson.json bytes that were loaded. */
  matches: boolean;
  reviewer?: string;
  reviewed_at?: string;
}

/** The block on `Presentation.authoring`; `drafted_by` keeps a keyed verdict's provenance visible. */
export type AuthoringBlock = NonNullable<Presentation["authoring"]> & {
  drafted_by: DraftedBy;
  approval: ApprovalStatus;
};

/** C3: who drafted the lesson's content and keys. */
export type DraftedBy = "agent" | "learner" | "teacher";

/** `validated_by` placeholders written by the tools that build a lesson nobody approved. */
const UNVALIDATED_PREFIXES = ["DRAFT", "SELF-STUDY"] as const;

const OPEN_BOOK = {
  fr: "Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert). ",
  en: "Self-authored lesson: quiz and spot-the-flaw keys were written by the learner (open book). ",
};
const AGENT_DRAFTED = {
  fr: "Leçon rédigée par l'IA à partir de tes sources, non vérifiée par un enseignant : chaque question cite son " +
    "passage ; signale à l'agent une clé qui te semble fausse. ",
  en: "AI-drafted lesson from your sources, not checked by a teacher: each item cites its passage; tell the " +
    "assistant about a key that looks wrong. ",
};
/** Added when the lesson cites excerpts of a conversation with an AI assistant. */
const FROM_CONVERSATION = {
  fr: " Ses sources sont des extraits d'une conversation avec un assistant IA : ce que l'assistant y affirme " +
    "n'a pas été vérifié ; ce qui vient d'un fichier ou d'un résultat d'outil cité est une observation.",
  en: " Its sources are excerpts of a conversation with an AI assistant: what the assistant asserted there was " +
    "not checked; what comes from a quoted file or tool result is an observation.",
};
const CONVERSATION_PROVENANCE_PREFIX = "conversation:";
const NO_JUDGE = {
  fr: "Sans juge modèle, les scènes de production ne sont pas évaluées : compare ta réponse à la référence affichée " +
    "et note ton rappel ; cette note règle tes révisions, jamais ta maîtrise.",
  en: "Without a judge model, production scenes are not assessed: compare your answer with the provided reference and " +
    "rate your recall; that rating schedules your reviews and never changes your mastery.",
};
const WITH_JUDGE = {
  fr: "Les scènes de production sont évaluées par le modèle.",
  en: "Production scenes are assessed by the model.",
};
const REPRODUCTION_ASSESSMENT = {
  fr: "Les reproductions exécutées portent une évaluation externe.",
  en: "Executed reproductions carry an external assessment.",
};

function noticeTexts(prefix: { fr: string; en: string }) {
  return Object.freeze({
    fr: Object.freeze({
      without_judge: frenchSpacing(prefix.fr + NO_JUDGE.fr),
      with_judge: frenchSpacing(prefix.fr + WITH_JUDGE.fr),
    }),
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

/** Whether `validated_by` holds a DRAFT or SELF-STUDY placeholder. This is all the free text tells:
 * a name there grants nothing. Whether a lesson is validated is read from its approval record only
 * (`readApproval`, `approvalOfZip`, `authoringOf`). Used where a tool must recognise its own
 * placeholder, e.g. to refuse overwriting a lesson whose `validated_by` a person filled in. */
export function hasUnvalidatedPlaceholder(validatedBy: string): boolean {
  return UNVALIDATED_PREFIXES.some((prefix) => validatedBy.startsWith(prefix));
}

/**
 * Describe who wrote `bundle` for a host that has (`judge: true`) or lacks a judge model. Absent
 * `metadata.authoring` reads as a teacher bundle. `validated` is true only when an approval record
 * bound to this exact lesson.json was read (`approval.recorded && approval.matches`) and the lesson is
 * not a self-study one; `validated_by` text never grants it. A review session, which mixes lessons,
 * passes `approvedSources`: whether every lesson it draws from has such a record. `notice` is the
 * self-study notice for that drafter and judge setting, in French for a French bundle and in English
 * for any other language, null otherwise; `approval` is what the host read (none when not given).
 */
export function authoringOf(
  bundle: Pick<LessonBundle, "metadata"> & Partial<Pick<LessonBundle, "scenes" | "validated_by">>,
  host: { judge: boolean; approval?: ApprovalStatus; approvedSources?: boolean },
): AuthoringBlock {
  const mode = bundle.metadata.authoring?.mode ?? "teacher";
  const draftedBy = draftedByOf(bundle.metadata);
  const texts = draftedBy === "agent" ? AGENT_DRAFTED_NOTICE : SELF_STUDY_NOTICE;
  const locale = isFrench(bundle.metadata.language) ? "fr" : "en";
  const notices = texts[locale];
  const reproduction = bundle.scenes?.some((scene) => scene.type === "reproduction")
    ? ` ${REPRODUCTION_ASSESSMENT[locale]}` : "";
  const fromConversation = bundle.scenes?.some((scene) => (scene.evidence?.bibliographic_refs ?? [])
    .some((reference) => reference.prov_derived_from?.startsWith(CONVERSATION_PROVENANCE_PREFIX)))
    ? (locale === "fr" ? frenchSpacing(FROM_CONVERSATION.fr) : FROM_CONVERSATION.en) : "";
  return {
    mode,
    author_is_learner: bundle.metadata.authoring?.author_is_learner ?? false,
    drafted_by: draftedBy,
    validated: mode !== "self_study"
      && (host.approvedSources ?? (host.approval?.recorded === true && host.approval.matches === true)),
    judge: host.judge,
    notice: mode === "self_study"
      ? notices[host.judge ? "with_judge" : "without_judge"] + reproduction + fromConversation
      : null,
    approval: { ...(host.approval ?? NO_APPROVAL) },
  };
}

/** SEC-5-like bound on an approval record: it is a few hundred bytes; anything larger is not one. */
export const MAX_APPROVAL_BYTES = 64 * 1024;

/**
 * C5, read side: one approval record (`studium-approval/1`, written by `experience_packet.py
 * approve`) and whether its `bundle_sha256` is the sha256 of the lesson.json bytes that were loaded.
 * Fail-safe: unparsable JSON, another schema, a digest that is not a string, or a reviewer that is
 * not a non-empty string (`approve` always writes one) read as not recorded; a well-formed record
 * whose digest is not the sha256 of these bytes reads as recorded and not matching (stale).
 */
export function parseApproval(text: string, lessonSha256: string): ApprovalStatus {
  if (text.length > MAX_APPROVAL_BYTES) return { ...NO_APPROVAL };
  let record: unknown;
  try { record = JSON.parse(text); } catch { return { ...NO_APPROVAL }; }
  if (typeof record !== "object" || record === null || Array.isArray(record)) return { ...NO_APPROVAL };
  const r = record as Record<string, unknown>;
  const digest = r["bundle_sha256"];
  const reviewer = typeof r["reviewer"] === "string" ? r["reviewer"].trim() : "";
  if (r["schema"] !== "studium-approval/1" || typeof digest !== "string" || !reviewer) return { ...NO_APPROVAL };
  // Bounded: the record is a file anyone with write access to the library can edit.
  const status: ApprovalStatus = { recorded: true, matches: digest === lessonSha256, reviewer: reviewer.slice(0, 200) };
  if (typeof r["reviewed_at"] === "string") status.reviewed_at = r["reviewed_at"].slice(0, 64);
  return status;
}

/** C5: `<courseDir>/approval.json` read with `parseApproval`; none when either argument is null or
 * the file is missing or unreadable. */
export async function readApproval(courseDir: string | null, lessonSha256: string | null): Promise<ApprovalStatus> {
  if (courseDir === null || lessonSha256 === null) return { ...NO_APPROVAL };
  let text: string;
  try { text = await readFile(join(courseDir, "approval.json"), "utf8"); }
  catch { return { ...NO_APPROVAL }; }
  return parseApproval(text, lessonSha256);
}

/** C5 for a lesson .zip (a teacher's distribution, a community bundle): its `approval.json` member,
 * bound to the bytes of its `lesson.json` member. `approvalText` is null when the archive has none. */
export function approvalOfZip(approvalText: string | null, lessonSha256: string): ApprovalStatus {
  return approvalText === null ? { ...NO_APPROVAL } : parseApproval(approvalText, lessonSha256);
}

/** Same normalisation as the session's locale: the first two letters of the language tag. */
function isFrench(language: string): boolean {
  return language.trim().slice(0, 2).toLowerCase() === "fr";
}
