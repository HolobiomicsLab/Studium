/**
 * The line every judgement metric carries (INT-STUDIUM-030).
 *
 * Trust calibration, over-trust, over-distrust and autonomy are *characterological* readings —
 * they describe how someone judges, not what they got right. Shown to a reader who already
 * holds the roster, such a number invites attribution whether or not the surface offers a
 * filter. So the surface says, in words, what the number is and is not.
 *
 * It replaces the copy that used to sit in this position on the calibration pages: « Astuce :
 * ajouter `?learner=<pseudonyme>` à l'URL pour filtrer sur un·e apprenant·e. » Removing the
 * drill-down and leaving the space blank would have been a quieter change than the one
 * actually made.
 */
export default function NonAttribution() {
  return (
    <p className="mt-6 text-xs text-gray-600" role="note">
      Lecture <strong>de classe</strong>, calculée sur les contributeurs de cette leçon. Ce
      n’est pas un énoncé sur un·e élève en particulier, et le tableau de bord n’offre aucun
      filtre par apprenant·e : un plancher que l’on peut contourner en filtrant n’en est pas un.
    </p>
  );
}
