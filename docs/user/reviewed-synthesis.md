# Révision approuvée et synthèse liée

Ce parcours local conserve le même `LessonPlan` depuis le brouillon sourcé
jusqu'à la synthèse. Il sépare trois décisions : la validité technique du
brouillon, l'approbation de sa révision pour synthèse, puis la revue du contenu
généré avant toute diffusion étudiante.

## Créer l'espace de revue

Partir d'un dossier produit par `tools/experience_packet.py check`, puis importer
ses fichiers contrôlés dans un nouvel espace enseignant :

```sh
.venv/bin/python tools/experience_approval.py import \
  /ABS/PATH/checked-review /ABS/PATH/teacher-workspace
```

Modifier ensuite `/ABS/PATH/teacher-workspace/plan.json` directement. Les liens
vers `evidence.json`, `source_links.json` et `viewers.json` sont revérifiés lors
de l'approbation. MySTRA se trouve dans `course_provenance.myst.md`.

Une exploration portable déjà scellée peut ajouter ses références techniques :

```sh
.venv/bin/python tools/experience_approval.py attach-exploration \
  /ABS/PATH/teacher-workspace /ABS/PATH/exploration-receipt
```

Studium vérifie le reçu, exige que sa scène appartienne au plan, puis conserve
seulement un résumé : hash racine du reçu, sources, chemins et hashes des
matériaux, statut d'action et contrôles déclarés. Le reçu portable et ses blobs
restent à leur emplacement indépendant ; ils ne sont pas copiés. Les champs
structurés de l'apprenant, la session, la question, l'hypothèse et le contenu des
matériaux sont exclus du résumé. Les titres, chemins et noms de contrôles restent
des métadonnées fournies par l'opérateur : les relire avant de partager MySTRA.
Attacher un résumé après approbation rend le reçu du plan obsolète.

## Approuver l'exacte révision

```sh
.venv/bin/python tools/experience_approval.py approve \
  /ABS/PATH/teacher-workspace --teacher 'teacher-local:nom'
```

`plan-approval.json` contient les hashes canoniques du plan et des entrées
d'appui, l'identité déclarée par l'opérateur et l'heure. Cette identité n'est pas
authentifiée par Studium : le dossier local enseignant reste l'autorité et le
digest sert à détecter les modifications. Toute modification sémantique du plan
ou des entrées rend le reçu obsolète ; il faut relire puis approuver à nouveau.

La commande suivante vérifie le reçu après un redémarrage, sans synthétiser :

```sh
.venv/bin/python tools/experience_approval.py verify \
  /ABS/PATH/teacher-workspace
```

Une vérification réussie régénère MySTRA depuis le reçu et l'éventuel
`synthesis.json` courants. Après une édition manuelle, considérer la page MySTRA
existante comme un instantané périmé jusqu'à une nouvelle vérification ou
approbation.

## Synthétiser avec un orchestrateur configuré

Le harnais fournit un objet local ayant la méthode existante
`synthesize_lesson(lesson_plan, options)` :

Le module doit être importable par ce Python (par exemple un fichier
`tools/mon_harnais.py`, ou un module installé/sur `PYTHONPATH`). Son attribut
`orchestrator` est l'instance configurée ou une fonction sans argument qui la crée.

```sh
.venv/bin/python tools/experience_approval.py synthesize \
  /ABS/PATH/teacher-workspace \
  --orchestrator 'mon_harnais:orchestrator'
```

Avant l'appel, le workflow rejette un reçu absent, modifié ou obsolète. Il passe
le `plan.json` chargé sans second appel au planner. Après succès,
`synthesis.json` relie le hash du reçu, le hash du plan et le SHA-256 du bundle
local. Un échec est ajouté à `synthesis-attempts.jsonl` et peut être retenté ; il
ne modifie ni le reçu ni le plan.

Une nouvelle approbation archive un `synthesis.json` antérieur dans
`synthesis-history/` : l'ancien bundle reste attribuable à son reçu, mais n'est
plus présenté comme la sortie de la révision courante. Une modification pendant
la synthèse, y compris une mutation en mémoire par l'orchestrateur, classe le
bundle éventuellement produit comme non vérifié et exige une nouvelle revue.

L'approbation porte seulement sur le plan donné à la synthèse. Le bundle généré
reste à relire et aucune diffusion étudiante n'est approuvée automatiquement.
MySTRA affiche les sources capturées, la révision relue, le bundle produit, les
contrôles réellement passés et la limite de l'identité déclarée localement.

Les routes historiques du planner et de `POST /scenes/synthesize` restent des
interfaces techniques. Employées seules, elles ne prouvent ni une approbation
enseignante persistante ni une autorisation de diffusion.
