// packages/lesson-session-host/src/authoring.ts
//
// Who wrote the lesson, stated the same way on every surface: the start_lesson_session response,
// the operator context (and so task.md), and each presentation the host serves (the pane reads it).
// Texts and prefixes come from spec 2026-10-30 « apprenant autonome » (Contrat commun).
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import type { Presentation } from "@studium/lesson-session";

/** `{ mode, author_is_learner, validated, judge, notice }`, the block on `Presentation.authoring`. */
export type AuthoringBlock = NonNullable<Presentation["authoring"]>;

/** `validated_by` placeholders that mean no teacher validated the bundle. */
const UNVALIDATED_PREFIXES = ["DRAFT", "SELF-STUDY"] as const;

const OPEN_BOOK = {
  fr: "Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert). ",
  en: "Self-authored lesson: quiz and spot-the-flaw keys were written by the learner (open book). ",
};

/** The learner-facing notice of a self-study lesson, fixed text, by locale and by whether a judge
 * model grades the production scenes (without one, `certifiedCorrect` certifies none of them). */
export const SELF_STUDY_NOTICE = Object.freeze({
  fr: Object.freeze({
    without_judge: OPEN_BOOK.fr + "Sans juge modèle, les scènes de production donnent un retour par mots-clés " +
      "sans évaluation certifiée ; seules les reproductions exécutées portent une évaluation externe.",
    with_judge: OPEN_BOOK.fr + "Les scènes de production, jugées par le modèle, et les reproductions exécutées " +
      "portent l'évaluation.",
  }),
  en: Object.freeze({
    without_judge: OPEN_BOOK.en + "Without a judge model, production scenes give keyword feedback with no " +
      "certified assessment; only executed reproductions carry an external assessment.",
    with_judge: OPEN_BOOK.en + "Production scenes, judged by the model, and executed reproductions carry the assessment.",
  }),
});

/**
 * Describe who wrote `bundle` for a host that has (`judge: true`) or lacks a judge model. Absent
 * `metadata.authoring` reads as a teacher bundle; `validated` is false when `validated_by` is a
 * DRAFT or SELF-STUDY placeholder; `notice` is the self-study notice for that judge setting, in
 * French for a French bundle and in English for any other language, null otherwise.
 */
export function authoringOf(
  bundle: Pick<LessonBundle, "metadata" | "validated_by">,
  host: { judge: boolean },
): AuthoringBlock {
  const mode = bundle.metadata.authoring?.mode ?? "teacher";
  const notices = SELF_STUDY_NOTICE[isFrench(bundle.metadata.language) ? "fr" : "en"];
  return {
    mode,
    author_is_learner: bundle.metadata.authoring?.author_is_learner ?? false,
    validated: !UNVALIDATED_PREFIXES.some((prefix) => bundle.validated_by.startsWith(prefix)),
    judge: host.judge,
    notice: mode === "self_study" ? notices[host.judge ? "with_judge" : "without_judge"] : null,
  };
}

/** Same normalisation as the session's locale: the first two letters of the language tag. */
function isFrench(language: string): boolean {
  return language.trim().slice(0, 2).toLowerCase() === "fr";
}
