[English](follow-a-class.md) · Français

# Suivre une classe

Vous pouvez voir comment une classe a travaillé une leçon (quels concepts reprendre, où se
concentrent le recours aux indices et l'excès de confiance, jusqu'où les étudiants sont allés) sans
jamais voir le dossier d'un seul étudiant. Par votre assistant, chaque chiffre de classe est
calculé sur au moins cinq apprenants distincts, et rien ne permet de le ramener à une personne.

| Outil | Où | Montre |
|---|---|---|
| `class_report` | Outil MCP, depuis votre assistant | Réussite par scène et par concept, recours aux indices, écart de calibration, achèvement |
| `tools/class_report.py` | Ligne de commande | La même chose, plus la calibration de la confiance, en Markdown et JSON |
| Tableau de bord enseignant | Navigateur, `localhost:3001` | Bibliothèque et pages de relecture des leçons ; analyses de cours issues du collecteur |
| Observatoire | Navigateur, `localhost:8004` | Provenance, MySTRA, évaluations, colonnes de sessions ([Observatoire](observatory.fr.md)) |

## D'où viennent les données de classe

Studium n'écrit de télémétrie que si l'apprenant y a consenti (`STUDIUM_TELEMETRY_CONSENT=1`, ou le
réglage `studium.telemetryConsent` dans VS Code) et que son état est durable (le cas par défaut ; voir
[configuration](../reference/configuration.fr.md)). La télémétrie contient des références
pseudonymisées et des nombres, jamais de texte libre, et la maîtrise reste sur l'appareil de
l'apprenant.

Les flux arrivent dans le dossier de données de l'apprenant sous la forme
`<pseudonyme>/<bundle_id>/telemetry.jsonl`. Dans cette version, aucune surface prise en charge ne vous
les envoie par le réseau : un rapport de classe suppose donc de réunir ces dossiers dans un même
dossier de données, par exemple sur une machine de salle partagée, ou avec les dossiers que les
étudiants choisissent de vous remettre.

## Demander un rapport de classe à votre assistant

Avec le serveur MCP de Studium configuré sur ce dossier de données, demandez « donne-moi le rapport
de classe de `my-course` ». L'assistant appelle `class_report {course_id}`. Le cours est cherché
dans le dossier des leçons du serveur (`BUNDLES_ROOT`), puis dans la bibliothèque de l'apprenant
(`<STUDIUM_HOME>/library`).

| Chiffre | Calculé sur | Affiché quand |
|---|---|---|
| Réussite | les réponses notées par une clé ou un modèle juge ; un score par mots-clés est une tentative, pas une note | au moins cinq apprenants ont été notés |
| Recours aux indices | la part des apprenants ayant répondu qui ont demandé un indice (de 0 à 1) | la ligne est affichée |
| Écart de calibration | les réponses que les apprenants ont accompagnées d'une confiance | au moins cinq apprenants l'ont donnée |
| Temps moyen | les réponses chronométrées | au moins cinq apprenants ont été chronométrés |
| Achèvement | les apprenants qui ont terminé sur ceux qui ont commencé | au moins cinq apprenants ont commencé |

- Les effectifs sont donnés par tranche (`5–9`, `10–19`, `20+`), jamais par leur taille exacte.
- Une scène ou un concept avec moins de cinq apprenants ayant répondu est laissé de côté, et un
  chiffre sous son propre seuil est retenu (`null`). Le rapport indique alors qu'un élément a été
  retenu (`withheld_below_floor`), sans dire combien.
- L'outil couvre tout le dossier de données configuré sur le serveur et le nomme dans `data_folder`
  (le nom du dossier et une courte empreinte de son chemin, jamais le chemin). Il ne prend que
  `course_id` : un argument `telemetry_dir` est refusé, si bien que le modèle ne peut ni restreindre le
  rapport ni soustraire une cohorte d'une autre.

Une limite demeure : deux rapports pris avant et après qu'un apprenant de plus a joué peuvent être
comparés. Lisez ces chiffres comme une vue vivante de la classe, pas comme une publication.

## Utiliser la ligne de commande

```bash
.venv/bin/python tools/class_report.py chemin/vers/donnees --out reports/my-course
```

La commande lit chaque `telemetry.jsonl` du dossier et écrit `class_report.md` et `class_report.json`,
avec les mêmes règles que l'outil MCP : un seuil par chiffre, les scores par mots-clés comptés comme
des tentatives, la calibration sur les seules réponses accompagnées d'une confiance. Dans le Markdown,
« withheld (fewer than k) » signale un chiffre auquel trop peu d'apprenants ont contribué, et « not
measured » un chiffre auquel personne n'a contribué ; chaque ligne de concept du JSON liste ses
`withheld_figures`. Faute de lignes par scène, ses chiffres par concept peuvent différer de ceux de
l'outil quand une scène est retenue.
`--min-learners` fixe le seuil (5 par défaut). Contrairement à l'outil MCP, dont le seuil de 5 ne
peut pas être abaissé, la ligne de commande accepte une valeur plus basse, et le rapport perd alors
cette protection : gardez 5 ou plus. `--bundle chemin/vers/lesson.zip` désigne la leçon quand elle
n'est pas à côté de la télémétrie. Ce rapport inclut aussi la calibration de la
confiance (les étudiants se sont-ils fiés à l'IA quand il le fallait ?), que l'outil MCP laisse de côté.

## Comment l'interface a été utilisée

```bash
.venv/bin/python tools/interaction_report.py chemin/vers/donnees --out reports/my-course-usage
```

[`tools/interaction_report.py`](../../tools/interaction_report.py) lit le même dossier et décrit
comment la classe a utilisé l'interface plutôt que ce qu'elle a appris. Il lit sept types d'événements,
écrits seulement avec le consentement de l'apprenant : `interaction` (un par acte que le serveur
règle), `prompt_shown` et `prompt_outcome`, `help_used`, `contest`, `resume` et `review_receipt`.

- **Voie et rang de surface.** Chaque acte enregistre la voie utilisée (`fast` pour le panneau, le volet
  natif et les formulaires ; `companion` pour la conversation et ses outils) et le rang de la surface
  sur laquelle la séance se joue (3 panneau ou volet, 2 formulaires, 1 conversation). Un acte dans la
  conversation alors qu'un panneau est ouvert est donc `companion` au rang 3. La part de voie rapide se
  calcule sur les actes des séances de rang 2 ou 3, actes de conversation compris : un apprenant revenu
  à la conversation fait baisser cette part au lieu de disparaître du calcul.
- **Devenir des propositions.** Chaque proposition est comptée comme acceptée, ignorée ou sans réponse,
  par type ; un type qui a au moins 30 issues et moins de 20 % d'acceptations est signalé pour
  relecture.
- **Aide, contestations et reprises.** L'aide est comptée par barreau (`hint`, `explain`) et par scène,
  avec les réponses venues avant et après une explication ; les contestations par leur issue
  (`confirmed`, `refuted`, `partial`) ; les reprises par cause, avec les scènes montrées deux fois
  après une reprise.
- **Accusés de relecture.** `experience_packet.py approve` et `receipt --decision returned` écrivent un
  événement `review_receipt` à côté des reçus, sous l'étiquette de rôle `reviewer`, si bien que le
  rapport dit combien de leçons ont été entièrement ouvertes et combien ont été approuvées ou renvoyées.

Chaque chiffre garde le même seuil de cinq apprenants distincts, qui ici ne peut pas être abaissé, et un
flux sans événement de consentement enregistré est refusé et compté, pas lu. Ce que fait chaque
proposition, ce que signifie chaque barreau d'aide et les champs exacts sont dans
[Outils en ligne de commande](../reference/cli.fr.md#interaction_reportpy) et le
[README de telemetry-events](../../packages/telemetry-events/README.fr.md), plutôt que répétés ici.

## Le tableau de bord enseignant

```bash
pnpm --filter @studium/teacher-dashboard build && pnpm --filter @studium/teacher-dashboard start
```

Ouvrez `http://localhost:3001/library`. La bibliothèque liste les leçons de `BUNDLES_ROOT` (par défaut
`~/.studium/library`) avec leur statut : Brouillon, Vérifié ou Approuvé. Pour parcourir les leçons de
démonstration du dépôt, lancez-le avec `BUNDLES_ROOT="$PWD/fixtures"`.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/teacher-library-dark.png">
  <img src="../assets/screenshots/teacher-library-light.png" alt="Bibliothèque du tableau de bord enseignant : une liste de leçons avec titre, langue, nombre de scènes et statut Brouillon, Vérifié ou Approuvé." width="720">
</picture>

Chaque leçon a une page de relecture (voir [relire et approuver](review-and-approve.fr.md#relire-le-fichier-de-leçon))
avec un lien vers sa vue MySTRA quand l'Observatoire sert un dossier de cours du même nom
(`OBSERVATORY_BASE_URL`, par défaut `http://localhost:8004`). Les pages sont en lecture seule : elles
montrent titres, types de scènes, concepts et références et, replié sous chaque ligne de la boîte de
relecture, ce que lit l'apprenant (le texte de la scène, les choix d'un quiz), jamais une clé, un
indice, une rétroaction ni un corrigé. Langue et thème se choisissent dans le menu de l'en-tête.

La page de relecture s'ouvre sur une boîte de relecture : une ligne par scène, d'abord les scènes qui
bloquent, puis celles qui portent une clé de notation, puis la formulation et les médias, chacune
marquée nouvelle, modifiée ou inchangée depuis le dernier reçu de relecture. Chaque ligne déplie ce que
voit l'apprenant ; la page lance le linter, si bien qu'une scène qui a une erreur de lint bloque. Donnez
votre propre avis sur une ligne « note » (Correct ou À corriger) avant que son avis automatique se
déplie. La commande d'approbation, et celle qui renvoie la leçon, reprennent le nom que vous saisissez
(le panneau le montre tel que les apprenants le liront) et listent dans `--opened` les scènes que vous
avez ouvertes ; la page signale les lignes « note » non ouvertes et n'écrit elle-même rien.

Les pages d'analyse d'un cours (`/courses/<course_id>/progress` et les pages voisines : calibration,
trajectoire, raisonnement, autonomie, littératie IA) lisent le collecteur d'analyses sur
`localhost:8003` ; la page des soumissions est décrite dans
[contributions des apprenants](learner-contributions.fr.md). Saisissez l'identifiant du cours sur la
page d'accueil. Parmi les surfaces apprenant, seule l'application de bureau gelée envoie de la
télémétrie au collecteur : ces pages servent donc surtout aux démonstrations et aux déploiements
existants.

```bash
ANALYTICS_DATA_DIR="$PWD/.studium-session/analytics" .venv/bin/python -m uvicorn \
  analytics_collector_app:app --app-dir services/analytics-collector --host 127.0.0.1 --port 8003
```

Le collecteur n'a pas de véritable authentification : l'identifiant du cours sert de jeton.
Gardez-le sur `127.0.0.1`.

## Lire les chiffres

- Une case retenue signifie que l'instrument refuse de préciser, pas que personne ne pourrait deviner
  de qui il s'agit : vous connaissez votre classe. Le seuil freine l'identification ; ce n'est pas une
  garantie d'anonymat.
- Le seuil s'applique par leçon, puis à nouveau pour chaque chiffre, sur les apprenants qui y ont
  contribué.
- Retenu n'est pas « non mesuré » : retenu signifie que trop peu d'apprenants ont contribué pour
  afficher le chiffre ; non mesuré, que personne n'y a contribué, ce qui n'est pas non plus un zéro.
  `measured: false` signifie que la mesure a tourné sans rien avoir à mesurer.
- L'écart de calibration est positif quand la classe est trop confiante sur un concept.

Ce qui est collecté et ce qui ne l'est pas : [confidentialité et limites](../concepts/privacy-and-limits.fr.md).

Code : [`apps/lesson-mcp/src/teacher-tools.ts`](../../apps/lesson-mcp/src/teacher-tools.ts),
[`tools/class_report.py`](../../tools/class_report.py),
[`apps/teacher-dashboard/README.md`](../../apps/teacher-dashboard/README.md).
