/**
 * Le bundle que les harnais mettent en scène, et le rappel après navigation.
 *
 * Deux faits que les specs ont appris à leurs dépens (INT-STUDIUM-033) :
 *
 * 1. Depuis INT-STUDIUM-034 la bibliothèque liste un répertoire de bundles. Il n'y a plus de
 *    leçon intégrée à cliquer : une spec qui ne met aucun bundle en scène ouvre « Aucune leçon
 *    installée ». Le fichier lui-même est écrit par `tools/bake_demo_fresh.py`.
 * 2. `browser.url(...)` est une navigation document : elle détruit `window`, donc TOUT ce que
 *    le harnais y avait posé — `__test_bundle_path`, mais aussi `__telemetry_endpoint`,
 *    `__course_token` et le compteur `__emitted_count`. Une spec qui navigue puis lit un de ces
 *    hooks ne mesure pas ce qu'elle croit : elle lit une valeur que le rechargement vient de
 *    remettre à zéro, ou d'effacer.
 *
 * D'où un seul endroit qui définit le chemin, et une fonction à rappeler après chaque
 * navigation, plutôt que la même ligne recopiée dans neuf specs — dont une seule aurait été
 * corrigée le jour où le chemin change.
 */

/** `$STUDIUM_E2E_BUNDLE`, sinon `$BUNDLE_DIR/demo-fresh.zip`, sinon `/tmp/studium-e2e/…`. */
export const STAGED_BUNDLE =
  process.env.STUDIUM_E2E_BUNDLE ??
  `${process.env.BUNDLE_DIR ?? "/tmp/studium-e2e"}/demo-fresh.zip`;

/** Le minimum dont dépend `wdio.conf.ts` comme une spec : de quoi exécuter du JS dans la page. */
export type Executor = {
  execute: (fn: (path: string) => void, arg: string) => Promise<unknown>;
};

/** (Ré)installe `window.__test_bundle_path`. À appeler au démarrage ET après chaque navigation. */
export async function stageBundle(
  session: Executor,
  path: string = STAGED_BUNDLE,
): Promise<void> {
  await session.execute((p: string) => {
    (window as unknown as { __test_bundle_path?: string }).__test_bundle_path = p;
  }, path);
}
