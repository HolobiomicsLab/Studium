# De l’activité interactive au rapport ASTRA/MySTRA

Ce parcours utilise votre harnais pour préparer l’activité, le navigateur pour
l’expérimentation et Studium pour structurer le rapport. Le viewer ne contient
pas un agent. Les cinq templates fournis ont des exemples synthétiques ; un
exemple technique ne constitue pas une expérience pédagogique validée.

## Préparer l’activité

Dans une session Studium déjà démarrée, demander au harnais :

> Utilise le skill studium-activity-templates. Récupère le contexte public de ma
> scène courante, choisis un template adapté à sa question et prépare-le dans un
> nouveau dossier. Présente ses sources et ses limites. Attends ma prédiction.

Le harnais utilise `get_operator_context` et enregistre la réponse JSON dans
`context.json`. Il peut ensuite exécuter, depuis le dépôt et son environnement
Python :

```bash
.venv/bin/python tools/experience_templates.py list
.venv/bin/python tools/experience_templates.py prepare \
  --template parameter-comparison --context context.json --out activity
```

`activity/task.md` guide l’adaptation. `activity/index.html` est le viewer à ouvrir.
Les modèles `linked-representations`, `evidence-claim`, `diagnose-analysis` et
`conclusion-robustness` utilisent la même commande.
Les exemples par défaut ne sont pas dérivés des sources de votre scène : un même
identifiant ne prouve pas un lien scientifique. Si les entrées nécessaires manquent,
le harnais doit le signaler et présenter le sample comme une illustration séparée.
Pour démarrer en français, ajouter `--language fr`. Les cinq templates acceptent
aussi `--translations` et `--supports` : voir [langues et supports scientifiques](../guides/language-and-scientific-presentation.md).
Le sélecteur conserve les réponses saisies ; le contenu sans traduction reste
dans sa langue source avec une indication explicite. Il n'appelle pas une API
de traduction.

Pour adapter les entrées, lire le [contrat de configuration](../user/activity-templates.md)
et utiliser `--config` avec un fichier explicite. La préparation ne relie pas
magiquement de nouvelles données à une publication : conserver les sources, les
valeurs de référence et les contrôles réellement effectués. Un objectif ou une
conclusion scientifique nouvelle reste à relire par l’enseignant.

## Expérimenter et choisir ce qui sera conservé

Choisir dans le viewer si une trace locale doit être préparée pour un export
éventuel. Écrire sa prédiction avant d’afficher les résultats, faire varier le
contrôle ou choisir une représentation, puis écrire son observation et sa
conclusion. Les champs facultatifs peuvent rester vides, notamment la confiance. Le parcours
sans trace permet aussi de terminer l’activité, sans téléchargement.

Télécharger la trace seulement si souhaité. Un export partiel reste possible ;
il n’affirme pas que l’activité est terminée. Pour la suite, enregistrer le fichier
choisi sous `actions.json`. Le téléchargement contient les contributions soumises
au viewer ; le rapport applique ensuite son propre choix d’inclusion des textes.

Si le harnais utilise aussi le journal privé, la prédiction doit y être enregistrée
avant de révéler les résultats. Un téléchargement ultérieur ne doit pas être
réintroduit comme une prédiction que le moteur aurait enregistrée plus tôt.

## Produire une copie à relire

Demander au harnais :

> Utilise studium-learner-report pour préparer un rapport local à partir de ce
> fichier actions.json et de la définition de mon activité. Exclue mes textes
> personnels et montre-moi le résultat avant tout partage.

```bash
.venv/bin/python tools/learner_trace.py validate actions.json
.venv/bin/python tools/learner_report.py export report \
  --actions actions.json --activity activity/activity.json
.venv/bin/python tools/learner_report.py verify report
```

Ouvrir `report/index.html`. Le rapport contient également ASTRA, la trace ARA,
la source MySTRA et les fichiers structurés vérifiables. Les actions gardent leurs
origines déclarées et leurs séquences. La définition de l’activité rend les
identifiants de choix et les paramètres interprétables.

Pour inclure volontairement les mots originaux, générer une nouvelle copie avec
`--include-original-text`. Ce choix concerne le rapport courant : il ne découle
pas du seul consentement au stockage du journal. Aucune commande ci-dessus
n’envoie le rapport à un enseignant ou à un service externe.

Un journal peut aussi être sélectionné avec `--journal`. Les chronologies du
navigateur et du moteur restent séparées. Des identifiants de scène compatibles
ne prouvent pas que deux fichiers viennent de la même personne.

## Ce que l’enseignant peut examiner

Relire la question, les actions enregistrées, les paramètres, les preuves et les
éventuels textes que l’étudiant a choisi d’inclure. Une absence de trace d’aide
signifie « inconnu ». Les contrôles ASTRA et les empreintes des fichiers vérifient
la structure et la cohérence technique, pas un apprentissage ni l’authenticité de
l’auteur. Le [guide du rapport](../user/learner-report.md) précise les limites et
l’ouverture dans le viewer MySTRA partagé.

## Deux autres parcours à demander au harnais

Pour diagnostiquer une analyse :

> Utilise `diagnose-analysis` pour les étapes et résultats publics de cette scène.
> Prépare plusieurs réparations plausibles, avec leurs résultats explicitement
> fournis et la manière de les vérifier. Laisse-moi choisir l’étape suspecte et
> expliquer mon diagnostic avant de discuter la réparation. Si un résultat
> manque, indique-le ; ne présente pas une valeur inventée comme un calcul exécuté.

Pour éprouver une conclusion :

> Utilise `conclusion-robustness`. Compare une hypothèse de référence avec des
> alternatives défendables, leurs résultats et un critère explicite avec unités.
> Laisse-moi prédire les conséquences puis examiner où la conclusion change.
> Précise ce qui reste inconnu hors de ces scénarios.

L’enseignant peut adapter ces formats à une autre discipline en remplaçant les
sources, étapes, hypothèses, unités et valeurs dans la configuration. Le code du
viewer reste commun. Une nouvelle exécution scientifique relève du harnais ;
le viewer affiche ensuite les résultats capturés et trace les choix locaux.
