import type { Unavailable } from "@/lib/api";

/**
 * What a panel shows when the collector has WITHDRAWN a surface (INT-STUDIUM-030).
 *
 * Deliberately not `SuppressedNotice`. Suppression is the k floor speaking about this cohort —
 * "too few people this time", and the same page serves numbers when the class is larger.
 * Unavailable is about the instrument: the route publishes nothing for anyone, and saying so
 * with the floor's words would tell a teacher their class is too small when it is not.
 *
 * The three states a reader must be able to tell apart on this page are "your class is too
 * small", "this measurement was never wired", and "these students have no trajectory". The
 * third is the one an empty chart silently asserts, which is why the empty chart is not an
 * option here.
 *
 * The `reason` is printed as the server wrote it, so the page cannot drift from the decision
 * the collector actually made — the same rule `SuppressedNotice` follows.
 */
export default function UnavailableNotice({ info }: { info: Unavailable }) {
  return (
    <section className="border border-slate-300 bg-slate-50 rounded p-4" role="note">
      <h3 className="font-semibold mb-1">Indicateur indisponible</h3>
      <p className="text-sm mb-2">{info.reason}</p>
      <p className="text-xs text-gray-600">
        Ce n’est pas un plancher d’effectif : la mesure n’est disponible pour{" "}
        <strong>aucune</strong> classe. Un graphique vide aurait laissé entendre que ces
        élèves n’ont pas de trajectoire, ce qui serait un énoncé sur eux plutôt que sur
        l’instrument.
      </p>
    </section>
  );
}
