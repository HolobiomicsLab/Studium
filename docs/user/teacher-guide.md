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
