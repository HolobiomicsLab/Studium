[English](cli.md) · Français

# Outils en ligne de commande

Ces commandes préparent, vérifient et approuvent des leçons, produisent un rapport de classe et
lancent les suites de tests Python, sans assistant ni éditeur. Lancez-les depuis la racine du dépôt,
après l'[installation](../start/installation.fr.md) (`pnpm install` et un `.venv` avec
`requirements.txt`).

| Commande | Rôle |
|---|---|
| [`experience_packet.py`](#experience_packetpy) | Des sources aux passages, au paquet, au brouillon vérifié, au squelette de leçon et à l'approbation enseignante. |
| [`bundle_lint.mjs`](#bundle_lintmjs) | Relecture pédagogique d'un ou plusieurs `lesson.json`. |
| [`bundle_validate.ts`](#bundle_validatets) | Validation de fichiers `lesson.json` par le schéma. |
| [`class_report.py`](#class_reportpy) | Rapport de classe agrégé à partir de la télémétrie consentie. |
| [`interaction_report.py`](#interaction_reportpy) | Rapport d'usage agrégé de l'interface à deux voies à partir de la télémétrie consentie. |
| [`pytest_all.py`](#pytest_allpy) | Toutes les suites de tests Python, un processus chacune. |

## experience_packet.py

[tools/experience_packet.py](../../tools/experience_packet.py) transforme des références choisies
par un apprenant ou un enseignant en leçon, hors ligne et sans modèle. L'ordre habituel est
`passages`, `prepare`, `check`, `bundle`, puis `approve` pour une leçon d'enseignant.

```bash
.venv/bin/python tools/experience_packet.py passages --text notes.txt --title "Chapitre 1" --out work/passages.json
.venv/bin/python tools/experience_packet.py prepare --passages work/passages.json --title "Chapitre 1" --out work/packet
# un auteur (personne ou assistant) écrit work/author-response.json à partir du paquet
.venv/bin/python tools/experience_packet.py check --packet work/packet --response work/author-response.json --out work/courses/chapitre-1
.venv/bin/python tools/experience_packet.py bundle --course work/courses/chapitre-1 --out work/bundles/chapitre-1/lesson.json
.venv/bin/python tools/experience_packet.py approve --bundle work/bundles/chapitre-1/lesson.json --validated-by "A. Enseignante"
```

| Sous-commande | Obligatoire | Options |
|---|---|---|
| `passages` | une option parmi `--url URL`, `--html FILE`, `--pdf FILE`, `--text FILE` ; `--out FILE` ; `--title T` | `--license ID` (par défaut `unknown`, signalé en WARN par `check`), `--min-chars N` (200 par défaut), `--max-chars N` (1200 par défaut), `--force` |
| `prepare` | `--passages`, `--out`, `--title` | `--target`, `--capsule`, `--task-id`, `--self-study` (automatique pour des passages issus de `passages`) |
| `check` | `--packet`, `--response`, `--out` | `--force` ; `--quiet` (n'affiche que le chemin de sortie) ou `--json` (un rapport lisible par machine) |
| `bundle` | `--course`, `--out` | `--validated-by`, `--force`, `--no-default-rules`, `--self-study`, `--note TEXT` (exige `--self-study`) |
| `approve` | `--bundle LESSON_JSON`, `--validated-by NAME` | `--checklist KEY=VALUE ...` |

À quoi s'attendre :

- `passages` télécharge une URL une seule fois ; un PDF doit avoir une couche texte.
- `check` refuse une citation qui n'est pas une sous-chaîne exacte de son passage : corrigez le
  brouillon, jamais la source. Chaque constat porte un niveau, un code et, le cas échéant, la scène
  et la citation.
- `bundle` écrit un squelette et affiche le nombre de gabarits restants (textes `TODO:` à remplir).
  `--self-study` renseigne `metadata.authoring` et, sans `--validated-by`, marque la leçon
  « SELF-STUDY — not teacher-validated ».
- `approve` refuse un bundle d'autoformation, un gabarit restant ou une erreur de relecture. Il
  renseigne `validated_by` et `validated_at`, normalise le fichier et écrit `approval.json` à côté du
  bundle, lié à l'empreinte SHA-256 de ses octets finaux. Il affiche un résumé (relecteur et heure,
  SHA-256, nombre d'erreurs et d'avertissements, rappel qu'une modification rend l'approbation
  périmée), puis le chemin d'`approval.json` en dernière ligne.

Code de sortie : `0` succès, `1` constats bloquants (ou citation introuvable), `2` erreur d'usage ou
de paquet. Avec `--json`, `check` affiche `{ok, findings, output, summary}`.

Les tutoriels [Autoformation à partir de références](../tutorials/self-study-from-references.fr.md)
et [De la littérature à un cours](../tutorials/literature-to-course.fr.md) déroulent un exemple
complet.

## bundle_lint.mjs

[tools/bundle_lint.mjs](../../tools/bundle_lint.mjs) vérifie ce que le schéma ne peut pas vérifier :
un seul choix correct par quiz, les gabarits `TODO` non remplis, les types de supports et les
relations de graphe connus, et qui détient la clé de réponse dans une leçon d'autoformation. Il ne
demande que Node.

```bash
node tools/bundle_lint.mjs                              # chaque lesson.json sous fixtures/
node tools/bundle_lint.mjs --root chemin/vers/bundles   # chaque lesson.json jusqu'à deux niveaux
node tools/bundle_lint.mjs chemin/vers/lesson.json      # les fichiers donnés
bash tools/bundle_lint.test.sh                          # les tests de contrat du linter
```

Chaque constat tient sur une ligne : `NIVEAU  fichier  code  message`, avec `ERROR`, `WARN` ou
`INFO`. Code de sortie `1` s'il y a au moins une `ERROR`, `0` sinon.

## bundle_validate.ts

[tools/bundle_validate.ts](../../tools/bundle_validate.ts) analyse chaque fichier avec le
[schéma du bundle de leçon](lesson-bundle.fr.md). C'est du TypeScript, lancé par le tsx de
l'espace de travail.

```bash
node_modules/.pnpm/node_modules/.bin/tsx tools/bundle_validate.ts chemin/vers/lesson.json [...]
```

Il affiche `OK <fichier>: N scenes` ou `FAIL <fichier>: <problèmes>` et sort avec `1` si un fichier
échoue.

## class_report.py

[tools/class_report.py](../../tools/class_report.py) donne à l'enseignant des chiffres de classe à
partir de la télémétrie consentie : concepts à reprendre, regroupements d'indices et d'erreurs de
calibration, achèvement. Il n'affiche jamais de ligne par apprenant ni de pseudonyme.

```bash
.venv/bin/python tools/class_report.py <dossier_run_ou_collecteur> [--min-learners 5] [--out DIR] [--bundle lesson.zip]
```

| Option | Sens |
|---|---|
| `run_dir` | Dossier des flux de télémétrie par apprenant (`telemetry.jsonl`). |
| `--min-learners` | Seuil en apprenants distincts (5 par défaut), appliqué à chaque chiffre sur les apprenants dont il est calculé : les chiffres calculés sur moins d'apprenants sont tus. |
| `--out DIR` | Écrit aussi `class_report.md` et `class_report.json`. |
| `--bundle` | Le bundle, quand le dossier de télémétrie n'en contient pas (organisation durable de MCP). |

Il suit les règles de l'outil MCP : la réussite ne compte que les réponses notées par une clé ou un
juge (un score par mots-clés est une tentative), la calibration n'utilise que les réponses que les
apprenants ont accompagnées d'une confiance (`null` s'il n'y en a aucune), et un temps manquant ne
compte pas comme zéro. Dans le Markdown, « withheld (fewer than k) » signale un chiffre sous le seuil
et « not measured » un chiffre auquel personne n'a contribué ; chaque ligne de concept du JSON porte
`n_measured` et `withheld_figures`, les noms des chiffres que le seuil a retenus.

Le seuil freine l'identification d'un individu ; ce n'est pas une garantie d'anonymat, puisqu'un
enseignant connaît sa classe. L'outil MCP `class_report` offre le même rapport avec un seuil qui ne
peut pas être abaissé (voir [Suivre une classe](../teach/follow-a-class.fr.md)).

## interaction_report.py

[tools/interaction_report.py](../../tools/interaction_report.py) décrit comment une classe a utilisé
l'interface à deux voies, à partir des événements d'interaction de la télémétrie consentie : la part
des actes réglés sans modèle, le délai des verdicts (95e centile), l'issue des propositions par
type (un type d'au moins 30 issues et de moins de 20 % d'acceptations est signalé), l'aide utilisée
par échelon et par scène, les contestations, les reprises et les scènes montrées deux fois après
elles, et les accusés de relecture. Il ne mesure pas l'apprentissage (c'est le rôle de
`class_report.py`).

```bash
.venv/bin/python tools/interaction_report.py <dossier_run> [--min-learners 5] [--out DIR] [--json]
.venv/bin/python tools/interaction_report.py <telemetry.jsonl> --single-stream
```

Il lit chaque `telemetry.jsonl` du dossier, refuse un flux sans événement `consent_granted` (compté
dans `refused_streams`), et tait le rapport entier sous le seuil de cinq apprenants distincts, ainsi
que chaque chiffre, type de proposition et scène calculés sur moins d'apprenants. `--min-learners`
peut relever le seuil, pas l'abaisser. `--out DIR` écrit `interaction_report.md` et
`interaction_report.json`. `--single-stream` lit un seul fichier sans seuil et ne sert qu'aux
apprenants synthétiques des bancs d'essai : le rapport précise alors que ses chiffres sont ceux
d'un seul apprenant.

## pytest_all.py

[tools/pytest_all.py](../../tools/pytest_all.py) lance toutes les suites de tests Python du dépôt,
un processus pytest par suite, et échoue si un fichier de test n'est atteint par aucune suite.

```bash
.venv/bin/python tools/pytest_all.py              # toutes les suites
.venv/bin/python tools/pytest_all.py -- -x -q     # les arguments suivants vont à chaque pytest
```

Il se termine par `N suites, M failing` et sort avec `1` si une suite échoue ou si un fichier de
test n'est pas couvert. `--root DIR` le dirige vers un autre checkout. Les autres commandes de test
sont dans [Tests](../develop/testing.fr.md).
