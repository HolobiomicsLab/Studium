# Tutoriel — de la littérature à un brouillon relisible

**Objectif :** produire un plan sourcé, inspectable dans MySTRA, avant approbation
enseignant. Prévoir 20–30 minutes avec l'[installation Python](../getting-started/installation.md)
terminée. Le premier passage réutilise un exemple capturé ; il n'effectue ni
recherche web ni appel de modèle payant.

## 1. Rejouer le petit exemple livré

Depuis la racine, choisir des dossiers de sortie nouveaux :

```sh
.venv/bin/python tools/experience_packet.py prepare --passages examples/literature-experience/passages.json --title "Que démontre une similarité spectrale ?" --target "Master" --out /ABS/PATH/studium-tutorial/packet
.venv/bin/python tools/experience_packet.py check --packet /ABS/PATH/studium-tutorial/packet --response examples/literature-experience/author-response.json --out /ABS/PATH/studium-tutorial/courses/spectral-evidence
.venv/bin/python tools/experience_review.py /ABS/PATH/studium-tutorial/courses/spectral-evidence
```

Remplacer `/ABS/PATH` par un emplacement personnel. Les sorties ne sont pas
écrasées. L'exemple utilise un court extrait capturé de l'article SimMS et une
réponse auteur préparée. Les spectres illustratifs sont synthétiques ; ce n'est
pas une reproduction des résultats de l'article.

| Fichier | Ce qu'il permet de vérifier |
|---|---|
| `packet/evidence.json` | Textes capturés, identifiants, provenance et hashes |
| `packet/author-task.md` | Consigne destinée au harnais auteur |
| `packet/response.schema.json` | Format imposé à la proposition |
| `courses/spectral-evidence/plan.json` | Plan canonique au statut draft |
| `source_links.json` | Liens scène / preuve / citation exacte |
| `viewers.json` | Intentions de visualisation ; pas un visualiseur exécuté |
| `review.md` | Points de revue et limites |
| `astra.yaml`, `course_provenance.myst.md` | Provenance structurée pour MySTRA |

Les cinq dernières lignes sont relatives au dossier du cours. `check` valide
les références et la structure ; il ne juge pas la vérité de l'interprétation.

## 2. Ouvrir la revue

```sh
.venv/bin/python services/observatory/observatory_app.py --course-root /ABS/PATH/studium-tutorial/courses --port 8004
```

Ouvrir `http://127.0.0.1:8004/courses/spectral-evidence/mystra`. Retrouver la question,
les décisions et leurs preuves. Comparer une citation au passage capturé. Identifier
une limite scientifique et une amélioration pédagogique. Le statut doit rester
**DRAFT**. Arrêter le serveur avec Ctrl-C à la fin.

## 3. Remplacer l'exemple par sa littérature

Avec un connecteur Perspicacité réellement disponible et authentifié, formuler
une question de recherche bornée et conserver l'enveloppe JSON réellement retournée
par l'outil de passages. Le préparateur attend ce contrat, pas une liste arbitraire
de titres. Voir [le format de l'exemple](../../examples/literature-experience/passages.json).
Un connecteur configuré ne prouve pas qu'il a réussi une recherche.

Vérifier pertinence, identifiants, extraits disponibles et droits de réutilisation.
Un résultat bibliographique n'est pas le texte intégral de l'article. Si l'accès
échoue, garder cette limite et travailler avec les matériaux autorisés disponibles.
Puis refaire `prepare` avec ce fichier et une nouvelle destination.

Prompt au harnais :

> Lis `author-task.md`, `evidence.json` et `response.schema.json` du packet.
> Propose le plan demandé dans un nouveau `author-response.json`. Utilise les
> identifiants de preuves exacts et des citations présentes dans les passages.
> Distingue ce que chaque source soutient et ce qui manque. Conserve `status: draft`
> et `validated_by: null`. Décris les interactions utiles des viewers, sans
> revendiquer un calcul qui n'a pas eu lieu. Ne soumets aucune réponse étudiante.

Remplacer ensuite `--response` par ce nouveau fichier. Corriger les erreurs
rapportées par `check` dans le brouillon, jamais en falsifiant la preuve. Garder
la version précédente si elle sert à comparer deux propositions.

## 4. Ajouter une capsule ASB

À la commande `prepare`, ajouter `--capsule /ABS/PATH/capsule --task-id TASK_ID`.
Choisir l'identifiant réel dans la capsule. Le préparateur capture la carte et
ses contraintes, retire les valeurs d'environnement et conserve les noms utiles.
Il n'exécute pas le code. Une capsule documentaire Perspicacité et une capsule
exécutable ASB ne sont pas interchangeables.

Faire d'abord un essai de la tâche dans un environnement prévu pour elle. Conserver
commande, entrées, versions, sortie et échec éventuel. Le statut `type-checked`
d'une carte n'est pas une preuve de réussite locale. Le
[tutoriel suivant](agentic-experiment.md) transforme cette tâche en activité de jugement.

## 5. Décider de la suite

Relire objectifs, prérequis, exactitude scientifique, questions, critères de
réponse, charge de travail et permissions des matériaux. Dans le brouillon
`author-response.json`, relier chaque scène aux identifiants de `concepts` avec
`concept_refs`, puis déclarer sur chaque concept les identifiants dont il dépend
dans `prerequisites`. Relancer `check` : il ne doit signaler ni identifiant inconnu
ni scène sans concept. Puis convertir le dossier vérifié en squelette jouable :

```sh
.venv/bin/python tools/experience_packet.py bundle --course /ABS/PATH/studium-tutorial/courses/spectral-evidence --out /ABS/PATH/studium-tutorial/bundles/spectral-evidence/lesson.json
```

Le bundle conserve par défaut la marque `DRAFT — not validated` et contient des
champs `TODO:` : l'ouvrir, remplacer chaque contenu factice et le relire avant tout
usage étudiant. Le squelette recopie les `concept_refs`, dérive le graphe de
prérequis (`source` = concept dépendant, `target` = prérequis), ajoute
`rule_2err_replay_concept` et reprend les `notes` comme question des quiz.
`--no-default-rules` retire explicitement cette règle. `--validated-by "Nom"` ne
doit être ajouté qu'après la décision humaine. Vérifier enfin le contrat 1.4 :

```sh
apps/lesson-mcp/node_modules/.bin/tsx tools/bundle_validate.ts /ABS/PATH/studium-tutorial/bundles/spectral-evidence/lesson.json
```

Pour relancer `check` ou `bundle` vers la même destination, ajouter `--force` ;
sans cette option la commande refuse l'écrasement et conserve la sortie existante.

Voir [Du brouillon au bundle jouable](../user/teacher-guide.md#du-brouillon-au-bundle-jouable)
pour les avertissements de licence, la scène `simulation` héritée et les limites de
validation. L'intégration du draft dans l'approbation/synthèse de l'interface auteur
reste distincte de ce squelette local.
