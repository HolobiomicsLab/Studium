import type { Suppressed } from "@/lib/api";

/**
 * What a panel shows when the collector withheld its numbers (INT-STUDIUM-005).
 *
 * The alternative — rendering an empty chart — is not neutral: a blank panel reads as "this
 * class has no hint requests", which is a claim, and a false one. So the suppressed state is
 * named.
 *
 * The `reason` is printed as the server wrote it, so this page cannot drift from the decision
 * the collector actually made. And the notice states the FLOOR, never the cohort: a panel
 * saying "3 learners — too few to report" would publish exactly the number the suppression
 * exists to withhold (INT-STUDIUM-030).
 */
export default function SuppressedNotice({ info }: { info: Suppressed }) {
  return (
    <section className="border border-amber-300 bg-amber-50 rounded p-4" role="note">
      <h3 className="font-semibold mb-1">Chiffres retenus — plancher d&apos;anonymat</h3>
      <p className="text-sm mb-2">{info.reason}</p>
      <p className="text-xs text-gray-600">
        Ce plancher ({info.min_learners} apprenant·e·s par leçon) est une{" "}
        <strong>retenue contre l&apos;identification</strong>, pas une garantie d&apos;anonymat :
        l&apos;enseignant·e connaît sa classe. Ce qu&apos;il garantit, c&apos;est que cet
        instrument ne devienne pas un rapport par élève — ni par accident, ni par filtrage, ni
        par lecture patiente au fil du trimestre.
      </p>
    </section>
  );
}
