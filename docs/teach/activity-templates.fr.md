[English](activity-templates.md) · Français

# Modèles d'activités

Cinq modèles prêts à l'emploi transforment la scène courante d'une leçon en activité interactive que
vos étudiants ouvrent dans un navigateur : une page autonome, les consignes destinées à leur assistant
et le format de la trace d'actions qu'ils peuvent exporter. Vous adaptez données, unités, sources et
critères dans un petit fichier de configuration. Préparer une activité n'exécute aucun code récupéré,
n'installe rien, n'approuve aucune leçon et ne soumet aucune réponse.

| Modèle | L'apprenant |
|---|---|
| `linked-representations` | Suit des identifiants stables entre une table d'arêtes, un graphe de pics et une table de candidats |
| `parameter-comparison` | Garde une entrée fixe, fait varier un paramètre et compare référence et variante |
| `evidence-claim` | Lit un énoncé de source fourni et choisit l'affirmation la plus étroite qu'il soutient |
| `diagnose-analysis` | Examine les étapes d'une analyse, désigne une erreur probable et compare les corrections fournies |
| `conclusion-robustness` | Compare des scénarios d'hypothèses à un seuil de décision explicite |

Le skill `studium-activity-templates` permet à votre assistant de faire ces étapes pour vous
(voir [skills](../start/skills.fr.md)). Un déroulé complet figure dans le
[tutoriel de l'activité au rapport](../tutorials/activity-to-report.fr.md).

## Préparer une activité

```bash
.venv/bin/python tools/experience_templates.py list
.venv/bin/python tools/experience_templates.py prepare \
  --template linked-representations --context operator-context.json --out activity-linked
```

`--context` est le contexte public de la scène, le JSON que votre assistant obtient avec l'outil MCP
`get_operator_context` (ou dans `task.md` avec le canal fichier). `--out` ne doit pas exister.
`list --json` affiche le catalogue complet ; une entrée marquée proposée n'est pas exécutable.

| Option | Usage |
|---|---|
| `--config FICHIER.json` | Adapter le modèle ; exemples dans `examples/activity-templates/<modèle>/config.json` |
| `--language`, `--translations` | Langue de présentation et dictionnaires de traduction |
| `--supports FICHIER.json` | Figures, équations, chimie, médias (voir [médias et supports visuels](media-and-visual-support.fr.md)) |

Une configuration est fermée : champs inconnus, nombres non finis, identifiants dupliqués,
identifiants de modèle discordants et sources incomplètes sont refusés avant toute écriture. Les
valeurs de référence et les variantes d'un curseur doivent tomber sur sa grille de pas. Les modèles
de paramètre, de preuve, de diagnostic et de robustesse acceptent soit des données synthétiques
(`data_status: "synthetic teaching fixture"`, `source_kind: "synthetic_fixture"`), soit des preuves
fournies (`"supplied source-backed data"`, `"supplied_evidence"`). Le modèle de spectres liés reste
synthétique : il réutilise un noyau d'exemple vérifié et refuse un réseau dont les valeurs diffèrent
de son oracle.

Le dossier produit contient :

| Fichier | Contenu |
|---|---|
| `activity.json` | La définition validée et son rattachement à la scène |
| `index.html` | La page locale autonome |
| `task.md` | Les consignes modifiables pour l'assistant, avec les commandes exactes du rapport |
| `learner-actions.schema.json` | Le schéma de la trace exportée |
| `provenance.json` | Les empreintes des entrées et du générateur, et les limites de validation déclarées |

## Ce que l'étudiant voit et conserve

La page demande d'abord s'il faut garder une trace en mémoire. Sans trace, l'activité fonctionne
quand même, et rien n'est reconstitué ensuite. Avec une trace, **Exporter la trace de l’activité** peut télécharger
une trace partielle avant que les résultats soient révélés ; **Terminer et exporter la trace finale**
ajoute l'événement de fin et verrouille les commandes. L'export porte le SHA-256 d'`activity.json` :
une définition ultérieure avec les mêmes identifiants ne peut pas réinterpréter les événements.

```bash
.venv/bin/python tools/learner_trace.py validate LEARNER_ACTIONS.json
.venv/bin/python tools/learner_report.py export REPORT_DIR \
  --actions LEARNER_ACTIONS.json --activity activity-linked/activity.json
.venv/bin/python tools/learner_report.py verify REPORT_DIR
```

La page n'envoie rien sur le réseau et ne stocke rien automatiquement ; elle ne contient ni identité
de l'apprenant ni clé de réponse, et ne garde le texte facultatif de l'apprenant que dans un
téléchargement explicite. Le rapport est décrit dans [rapport d'apprenant](../learn/learner-report.fr.md).

## Diagnostiquer une analyse

Dans [la configuration de diagnostic](../../examples/activity-templates/diagnose-analysis/config.json),
les `steps` ont un `id`, un `label` et une `description` ; les `repairs` ont un `id`, un `label`, une
`explanation` et un `result` numérique. Renseignez `flawed_result`, `result_unit`,
`supported_repair_id` et `oracle.repaired_result`, qui doit égaler le résultat de la correction
référencée. C'est un contrôle de cohérence, pas une vérification scientifique. Les sélections sont
enregistrées sous `step_<id>` et `repair_<id>` ; l'étape choisie n'est pas notée automatiquement.

## Tester la robustesse d'une conclusion

Dans [la configuration de robustesse](../../examples/activity-templates/conclusion-robustness/config.json),
chaque `scenario` a un `id`, un `label`, une `assumption` explicite et une `value` numérique.
Renseignez `baseline_scenario_id`, `metric.label`, `metric.unit` et une `decision` avec `operator`
(`gte` ou `lte`), `threshold` et une `claim` bornée. `oracle.supporting_scenario_ids` doit concorder
avec les valeurs, dans l'ordre, égalité au seuil comprise. Une sélection est enregistrée sous
`scenario_<id>`.

Les identifiants, préfixes compris, sont limités à 120 caractères. Les modèles comparent des
résultats capturés ; aucune équation ni aucun code n'est évalué. Faites tourner les vraies analyses
avec votre assistant, conservez leur provenance, puis régénérez l'activité à partir de ces sorties.

## D'une discipline à l'autre

Le schéma de diagnostic convient à un mauvais dénominateur en écologie, une conversion d'unités en
astronomie, une correction de blanc oubliée en chimie ou une erreur d'agrégation dans une enquête. Le
schéma de robustesse convient à des estimations de fond alternatives, des hypothèses sur les données
manquantes ou des choix d'étalonnage. Gardez termes et valeurs du domaine dans les fichiers de
configuration, avec unités et localisation dans les sources.

## Limites

- Trois scénarios fournis n'estiment pas une probabilité de vérité, et le franchissement d'un seuil
  n'établit pas une causalité.
- Les vérifications affichées après la révélation restent des consignes, sauf si un autre processus
  enregistre qu'elles ont été exécutées.
- Ni la page ni son rapport ne mesurent l'apprentissage ni n'approuvent quoi que ce soit pour les
  étudiants : relisez l'objectif et l'interprétation d'un contenu sourcé avant la séance.

Code : [`tools/experience_templates.py`](../../tools/experience_templates.py).
