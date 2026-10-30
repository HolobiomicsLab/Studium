[English](README.md) · Français

# Banc d'évaluation de Studium

Un banc d'évaluation sans interface qui prend de vrais supports de cours universitaires, en tire une
leçon, la fait jouer par des étudiants simulés et audite à la fois le cours et la séance. Il produit un
rapport noté avec des constats : après une modification de Studium, on relance et on compare. Il mesure
si un cours généré est structurellement sain (les prérequis bloquent, pas de répétition du même item,
pseudonymes distincts) ; il ne mesure pas si les étudiants apprennent.

| | |
|---|---|
| Statut | **maintenu** (instrument de recherche) |
| Lancer | `.venv/bin/python eval/run_eval.py --smoke` (hors ligne), `--corpus <id>` (un support) |
| Port | aucun |
| Appelle | rien par défaut ; la ligne de commande `claude` dans les modes `claude`, LiteLLM avec `--live`, Perspicacité quand l'ancrage le trouve |
| Tests | `.venv/bin/python -m pytest eval/tests -q` |

Python s'exécute dans le `.venv` du dépôt ; le moteur de leçon est le paquet `@studium/lesson-session`
du dépôt, piloté depuis Node : `pnpm install` doit avoir été lancé à la racine.

## Le lancer

Depuis la racine du dépôt :

```bash
# essai hors ligne sur la fixture m3 du dépôt : pas d'auteur, pas de clé
.venv/bin/python eval/run_eval.py --smoke

# lister les supports du corpus (demande le corpus local, voir plus bas)
.venv/bin/python eval/run_eval.py --list

# évaluation complète d'un support : auteur déterministe, cinq personas, audit, rapport
.venv/bin/python eval/run_eval.py --corpus 04

# en direct : auteur Claude, correcteurs réels et passage d'un auditeur Claude d'un autre modèle
.venv/bin/python eval/run_eval.py --corpus 04 --author claude --live --audit-llm --audit-model sonnet

# tous les supports
.venv/bin/python eval/run_eval.py --all
```

| Option | Rôle |
|---|---|
| `--author deterministic` (défaut) ou `claude` | auteur structurel sans clé, ou création en direct par la ligne de commande `claude` |
| `--personas …` | étudiants simulés à faire jouer (par défaut : les cinq personas déterministes) |
| `--live` | correcteurs LLM réels au lieu de bouchons (demande `LITELLM_*` ou la route de critique de scene-synth) |
| `--audit-llm`, `--audit-model` | ajouter un passage d'auditeur Claude ; un modèle d'audit distinct évite un angle mort partagé avec l'auteur |
| `--model` | modèle de l'auteur et de l'étudiant Claude |
| `--refine-from <dossier>` | recréer la leçon à partir des constats d'une évaluation précédente |
| `--ground auto` (défaut), `corpus`, `literature`, `mock`, `off` | comment arêtes et scènes sont ancrées dans des citations ; `auto` utilise la recherche bibliographique en direct si le serveur Perspicacité répond, sinon les passages du cours lui-même, et n'invente jamais |

### Le corpus

`eval/corpus/` contient des ressources éducatives libres de tiers et est ignoré par git (certaines sont
sous tous droits réservés). Il vit dans le dépôt séparé `studium_eval` et se lie ou se copie ici, avec
son `manifest.json` ; dans un clone neuf, seul `--smoke` fonctionne tant que le corpus n'est pas en place.

## Sorties

Chaque évaluation écrit `eval/reports/<corpus>-<mode>-<horodatage>/` (ignoré par git ; il peut contenir
du contenu dérivé du corpus et un état par apprenant) :

```
<run>/
  <id>-bundle.zip           # le bundle de leçon créé (lesson.json + prov.json)
  author_provenance.json    # mode, modèle, empreinte et faits structurels de l'auteur
  sessions/<persona>/       # un dossier par étudiant simulé : driver_result.json, events.jsonl,
                            #   telemetry.jsonl, state/
  audit.json                # scores de la grille, constats, signaux par persona
  report.md                 # rapport lisible avec les retours d'amélioration
  refinement_feedback.json  # constats rattachés au backlog de conception
```

L'[Observatory](../services/observatory/README.fr.md) affiche ces évaluations sous `/eval/runs/<id>`.

## Les quatre étapes

1. **Création** ([`harness/author.py`](harness/author.py)) : du Markdown du corpus à un bundle valide,
   avec un graphe de parcours (chaîne de prérequis, univers de base et de remédiation) dont les
   identifiants de notions correspondent aux scènes, pour que le blocage par prérequis et l'escalade
   d'univers se déclenchent vraiment. L'auteur déterministe reprend mot pour mot le texte des sections du
   corpus et marque ses questions de quiz préfabriquées comme synthétiques, pour que l'auditeur ne les
   crédite jamais. Les deux auteurs passent par `services/scene-synth/bundler.build_bundle` et échouent
   bruyamment à la moindre violation de schéma ou d'alignement.
2. **Pilotage** ([`harness/drive_session.mjs`](harness/drive_session.mjs)) : exécute `LessonSession` dans
   le processus. À chaque tour, la politique de l'étudiant voit la scène affichée avant de répondre.
   Chaque persona écrit un état durable dans son propre dossier, avec son propre secret de pseudonyme.
3. **Audit** ([`harness/audit.py`](harness/audit.py)) : un auditeur heuristique sans clé note huit
   dimensions ; l'auditeur Claude facultatif ajoute un récit et des constats, fusionnés, sans jamais
   remplacer les signaux objectifs.
4. **Rapport** ([`harness/report.py`](harness/report.py)) : `report.md` et `refinement_feedback.json`.

## Étudiants simulés

| Persona | Comportement | Ce qu'il exerce |
|---|---|---|
| `proficient` | juste, confiance élevée et calibrée, critiques complètes | progression sans accroc, maîtrise atteinte |
| `struggling` | se trompe aux premières rencontres d'une notion, confiance basse, puis juste | répétition, blocage par prérequis, escalade d'univers |
| `overconfident` | une erreur avec une confiance maximale, puis juste | décalage de calibration |
| `hint_reliant` | consomme tous les indices rédigés avant de répondre | décote anti-délégation, autonomie inférieure à 1 |
| `misconception` | choisit toujours le même mauvais distracteur et demande des indices | une signature d'erreur distincte |
| `claude` | un étudiant en direct par la ligne de commande `claude`, avec un repli sûr | comportement libre ; un tour mal formé est noté comme dégradé |

## Dimensions de l'audit

Chaque score est compris entre 0 et 1 ; chaque constat porte une dimension, une gravité, un résumé, un
chemin de preuve et une référence au backlog.

| Dimension | Question |
|---|---|
| `pedagogical_soundness` | le niveau de Bloom progresse-t-il ; la remédiation propose-t-elle un autre item que le même |
| `grounding_citations` | les arêtes du graphe et les scènes de notion s'appuient-elles sur des preuves citables |
| `adaptivity` | les décisions divergent-elles selon les personas ; blocage et escalade se déclenchent-ils |
| `anti_offloading` | le ratio d'autonomie reflète-t-il indices et répétitions ; les critiques sont-elles auditées |
| `rgpd` | pseudonymes par apprenant, aucun identifiant brut dans la télémétrie, un oubli qui fonctionne |
| `mastery_validity` | la maîtrise est-elle acquise sur des items distincts |
| `assessment_quality` | qualité des quiz : énoncés et distracteurs distincts, assez d'items par notion, une seule bonne réponse |
| `retention` | quelle part de la maîtrise acquise survit à un intervalle simulé de sept jours (courbe FSRS) |

Les non-objectifs déclarés (reproduction inerte, discussion hors ligne) sont signalés comme constats
`info`, jamais notés comme défauts. L'auditeur note la présence des citations, pas leur pertinence ; la
suite de validité ci-dessous couvre cet angle mort.

## Autres instruments

| Commande | Rôle |
|---|---|
| `.venv/bin/python eval/harness/scene_judge.py <lesson.json> --out <dossier du cours>` | un juge LLM du contenu de chaque scène, avec des verdicts discrets et un scénario d'échec obligatoire ; `--calibrate` vérifie la séparation sur des scènes volontairement corrompues. Les résultats apparaissent dans la page de relecture de l'Observatory |
| `.venv/bin/python eval/run_class.py <bundle> <run_dir> --learners 24` | simuler une classe sur un bundle existant, puis construire le rapport de classe de l'enseignant ; moins de cinq apprenants montre le masquage |
| `.venv/bin/python eval/author_one.py <id du corpus> <dossier> --claude` | créer un bundle pour une démonstration en direct |
| `.venv/bin/python eval/enrich_bundle_artifacts.py` | ajouter à un bundle créé des artefacts affichables : équation, graphique, résultat exécuté |
| [`validity/`](validity/README.md) | valide l'instrument lui-même : calibration du modèle d'apprenant, divergence des personas, pertinence des citations |
| [`decisive-trial/`](decisive-trial/PREREGISTRATION.md) | le pré-enregistrement d'un essai en classe (un plan, pas encore mené) |

## Limites

- Sans clés, les correcteurs du pilote sont des bouchons : la discussion reçoit toujours le même score,
  et l'évaluateur de critique compare de façon déterministe aux erreurs glissées.
- La vraie chaîne planner et scene-synth n'est pas un mode d'auteur : elle demande une adresse LiteLLM,
  et scene-synth n'a pas de mode simulé. [`services/scene-synth/tests/e2e/test_full_pipeline.py`](../services/scene-synth/tests/e2e/test_full_pipeline.py)
  montre le principe du client injecté qu'un tel mode utiliserait.
- `bundler.py` écrit `validated_at` avec un décalage `+00:00` que le chargeur TypeScript refuse ; le banc
  le normalise en `Z` et inscrit `bundler_validated_at_offset_defect` dans la provenance et l'audit.

## Organisation

```
eval/
  run_eval.py            la commande d'orchestration (étapes 1 à 4)
  run_class.py           simulation de classe et rapport de classe
  author_one.py          création d'un bundle pour les démonstrations
  corpus/                corpus et manifeste, ignorés par git
  reports/               sorties des évaluations, ignorées par git
  harness/               auteur, pilote, personas, audit, rapport, ancrage, juge de scènes
  tests/                 tests unitaires et d'intégration
  validity/              suite de validité de l'instrument
  decisive-trial/        pré-enregistrement de l'essai en classe
```

Le pilote Node importe `@studium/lesson-session` par `harness/node_modules/`, un lien ignoré par git que
`harness/runner.py` crée à l'exécution.
