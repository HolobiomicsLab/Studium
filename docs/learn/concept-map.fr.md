[English](concept-map.md) · Français

# Carte des notions

Les notions d'une leçon et leurs liens de prérequis, avec votre situation sur chacune. Pendant une leçon,
la carte répond à trois questions : d'où je viens, où j'en suis, ce qui suit. Exportée, elle devient une
page à explorer : ouvrez une notion pour voir les questions par lesquelles vous êtes passé, qui a évalué
chaque réponse, et sur quoi repose l'enseignement de cette notion.

La carte dit ce qui s'est passé pendant la séance. Elle ne certifie pas qu'une notion est apprise et ne
vérifie pas qu'une source a raison.

## Ce que veut dire un état

| État | Sens |
|---|---|
| acquise | Votre dernière réponse évaluée sur la notion est juste, ou la séance l'a créditée comme prérequis |
| à revoir | Votre dernière réponse évaluée sur la notion est fausse |
| en cours | La scène à l'écran appartient à cette notion |
| vue, pas encore évaluée | Vous avez parcouru des scènes de la notion, et ni clé ni juge n'a évalué une réponse |
| à venir | Pas encore atteinte |

Les états viennent des faits de la séance : scènes servies, réponses évaluées, prérequis crédités. Le
champ `state` de `get_workflow_graph` lit la maîtrise estimée et sert un autre usage.

## Dans la conversation

La leçon montre la carte à quelques moments, pas à chaque question : à l'ouverture, lors d'un détour par
un prérequis et au retour, sur une scène qui mobilise plusieurs notions, et à la fin. À l'entrée dans une
nouvelle notion, une ligne dit où vous êtes. Demandez la carte quand vous voulez : votre assistant appelle
`get_workflow_graph` et affiche `concept_map`. Un harnais qui dessine des diagrammes peut rendre
`concept_map.mermaid`.

## Dans le panneau de leçon

Dans le panneau de leçon et dans le volet de Claude Code, « Carte des notions » ouvre la carte en liste
sous la scène. Rien n'est soumis et la scène reste où elle est. Chaque notion dit son état en mots et ce
qu'elle demande d'abord. « Preuves et portée » montre ce que l'état établit, ce qu'il n'établit pas, et
les réponses qui le fondent : le jour, qui a évalué la réponse, le résultat et les indices pris. Quand une
notion peut être contrôlée, un bouton porte votre déclaration (« Je la connais » ou « J'ai un doute ») :
la leçon pose alors une ou deux questions de contrôle et dit ce qu'elles ont montré. Votre déclaration
seule ne change rien. « Fermer la carte » range la liste. Le panneau ne dessine pas le graphe ; la page
exportée ci-dessous le fait.

## Exporter une page interactive

Demandez à votre assistant d'exporter la carte. Il appelle `export_concept_map`, qui écrit un
enregistrement dans votre bibliothèque (`<STUDIUM_HOME>/library/_exports/concept-maps/`) et renvoie son
chemin et son empreinte SHA-256. Puis, depuis la racine du dépôt :

```bash
.venv/bin/python tools/concept_map_report.py export RECORD.json reports/concept-map --expect-sha256 SHA256
```

```bash
.venv/bin/python tools/concept_map_report.py verify reports/concept-map
```

Ouvrez `reports/concept-map/index.html`. La page ne demande ni réseau ni serveur. La procédure que
suit votre assistant est le skill `studium-concept-map` ([Skills](../start/skills.fr.md)).

| Sur la page | Effet |
|---|---|
| Une notion du graphe | Ouvre son panneau : prérequis, vos passages, sources, nœuds de trace |
| Une étape du parcours | Ouvre la notion de cette étape et met l'étape en évidence |
| Point de vue : Apprenant | Colore les notions par état ; montre vos passages et le chemin parcouru |
| Point de vue : Enseignant | Montre la structure, ce sur quoi repose chaque notion et, s'ils sont joints, les chiffres de la classe |
| Notions affichées | Estompe les notions d'un état |

L'enregistrement ne contient ni identifiant d'apprenant ni vos mots : des résultats, pas des réponses. Pour
chaque réponse, il garde aussi le jour, les indices pris avant elle et si vous avez ensuite noté vous-même
votre rappel, et, pour chaque notion que vous avez contestée (« Je la connais », « J'ai un doute »),
ce que les questions de contrôle ont montré. Il
reste sur votre machine tant que vous ne partagez pas le dossier. `forget_session` ne supprime pas les
exports ; il nomme le dossier pour que vous puissiez le supprimer vous-même.

## Ce sur quoi repose une notion

Pour chaque scène d'une notion, le panneau donne le type de clé (écrite par l'auteur, production comparée
à une référence, ancrée par une exécution, ou non notée), les sources citées et l'origine de chacune : page
web, publication, document fourni, ou conversation avec un assistant IA. Un passage n'est cité qu'une fois
que vous avez quitté la scène qui le cite, car un passage peut énoncer la clé de sa question. L'en-tête dit
qui a rédigé la leçon et si un enseignant l'a validée.

Pour une leçon tirée d'une conversation, lisez [apprendre avec votre assistant](learn-with-your-assistant.fr.md) :
ce que l'assistant y affirme n'a pas été vérifié.

## Le point de vue enseignant et les chiffres de la classe

Un enseignant qui veut les chiffres d'une classe sur la carte exporte le rapport de classe avec l'outil
enseignant `class_report`, enregistre son JSON et le passe :

```bash
.venv/bin/python tools/concept_map_report.py export RECORD.json reports/class-map --class-report class-report.json
```

Chaque notion montre alors son taux de réussite, le recours aux indices, l'écart de calibration et le
temps moyen, et les notions à reprendre en priorité sont marquées. Les chiffres retenus sous le plancher
d'apprenants de `class_report` ne sont pas affichés, et ce rapport ne contient aucun chiffre individuel. La
page garde le parcours de la séance dont vient l'enregistrement : pour une page sans le parcours d'aucun
apprenant, exportez l'enregistrement d'une séance tout juste ouverte.

## Fichiers de provenance

| Fichier | Standard | Contenu |
|---|---|---|
| `sources/concept-map-record.json` | Enregistrement Studium | L'enregistrement écrit par le serveur, copié à l'identique |
| `astra.yaml` | ASTRA 0.0.14 | L'enregistrement comme artefact déclaré, les choix faits (règle d'état, passages cités, chiffres de classe) et des constats techniques |
| `trace/exploration_tree.yaml` | ARA 0.1.0 | Le parcours de la séance : un nœud par étape, un pivot par détour |
| `course_provenance.myst.md` | MySTRA | La même provenance en page lisible, avec la carte |
| `report.json`, `checks.json` | Studium | Le résumé et ses limites ; l'empreinte de chaque fichier et le résultat du validateur ASTRA |

Vos résultats restent dans l'enregistrement déclaré ; ils ne sont jamais écrits comme champs ASTRA
supplémentaires. Pour lire le paquet dans l'Observatoire, pointez sa racine de cours sur le dossier
parent, comme pour un [rapport de l'apprenant](learner-report.fr.md#ouvrir-et-vérifier).

La vérification recalcule le résumé, le document ASTRA, la trace et les deux pages depuis
l'enregistrement, lance le validateur `astra-tools` installé et contrôle chaque empreinte. Le manifeste
n'est pas signé : il détecte les fichiers périmés ou modifiés, et qui peut réécrire tout le dossier peut
aussi réécrire ses empreintes.

## Limites

- Aucune mesure ne dit encore si une carte aide à apprendre.
- Une leçon reprise après un redémarrage du serveur garde ses dernières étapes et leurs résultats
  (l'historique enregistré est borné) ; qui a évalué chaque réponse antérieure et comment la séance a
  routé ne sont enregistrés que pour les étapes jouées depuis le redémarrage.
- Le rendu Mermaid de chaque harnais n'a pas été vérifié à l'œil ; la forme en liste est toujours présente.
