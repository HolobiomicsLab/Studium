[English](README.md) · Français

# Fixtures

Les leçons, cours et entrées sur lesquels s'appuient les suites de tests, les démonstrations et un clone
neuf. Quand vous ouvrez Studium depuis un clone, ce dossier est le dossier de leçons par défaut
(`studium.bundlesRoot` dans VS Code, `BUNDLES_ROOT="$PWD/fixtures"` pour les serveurs). La plupart des
leçons sont en français.

| | |
|---|---|
| Statut | **maintenues** : modifier une fixture peut casser un test ailleurs |
| Lancer | diriger une surface vers ce dossier, par exemple `BUNDLES_ROOT="$PWD/fixtures"` |
| Tests | `.venv/bin/python -m pytest fixtures/<nom>` quand une fixture a ses propres tests ; les autres sont lues par les tests des paquets, des services et de l'extension |

Pour des exemples faits pour être lus et copiés, voir [`examples/`](../examples/README.fr.md).

## Leçons

| Fixture | Contenu | Utilisée par |
|---|---|---|
| [`atomistique-l1/`](atomistique-l1/README.md) | chimie L1, chapitre 1 (atomes, orbitales, périodicité) : 25 scènes avec orbitales interactives, spectre d'émission, tendances périodiques et molécules 3D | le cours par défaut de VS Code (`studium.bundleRef`) ; ses propres scripts `*_check.mjs` |
| `capsule-run-demo/` | reproduire un ajustement de décroissance au moment de l'apprentissage (2 scènes) | tests d'exécution de l'hôte de séance, serveur de leçons, pilote `extension-host` de VS Code |
| `capsule-loop-demo/` | l'exécuter, puis juger son propre résultat (3 scènes) | tests du serveur MCP et du graphe de cours |
| `capsule-debate-demo/` | débattre de ce que votre résultat permet de conclure (3 scènes) | démonstration seulement |
| [`capsule-judgment-demo/`](capsule-judgment-demo/README.md) | auditer une lecture erronée par une IA d'un vrai résultat d'ajustement (4 scènes), générée par `tools/build_capsule_judgment_demo.py` | tests du canal fichier, de l'adaptateur HTTP et de la langue de séance |
| [`metabo-judgment-demo/`](metabo-judgment-demo/README.md) | reproduire une annotation de métabolomique, puis auditer une lecture d'IA qui la surinterprète | tests de notation, démonstration littérature et tests de la visionneuse |
| `m3/demo-metabolomics/` | introduction à la métabolomique LC-MS (7 scènes), avec un bundle zippé | l'application Tauri gelée, le chargeur de bundle, `eval/run_eval.py --smoke` |
| [`m6/demo-atomistique/`](m6/demo-atomistique/README.md) | démo atomistique L1 (10 scènes), avec corpus et bundle | `tools/e2e-demo-m6.sh`, tests du catalogue et des bundles communautaires |

## Cours et entrées

| Fixture | Contenu | Utilisée par |
|---|---|---|
| `courses/decay-course.json` | un manifeste de cours qui enchaîne les démos de capsule avec leurs prérequis | `GET /courses` du serveur de leçons, la progression de cours du tableau de bord |
| `capsule-demo/` | une fiche de tâche ASB et un script pour un ajustement léger de décroissance d'ordre un | tests d'exécution, de confiance et d'attestation (hôte de séance, pilotes VS Code) |
| `m1/sample-corpus/` | un PDF, un fichier BibTeX et une liste de DOI d'exemple | tests du service d'ingestion |
| `m2/abs_capsule_minimal/` | une capsule ASB minimale (métadonnées RO-Crate, fiche de tâche) | tests de capsule de l'ingestion, du planner et de scene-synth |

`fixtures/data/` peut apparaître après avoir lancé une surface sur ce dossier : c'est un état
d'apprenant, ignoré par git, que vous pouvez supprimer.

## Ajouter une fixture

Placez une leçon dans `<nom>/lesson.json`, puis passez le lint et la validation :

```bash
node tools/bundle_lint.mjs fixtures/<nom>/lesson.json
node_modules/.pnpm/node_modules/.bin/tsx tools/bundle_validate.ts fixtures/<nom>/lesson.json
```

La [référence du bundle de leçon](../docs/reference/lesson-bundle.fr.md) décrit le format.
