[English](literature-and-evidence.md) · Français

# Littérature et preuves

Vous pouvez fonder une leçon sur des articles et garder, pour chaque affirmation que rencontre un
étudiant, le passage sur lequel elle repose. Perspicacité trouve et capture les passages ; Studium
vérifie que chaque citation leur correspond exactement et transmet leur provenance jusqu'à la
relecture. Pendant une leçon, l'assistant de l'étudiant peut ensuite explorer avec de vrais outils
(pages web, skills de domaine, code) pendant que Studium tient le fil pédagogique, et un reçu portable
conserve les preuves de ce qui a été fait.

| Vous voulez | Utilisez |
|---|---|
| Capturer des passages d'articles | Perspicacité, puis `experience_packet.py prepare --passages` |
| Capturer un document local | `experience_packet.py passages` |
| Faire construire un visuel pour la scène courante | `get_operator_context` |
| Conserver les preuves d'une exploration | `experience_exploration.py prepare`, `seal`, `verify` |

## Capturer des passages avec Perspicacité

Perspicacité est un serveur MCP de recherche bibliographique : connectez-le à votre assistant,
demandez les passages qui répondent à votre question et conservez l'enveloppe JSON réelle qu'il
renvoie. L'enveloppe liste des `passages` avec leur `text`, `source_doi` ou `source_url`, `license_id`
et `title`, et une `origin` qui dit comment ils ont été obtenus.
`examples/literature-experience/passages.json` en est un exemple réel.

```bash
.venv/bin/python tools/experience_packet.py prepare \
  --passages work/passages.json --title "Que montre une similarité spectrale ?" \
  --target "Master / doctorat" --out work/packet
```

Pour un seul document local, `passages` écrit une enveloppe de même forme à partir d'une URL, d'une
page HTML enregistrée, d'un PDF avec couche texte ou d'un fichier texte. Indiquez `--license` si vous
la connaissez ; sinon `check` signale la licence par un avertissement. Ses passages portent la
consigne d'auto-apprentissage.

```bash
.venv/bin/python tools/experience_packet.py passages \
  --pdf article.pdf --title "Titre de l'article" --license CC-BY-4.0 --out work/passages.json
```

La suite (brouillon, `check`, MySTRA, fichier de leçon) est décrite dans
[rédiger une leçon](author-a-lesson.fr.md#voie-b-le-dossier-de-preuves). Traitez un résultat de
recherche comme une piste : notez la page réellement lue, sa version ou sa date, et la raison de votre
choix. Si une source est inaccessible, consignez ce manque au lieu de le combler.

## Ajouter une capsule exécutable

Pour une capsule [ASB](../concepts/glossary.fr.md), ajoutez `--capsule chemin/vers/capsule --task-id
TASK_ID` à `prepare`. La fiche de la capsule garde sa description scientifique, ses limites, son
statut de reproductibilité et sa commande comme données. Les valeurs de `executable.env` sont
retirées ; seuls les noms des variables restent. Ni `prepare` ni `check` n'exécutent de commande de
capsule, et aucun niveau ASB ne vaut preuve d'exécution : un niveau `type-checked` n'est pas une
exécution réussie.

## Faire construire un visualiseur pendant une leçon

L'outil MCP `get_operator_context {session_id}` donne à l'assistant de l'étudiant la scène publique,
ses ressources résolues, le manifeste d'exécution éventuel et un exemple de réponse vérifié par
rapport au schéma canonique. Le canal fichier porte le même JSON dans `task.md`, sous
`<!-- studium-operator-context -->`. Clés de réponse, retours anticipés et résultat auteur d'une scène
à exécuter en sont exclus.

L'assistant choisit la représentation selon la question pédagogique : table, graphique, équation,
graphe, code ou page dédiée. Préférez les types de ressources existants quand ils suffisent ; pour
filtrer ou faire varier un paramètre, une spécification déclarative de graphique suffit souvent. Un
contrôle exploratoire peut recalculer un affichage ; ce n'est pas une nouvelle exécution attestée.
Gardez visibles les sources, les unités, les transformations et le caractère synthétique des
données, et testez les valeurs et l'effet de chaque contrôle avant de vous fier à l'image.

En mode enseignement, l'assistant demande le raisonnement et la confiance propres de l'étudiant et ne
répond jamais à sa place ; les exemples de réponse sont des gabarits, jamais des réponses à soumettre.

## La boucle d'exploration de l'étudiant

1. **Prédire.** Relier une question au concept courant ; recueillir d'abord la prédiction de l'étudiant.
2. **Établir la référence.** Exécuter la tâche prévue sur les entrées identifiées ; garder commande,
   environnement, sorties et contrôles réellement effectués.
3. **Faire varier.** L'étudiant choisit un facteur à changer ; montrer référence et variante côte à côte.
4. **Comparer.** Examiner l'effet, un cas limite et un contre-exemple ; garder échecs et résultats nuls.
5. **Juger.** Que soutiennent les résultats, que ne montrent-ils pas, quelles preuves manquent ?
6. **Transférer.** Éprouver l'explication sur un cas nouveau, puis revenir à la scène Studium pour la
   réponse personnelle.

Installez les dépendances dans le dossier propre à l'expérience et conservez les versions résolues et
les fichiers de verrouillage. Un environnement virtuel isole les dépendances ; il ne protège pas la
machine contre du code inconnu, si bien que l'exécution reste soumise aux permissions de l'assistant.
Fixez le périmètre exploratoire avant le pilote : une explication ou un exercice nouveaux au-delà de
ce périmètre sont des brouillons à relire.

## Conserver les preuves dans un reçu portable

Enregistrez le JSON de `get_operator_context` (ou de `task.md`), puis :

```bash
.venv/bin/python tools/experience_exploration.py prepare --context current-context.json --out work/experiment
.venv/bin/python tools/experience_exploration.py seal --workspace work/experiment --out work/receipt
.venv/bin/python tools/experience_exploration.py verify work/receipt --context fresh-context.json
```

`prepare` écrit `context.json`, `task.md`, `experiment.json` et son schéma. Renseignez la question,
l'hypothèse, les sources (rôle, identifiant, adresse, date de consultation, pertinence, fichier
capturé) et les actions. Les fichiers sont relatifs au dossier et portent un rôle : `source`, `skill`,
`input`, `code`, `output`, `environment` ou `log`. Une action `completed` exige un environnement
capturé, une sortie ou un journal et des contrôles réussis ; `failed` et `not_run` consignent
honnêtement les autres cas.

`seal` stocke le contexte, l'expérience et seulement les fichiers nommés, par SHA-256. Le reçu se
vérifie après déplacement, sans les fichiers d'origine. Les chemins qui sortent du dossier, les liens
symboliques et les emplacements usuels de secrets sont refusés ; chaque fichier est limité à 20 Mio,
l'ensemble à 100 Mio. Ce n'est pas un détecteur général de secrets : préparez d'abord des extraits et
des journaux appropriés.

`learner_observation` est vide par défaut ; ne le remplissez qu'à la demande de l'étudiant, avec ses
propres mots. Le reçu reste local, hors de la télémétrie Studium ; effacer une session ne le supprime
pas. Pour joindre son résumé à un plan relu, voir
[relire et approuver](review-and-approve.fr.md#facultatif-approuver-un-plan-avant-synthèse).

## Rejouer les démonstrations fournies

Avec un dépôt construit et Chrome disponible :

```bash
.venv/bin/python tools/demo-literature-experience.py reports/paper-demo
.venv/bin/python tools/demo-grounded-exploration.py reports/grounded-exploration
```

La première rejoue un extrait exact de l'article SimMS capturé par Perspicacité, contrôle un brouillon
préparé, produit MySTRA, exécute un petit calcul local sur des spectres illustratifs et teste le
visualiseur externe par rapport au score Python. La seconde la prolonge jusqu'à un reçu d'exploration
scellé. Aucune recherche ni aucun appel de modèle n'a lieu pendant le rejeu. Les spectres sont
synthétiques : ce n'est ni une reproduction des résultats de l'article ni une identification chimique.
Pour adapter le visualiseur, partez de `examples/literature-experience/`.

## Limites

- Une vérification réussie signifie que l'instantané est intact. Elle ne prouve ni la vérité des
  sources, ni la justesse scientifique, ni l'exécution des commandes, ni l'auteur d'un texte.
- Une citation exacte prouve un lien textuel, pas une interprétation correcte.
- Le reçu n'est jamais soumis comme réponse ni comme résultat d'exécution ; le protocole d'exécution
  reste distinct.

Code : [`tools/experience_packet.py`](../../tools/experience_packet.py),
[`tools/experience_exploration.py`](../../tools/experience_exploration.py).
