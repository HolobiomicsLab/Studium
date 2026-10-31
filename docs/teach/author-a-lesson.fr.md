[English](author-a-lesson.md) · Français

# Rédiger une leçon

Vous apportez les sources et l'intention pédagogique ; votre assistant rédige ; Studium vérifie que
chaque citation correspond caractère pour caractère à un passage de la source et que la leçon est
bien formée. Trois voies existent. Choisissez selon la destination de la leçon.

| Voie | Pour quoi faire | Ce que vous obtenez | Approuvable pour des étudiants |
|---|---|---|---|
| A. Conversation, par MCP | Essayer une idée sur vos sources en quelques minutes, sans terminal | Une leçon jouable marquée « rédigée par l'agent, non validée par un enseignant » | Non : c'est une leçon d'auto-apprentissage |
| B. Dossier de preuves, en ligne de commande | Une leçon destinée à vos étudiants | Un plan contrôlé, sa provenance, puis un fichier de leçon à approuver | Oui |
| C. Littérature avec Perspicacité | Constituer l'entrée de la voie B à partir d'articles | Une enveloppe de passages avec DOI et provenance | Oui, par la voie B |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/teacher-journey-dark.svg">
  <img src="../assets/diagrams/teacher-journey-light.svg" alt="Parcours enseignant : sources, dossier de preuves, brouillon sourcé, contrôle et lint, revue MySTRA, approbation humaine, classe.">
</picture>

## Voie A, la rédaction conversationnelle

Demandez à votre assistant : « Je veux construire une leçon Studium sur X à partir de ces sources ».
Une fois le serveur MCP de Studium connecté (voir [harnais](../start/harnesses.fr.md)), il appelle
trois outils :

| Outil | Rôle |
|---|---|
| `get_authoring_guide {language?, mode?}` | Renvoie la consigne de rédaction, le schéma du brouillon et un exemple minimal. `mode: "teacher"` indique où commence la voie enseignant. |
| `prepare_sources {sources, goal?, language?}` | Découpe les textes récupérés par l'assistant en passages citables (jusqu'à 20 sources et 200 000 caractères au total). |
| `create_lesson {source_set_id, draft, course_id?, overwrite?}` | Contrôle le brouillon (citations exactes, aucun TODO, graphe de concepts cohérent, linter) et écrit la leçon dans la bibliothèque. |

Les deux outils écrivent dans la bibliothèque de la personne dont l'assistant les appelle,
`<STUDIUM_HOME>/library/<course_id>/lesson.json` (les sources dans `_sources/`), jamais dans le
`BUNDLES_ROOT` du serveur : une de vos leçons sous `BUNDLES_ROOT` n'est donc jamais remplacée, et un
identifiant de cours déjà pris là-bas est refusé. `overwrite: true` ne remplace qu'une leçon
d'auto-apprentissage qu'aucun enseignant n'a validée ni approuvée. La licence indiquée pour chaque
source est recopiée dans les citations de la leçon.

Cette voie n'écrit que des leçons d'auto-apprentissage (`validated_by: SELF-STUDY — not
teacher-validated`), que `experience_packet.py approve` refuse. Servez-vous-en pour voir rapidement
comment une leçon sur vos matériaux se déroule, puis construisez la version pour vos étudiants par la
voie B. Le côté apprenant de cette voie est décrit dans
[apprendre avec votre assistant](../learn/learn-with-your-assistant.fr.md) ; chaque outil figure
dans la [référence des outils MCP](../reference/mcp-tools.fr.md).

## Voie B, le dossier de preuves

Toutes les commandes se lancent depuis la racine du dépôt, avec l'environnement Python de
l'[installation](../start/installation.fr.md). Les chemins de sortie ne doivent pas encore exister :
rien n'est écrasé sans `--force`.

### 1. Préparer le dossier

```bash
.venv/bin/python tools/experience_packet.py prepare \
  --passages work/passages.json --title "Une similarité spectrale identifie-t-elle une molécule ?" \
  --target "Master" --out work/packet
```

`--passages` attend une enveloppe de passages, en général issue de Perspicacité (voie C). Le dossier
contient `evidence.json` (texte, DOI ou URL, licence si connue, origine, empreintes), `author-task.md`
(la consigne pour votre assistant) et `response.schema.json` (le format de la réponse). Pour une
capsule [ASB](../concepts/glossary.fr.md), ajoutez `--capsule chemin/vers/capsule --task-id TASK_ID` :
la fiche de la capsule est transmise comme donnée, les valeurs de son environnement sont retirées et
aucune commande n'est exécutée.

Pour capturer un seul document local, `experience_packet.py passages` lit une URL, une page HTML
enregistrée, un PDF avec couche texte ou un fichier texte. Ses passages portent la consigne
d'auto-apprentissage ; la leçon construite à l'étape 4 reste une leçon enseignant, sauf si vous
ajoutez `--self-study`.

### 2. Faire rédiger votre assistant

Demandez à votre assistant de lire les trois fichiers du dossier et d'écrire sa réponse dans un
nouveau fichier, par exemple `work/author-response.json`. Elle contient un `lesson_plan`, des
`source_links` (scène, passage, citation exacte) et des `viewers` (ce que chaque visuel doit
permettre à l'étudiant). Votre session d'assistant suffit ; aucun fournisseur ni paiement
supplémentaire n'est configuré.

Dans le plan, un concept peut lister les concepts dont il dépend (`prerequisites: ["concept-de-base"]`)
et une scène les concepts qu'elle travaille (`concept_refs: ["concept-cible"]`). `check` refuse un
identifiant inconnu et signale une scène reliée à aucun concept : une telle scène ne peut faire
évoluer aucune maîtrise.

### 3. Contrôler le brouillon et produire sa provenance

```bash
.venv/bin/python tools/experience_packet.py check \
  --packet work/packet --response work/author-response.json --out work/courses/my-course
.venv/bin/python tools/experience_review.py work/courses/my-course
```

`check` refuse un statut approuvé, une validation enseignant inventée, des identifiants absents, des
citations inexactes et des résultats d'exécution revendiqués dans un brouillon. La seconde commande
ajoute `astra.yaml` et `course_provenance.myst.md` pour la vue MySTRA. Ce qu'il faut lire dans la
sortie est expliqué dans [relire et approuver](review-and-approve.fr.md).

### 4. Construire le fichier de leçon et le compléter

```bash
.venv/bin/python tools/experience_packet.py bundle \
  --course work/courses/my-course --out work/library/my-course/lesson.json
```

Vous obtenez un squelette de leçon jouable, marqué `DRAFT — not validated`. Il reporte concepts et
prérequis dans le graphe de concepts et ajoute la règle par défaut qui fait rejouer un concept après
deux erreurs (`--no-default-rules` l'omet). Les champs à rédiger commencent par `TODO:` ; un quiz
démarre avec deux choix factices et sans indice. Complétez-les, puis lancez le linter :

```bash
node tools/bundle_lint.mjs work/library/my-course/lesson.json
```

Quand il ne reste plus d'`ERROR`, passez à [relire et approuver](review-and-approve.fr.md).

## Voie C, la littérature avec Perspicacité

Perspicacité interroge la littérature et renvoie des passages avec leur DOI, leur URL et leur
licence. Conservez son enveloppe JSON réelle et passez-la à `prepare --passages` ; l'origine est
consignée dans le dossier. L'exemple fourni `examples/literature-experience/passages.json` montre la
forme attendue. Stratégie de recherche, capsules et reçus d'exploration sont détaillés dans
[littérature et preuves](literature-and-evidence.fr.md), et le
[tutoriel de la littérature au cours](../tutorials/literature-to-course.fr.md) enchaîne toutes les
étapes sur l'exemple fourni.

## Limites

- Une citation exacte prouve un lien textuel, pas la justesse de l'interprétation.
- Une capture peut ne couvrir qu'un extrait d'article, et sa licence peut être inconnue : `check`
  signale les licences `NC`, `ND` et inconnues par un `WARN`.
- Les capsules de reproduction peuvent avoir leurs propres dépendances ; testez-les dans
  l'environnement que déclare leur manifeste.

Code : [`tools/experience_packet.py`](../../tools/experience_packet.py),
[`tools/experience_review.py`](../../tools/experience_review.py),
[`apps/lesson-mcp/src/authoring-tools.ts`](../../apps/lesson-mcp/src/authoring-tools.ts).
