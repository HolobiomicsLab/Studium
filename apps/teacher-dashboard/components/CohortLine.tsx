import type { Judgement } from "@/lib/api";

/**
 * The two halves of INT-STUDIUM-030 R1 as a teacher reads them: the population a published
 * number was computed over, and the fact that some populations were too small to publish.
 *
 * They live in one file because they are one rule. A panel that shows the band but not the
 * withholding reads as a complete class picture over a partial one; a panel that shows the
 * withholding but not the band says a reading is missing without saying whose the shown one is.
 *
 * NEITHER prints a count of people. The band is the whole point — `5–9` instead of `7` — and
 * the withheld state is a boolean all the way from `metrics.Population` to this markup, so
 * there is nowhere on the path where the number could be picked back up.
 */

/**
 * French renderings of the collector's counting rule, keyed on the sentence it actually sends.
 *
 * A translation is a fourth copy of a sentence that already exists in `metrics.NON_ATTRIBUTION`
 * and `Population.counts_note`, and copies drift (the TS/Py `over_distrust` divergence is the
 * precedent in this repo). The key is the server's exact string, so a wording change upstream
 * misses the map and falls through to `renderCounts`'s verbatim branch: the reader then sees
 * the collector's own English rather than a French claim that no longer matches the number.
 * Stale-and-fluent is the failure this shape refuses.
 */
const COUNTS_FR: Record<string, string> = {
  "distinct learners within one lesson":
    "apprenant·e·s distinct·e·s au sein d’une même leçon",
  "learner-lesson pairs across the lessons in scope":
    "paires apprenant·e–leçon, réparties sur plusieurs leçons — un pseudonyme " +
    "est salé par leçon, donc l’union ne compte pas des personnes",
  "no population: at least one counted event carries no learner_pseudonym or no lesson_id":
    "population non établie : au moins un événement compté ne porte pas de " +
    "learner_pseudonym, ou pas de lesson_id",
  "no contributors: this number was computed over nobody":
    "aucun contributeur : ce nombre a été calculé sur personne",
};

function renderCounts(counts: string): string {
  return COUNTS_FR[counts] ?? counts;
}

type Props = { judgement: Judgement; className?: string };

export default function CohortLine({ judgement, className }: Props) {
  const counts = renderCounts(judgement.cohort_counts);
  return (
    <p className={`context-note context-note--compact ${className ?? ""}`} data-testid="cohort-line">
      {judgement.cohort_band !== null ? (
        <>
          Calcul&eacute; sur une cohorte de{" "}
          <strong className="tabular-nums">{judgement.cohort_band}</strong> {counts}.
        </>
      ) : (
        <>Population de ce nombre : {counts}.</>
      )}
    </p>
  );
}

/**
 * Shown when the collector dropped rows whose own contributors fell under the floor.
 *
 * It takes no props, and that is deliberate: there is no count to pass. The payload carries a
 * boolean, so the most this component could ever say is *that* something was withheld.
 */
export function WithheldNotice({ className }: { className?: string }) {
  return (
    <p
      className={`withheld-note ${className ?? ""}`}
      role="note"
      data-testid="withheld-notice"
    >
      Lecture incompl&egrave;te : des lignes ne sont pas publi&eacute;es, parce que les
      apprenant&middot;e&middot;s qui les ont aliment&eacute;es sont moins nombreux&middot;ses
      que le plancher dans au moins une le&ccedil;on. Ni lesquelles, ni combien : ce nombre est
      exactement ce que le plancher retient.
    </p>
  );
}
