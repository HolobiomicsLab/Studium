# Guide enseignant

Pour être accompagné par votre agent, utiliser le skill `studium-teacher` ;
voir [activation et exemples](../getting-started/skills.md).

Studium aide à construire un parcours où objectifs, prérequis, preuves et
évaluation sont inspectables. Votre rôle est de décider ce qui doit être appris,
ce que les sources permettent d'affirmer et ce qui peut être présenté aux étudiants.
Un plan techniquement valide reste un **brouillon** tant que vous ne l'avez pas relu.

## Onboarding recommandé

1. Installer les outils Node et Python du [guide commun](../getting-started/installation.md).
2. Essayer la [première séance étudiante](../tutorials/first-lesson.md) pour voir
   ce que l'apprenant reçoit réellement.
3. Choisir son [harnais](../getting-started/harnesses-and-api.md).
   L'[avantage Copilot enseignant](../getting-started/copilot.md) est distinct de
   Copilot Student ; aucun fournisseur backend supplémentaire n'est nécessaire
   au tutoriel de création par le harnais.
4. Faire le [tutoriel article → brouillon → MySTRA](../tutorials/literature-to-course.md).
5. Définir un pilote : public, prérequis, durée, question de jugement, règles
   d'exploration, matériaux autorisés et mode de restitution.

Pour une classe, fournir un bundle et ses assets de même révision, les consignes
étudiantes et une voie de secours si le compte du harnais ou Internet échoue.
Commencer par quelques utilisateurs et vérifier la séance sur leurs machines.
L'installation VSIX peut simplifier la distribution du panneau ; elle ne remplace
pas la distribution des cours ni leur validation.

## Concevoir l'activité

Définir une question qui demande plus qu'une sortie calculée. Par exemple :
« Une similarité spectrale élevée suffit-elle à identifier une molécule ? »
Puis distinguer : concept à comprendre, tâche à réaliser, observation attendue,
limite à discuter et cas nouveau pour vérifier le transfert.

Prompt de cadrage :

> Prépare un brouillon Studium pour [public], en [durée], sur [question].
> Utilise seulement les passages et matériaux identifiés dans le dossier.
> Sépare résultats de l'article, hypothèses et données synthétiques. Propose une
> prédiction avant exécution, une comparaison et une question de transfert.
> Signale les preuves manquantes. Ne marque rien comme approuvé et n'invente
> aucun résultat de capsule. Respecte le schéma fourni par le packet.

La revue porte sur l'exactitude des liens source/scène, les prérequis proposés,
la charge cognitive, les critères d'évaluation et les représentations. Une
citation exacte peut être mal interprétée ; un score ou un hash ne remplace pas
votre lecture. Tester aussi un élève hésitant, une réponse partiellement juste,
un outil indisponible et un résultat nul.

## Composer une expérience interactive

Les [cas d'usage](../tutorials/use-cases.md) relient les outils à des situations
concrètes : capsule ASB et annotation spectrale, diagnostic d'analyse, robustesse,
photographie en archéologie et restitution. Les [cinq templates](activity-templates.md)
conservent un contrat commun ; adapter leurs données, unités, sources et critères
dans la configuration. Un exemple synthétique doit rester identifiable comme tel.

Préparer avec le cours ses traductions et un petit nombre de supports utiles :
équations, carte de concepts, structure chimique, photographie ou média avec
transcription. Le [guide de présentation](../guides/language-and-scientific-presentation.md)
et le [workflow médias](../guides/sourced-and-generated-media.md) permettent une
préparation unique puis une aide à la demande via le harnais de l'étudiant.
Conserver une alternative textuelle et vérifier les termes traduits et les images.

Pour chaque pilote, tester le parcours choisi sur une machine étudiante : accès
au bundle, rendu, langue, indisponibilité du modèle et export. Le panneau,
l'API et les activités portables ont des limites différentes, décrites dans
la [matrice des capacités](../features.md). Les aides `?` expliquent la méthode
pendant l'usage ; elles ne remplacent pas les consignes essentielles.

Le [rapport étudiant](learner-report.md) complète la provenance du cours par les
actions volontairement exportées. Discuter avec les étudiants ce qui sera partagé
et comment vous l'interpréterez : une trace incomplète ne mesure pas l'autonomie.

## Relire avec MySTRA

Pour conserver les éditions et relier une révision approuvée à sa synthèse,
suivre le [workflow local de revue et synthèse](reviewed-synthesis.md). Il importe
le brouillon contrôlé, enregistre l'approbation de son empreinte et refuse un plan
modifié après cette revue. La revue du contenu généré précède toujours la diffusion.

Le [tutoriel littérature](../tutorials/literature-to-course.md) produit `astra.yaml`
et `course_provenance.myst.md`. L'Observatory sert ces dossiers localement :

```sh
.venv/bin/python services/observatory/observatory_app.py --course-root /ABS/PATH/courses --port 8004
```

Ouvrir `http://127.0.0.1:8004/courses/spectral-evidence/mystra` pour l'exemple.
Examiner les analyses, décisions, preuves liées et points à relire. MySTRA
présente la provenance ; il n'exécute pas le code décrit et ne transforme pas
un draft en cours approuvé. Voir le [guide de revue](../guides/mystra-reviewer.md).
Ce serveur local n'est pas un portail de classe authentifié à exposer sur Internet.

## Du brouillon au bundle jouable

`check` affiche désormais le nombre de scènes par type, les concepts, les liens
source, les passages cités ou non cités et la licence de chaque source. Une ligne
`WARN` demande une revue pour les licences `NC`, `ND` ou inconnues et pour une
ancienne scène `simulation`, que le runtime 1.4 ne sait pas jouer. Une citation
qui n'est pas une sous-chaîne exacte de son passage produit `ERROR` et un code de
sortie 1. Pour un script qui dépend de l'ancienne sortie sur une seule ligne,
ajouter `--quiet` à `check`.

Dans le plan 1.0, chaque concept peut déclarer les identifiants des concepts dont
il dépend avec `prerequisites: ["concept-de-base"]`. Chaque scène indique les
concepts qu'elle fait travailler avec `concept_refs: ["concept-cible"]`. Les deux
champs sont facultatifs et valent `[]` lorsqu'ils sont absents. `check` refuse un
identifiant qui n'existe pas dans `concepts` et émet un `WARN` pour chaque scène
qui ne rejoint aucun concept, directement ou par les `concept_uris`/URI SKOS de
ses objectifs : une telle scène ne peut déplacer aucune maîtrise.

`check` indique aussi la langue du plan et le nombre de citations vérifiées. Pour
signaler à faible coût un cours français fondé sur une source anglaise, il classe
une citation comme `en` si elle ne contient aucun caractère accentué et contient
un mot-outil anglais courant ; sinon il affiche `same as plan`. C'est une
heuristique de revue, pas une détection linguistique. Les notes contenant
`TODO review` et les scènes avec `evidence_override: "skip"` sont regroupées sous
`Not verifiable by quote:` afin que l'enseignant contrôle les faits non couverts
par une citation exacte.

Après la revue du dossier vérifié, créer un squelette exécutable sans prétendre
qu'il est approuvé :

```sh
.venv/bin/python tools/experience_packet.py bundle --course /ABS/PATH/courses/mon-cours --out /ABS/PATH/bundles/mon-cours/lesson.json
```

Le fichier est un `LessonBundle` 1.4 avec une scène par scène du plan et, par
défaut, `validated_by: "DRAFT — not validated"`. Il recopie `concept_refs`, crée
un nœud de graphe par concept et une arête par prérequis dans la convention du
moteur : le concept dépendant est `source`, son prérequis est `target`. Il ajoute
la règle `rule_2err_replay_concept`; `--no-default-rules` permet de l'omettre.
Les champs de contenu à rédiger portent `TODO:` ; le quiz contient deux choix
factices, un seul marqué correct, et aucun indice. Si le plan fournit `notes` pour
un quiz, leur texte devient sa `question`. Les scènes `explain_back`, `comparison`,
`summary_audit`, `prompt_practice` et `communication_sim` reprennent les objectifs
du plan comme points à travailler. Une ancienne `simulation` devient un concept
`TODO:` afin que le squelette reste jouable : l'enseignant doit choisir une scène
1.4 et fournir le support interactif avant diffusion. Un graphe explicitement
fourni par le plan est préservé puis complété avec les nœuds ou arêtes de prérequis
manquants.

Valider la forme puis faire un essai local :

```sh
apps/lesson-mcp/node_modules/.bin/tsx tools/bundle_validate.ts /ABS/PATH/bundles/mon-cours/lesson.json
```

`--validated-by "Nom"` renseigne seulement la trace demandée ; l'option ne réalise
ni revue scientifique ni approbation. Les capsules de reproduction peuvent avoir
leurs propres dépendances et doivent être testées dans l'environnement déclaré par
leur manifeste, qui n'est pas nécessairement le `.venv` de Studium.
Sans option supplémentaire, `check` et `bundle` refusent toujours une destination
existante et nomment `--force` dans leur message. Ajouter `--force` remplace
respectivement tout le dossier vérifié ou le fichier bundle ; garder une copie si
l'ancienne sortie doit rester comparable.

## Interface auteur et API : état actuel

L'interface auteur existe, mais ne constitue pas encore un assistant de publication
continu pour le nouveau parcours littérature. Pour l'inspecter :

```sh
pnpm --filter @studium/author-web dev
```

Ouvrir `http://localhost:3000`. La page d'entrée attend un PDF ; elle appelle
l'ingestion puis le planner. Le client utilise les paramètres suivants :

| Service | Valeur par défaut | Variable lue par le navigateur |
|---|---|---|
| Ingestion | `http://localhost:8000` | `NEXT_PUBLIC_INGEST_SERVICE_URL` |
| Planner | `http://localhost:8001` | `NEXT_PUBLIC_PLANNER_SERVICE_URL` |
| Synthèse | `http://localhost:8002` | `NEXT_PUBLIC_SCENE_SYNTH_SERVICE_URL` |

Les services doivent être configurés séparément. Pour inspecter les API locales
avec le venv installé, utiliser deux terminaux depuis la racine :

```sh
.venv/bin/python -m uvicorn ingest_app:app --app-dir services/ingest --host 127.0.0.1 --port 8000
```

```sh
.venv/bin/python -m uvicorn planner_app:app --app-dir services/planner --host 127.0.0.1 --port 8001
```

Une API joignable au terminal ne suffit pas pour le navigateur : le planner ne
configure pas CORS pour le POST JSON direct depuis `localhost:3000`. Sans proxy
ou middleware approprié, le flux navigateur est bloqué. Le parcours packet/MySTRA
reste l'entrée reproductible recommandée. Ces commandes inspectent les services ;
elles ne constituent pas une installation complète de l'interface auteur.

Le corps minimal de `POST /plan` est :

```json
{"manifest_id":"demo-local","target":"L1"}
```

La réponse est un `PlanResponse` contenant le plan, marqué `critic_reviewed`.
Ce statut ne vaut pas validation humaine. Dans `/plan/{id}`, l'interface permet
l'édition du titre du plan et des titres de scènes. **Valider et exporter**
marque le plan `approved`, renseigne `validated_by` et télécharge le JSON ;
ce bouton ne persiste pas une approbation serveur et ne déclenche pas la synthèse.
L'édition du blueprint d'évaluation n'est pas exposée dans cette page.

Le contrat de `POST /scenes/synthesize` attend un objet contenant `lesson_plan`,
pas le plan brut. Mais démarrer simplement `scene_synth_app:app` laisse son
orchestrateur non configuré et cette route répond 503. Une intégration de service
est nécessaire avant de présenter cette étape comme utilisable par un enseignant.
Le schéma de requête ne constitue pas non plus une barrière d'approbation.
Voir [le service](../../services/scene-synth/scene_synth_app.py) et
[les schémas](../../services/scene-synth/scene_synth_schemas.py).

Le brouillon produit par `experience_packet.py` peut être importé avec
`experience_approval.py import` dans le [workflow local](reviewed-synthesis.md).
Celui-ci préserve l'exacte révision approuvée jusqu'à l'appel de synthèse, sans
relancer le planner. Ce parcours CLI est distinct du bouton historique du navigateur.

## Organiser une expérience et sa restitution

Autoriser un périmètre concret : données, commandes, dépendances, accès web,
contrôles interactifs et durée. Une variation d'affichage des matériaux existants
peut rester dans l'activité ; de nouvelles affirmations ou scènes générées doivent
être relues avant diffusion. Le prototype n'automatise pas toute cette distinction.

Le [tutoriel agentique](../tutorials/agentic-experiment.md) propose un déroulement
et un reçu local. Demander à l'étudiant sa prédiction, les différences observées,
une limite et un test de transfert. Une sortie de l'agent n'est pas une preuve
que l'étudiant a compris. Garder les observations nominatives hors du dépôt public.
La [fiche confidentialité](../privacy-and-limits.md) précise les frontières.

Le [journal privé](experiment-journal.md) conserve les contributions avec le
consentement de l'étudiant. Le [viewer à représentations liées](linked-viewer.md)
fournit un exemple MS/MS vérifiable pour ce déroulement.

## Réutiliser une activité et relire sa trace

Le [catalogue de templates](activity-templates.md) fournit au harnais une base
pour adapter les représentations, une comparaison contrôlée ou l’examen d’une
preuve. Le contenu adapté reste dans le périmètre scientifique que vous avez
revu ; une nouvelle affirmation ou un nouvel objectif demande une nouvelle revue.

Un étudiant peut choisir de produire un [rapport ASTRA/MySTRA](learner-report.md).
Relisez les actions et les preuves disponibles, en tenant compte des événements
non enregistrés. La version par défaut exclut les textes personnels ; elle ne donne
pas accès au journal privé complet ni à l’historique du harnais.
