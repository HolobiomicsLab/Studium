[English](activity-to-report.md) · Français

# De l'activité interactive au rapport ASTRA/MySTRA

Préparez une activité interactive avec votre harnais, expérimentez dans le navigateur, puis laissez
Studium transformer ce que vous avez choisi de garder en un rapport local, à vérifier avant tout
partage. Le visualiseur ne contient pas d'agent. Les cinq gabarits sont livrés avec des exemples
synthétiques ; un exemple technique ne constitue pas une expérience pédagogique validée.

## Préparer l'activité

Dans une séance Studium déjà démarrée, demandez au harnais :

> Utilise le skill studium-activity-templates. Récupère le contexte public de ma scène courante,
> choisis un gabarit adapté à sa question et prépare-le dans un nouveau dossier. Présente ses sources
> et ses limites. Attends ma prédiction.

Le harnais appelle `get_operator_context` et enregistre la réponse JSON dans `context.json`. Il peut
ensuite exécuter, depuis le dépôt et son environnement Python :

```bash
.venv/bin/python tools/experience_templates.py list
.venv/bin/python tools/experience_templates.py prepare \
  --template parameter-comparison --context context.json --out activity
```

`activity/task.md` guide l'adaptation et `activity/index.html` est le visualiseur à ouvrir. Les
gabarits `linked-representations`, `evidence-claim`, `diagnose-analysis` et `conclusion-robustness`
utilisent la même commande. Les exemples par défaut ne sont pas tirés des sources de votre scène :
un identifiant commun ne prouve pas un lien scientifique. Si les entrées nécessaires manquent, le
harnais doit le dire et présenter l'exemple comme une illustration séparée.

| Option | Effet |
|---|---|
| `--language fr` | Ouvrir le visualiseur en français (`en` par défaut) |
| `--translations FICHIER` | Dictionnaires de traduction locaux ; un contenu non traduit reste dans sa langue source, signalé |
| `--supports FICHIER` | Un manifeste local de supports ; voir [Langues et supports](../learn/language-and-supports.fr.md) |
| `--config FICHIER` | Vos propres entrées, selon le [contrat des gabarits](../teach/activity-templates.fr.md) |

Aucune API de traduction n'est appelée. La préparation ne relie pas de nouvelles données à une
publication : conservez les sources, les valeurs de référence et les contrôles réellement effectués.
Un objectif ou une conclusion scientifique nouvelle relève de la relecture de l'enseignant.

## Expérimenter et choisir ce qui sera conservé

Dans le visualiseur, choisissez si une trace locale doit être préparée pour un export éventuel.
Écrivez votre prédiction avant d'afficher les résultats, faites varier le contrôle ou choisissez une
représentation, puis écrivez votre observation et votre conclusion. Les champs facultatifs, dont la
confiance, peuvent rester vides. Le parcours sans trace permet aussi de terminer l'activité, sans
téléchargement.

Ne téléchargez la trace que si vous le souhaitez. Un export partiel est possible et n'affirme pas que
l'activité est terminée. Enregistrez le fichier choisi sous `actions.json`. Le téléchargement
contient ce que vous avez soumis dans le visualiseur ; le rapport applique ensuite son propre choix
d'inclusion des textes.

Si le harnais utilise aussi le [journal d'expérience](../learn/experiment-journal.fr.md) privé, la
prédiction doit y être enregistrée avant de révéler les résultats. Un téléchargement ultérieur ne
doit pas être réintroduit comme une prédiction que le moteur aurait enregistrée plus tôt.

## Produire une copie à relire

Demandez au harnais :

> Utilise studium-learner-report pour préparer un rapport local à partir de ce fichier actions.json
> et de la définition de mon activité. Exclus mes textes personnels et montre-moi le résultat avant
> tout partage.

```bash
.venv/bin/python tools/learner_trace.py validate actions.json
.venv/bin/python tools/learner_report.py export report \
  --actions actions.json --activity activity/activity.json
.venv/bin/python tools/learner_report.py verify report
```

Ouvrez `report/index.html`. Le rapport contient aussi ASTRA, la trace ARA, la source MySTRA et les
fichiers structurés vérifiables. Les actions gardent leurs origines déclarées et leur ordre ; la
définition de l'activité rend lisibles les identifiants de choix et les paramètres.

Pour inclure volontairement vos mots, générez une nouvelle copie avec `--include-original-text`. Ce
choix ne vaut que pour ce rapport ; il ne découle pas du consentement au stockage du journal. Un
journal peut aussi être sélectionné avec `--journal` ; les chronologies du navigateur et du moteur
restent séparées, et des identifiants de scène concordants ne prouvent pas que deux fichiers
viennent de la même personne. Aucune des commandes ci-dessus n'envoie le rapport à un enseignant ou
à un service externe.

## Ce que l'enseignant peut examiner

La question, les actions enregistrées, les paramètres, les preuves et les éventuels textes que
l'étudiant a choisi d'inclure. Une absence de trace d'aide signifie « inconnu ». Les contrôles ASTRA
et les empreintes des fichiers vérifient la structure et la cohérence technique, ni l'apprentissage
ni l'auteur. Le [guide du rapport](../learn/learner-report.fr.md) précise les limites et l'ouverture
dans le visualiseur MySTRA partagé.

## Deux autres activités à demander

Pour diagnostiquer une analyse :

> Utilise `diagnose-analysis` pour les étapes et résultats publics de cette scène. Prépare plusieurs
> réparations plausibles, avec leurs résultats explicitement fournis et la manière de les vérifier.
> Laisse-moi choisir l'étape suspecte et expliquer mon diagnostic avant de discuter la réparation. Si
> un résultat manque, dis-le ; ne présente jamais une valeur inventée comme un calcul exécuté.

Pour éprouver une conclusion :

> Utilise `conclusion-robustness`. Compare une hypothèse de référence avec des alternatives
> défendables, leurs résultats et un critère explicite avec unités. Laisse-moi prédire les
> conséquences, puis examiner où la conclusion change. Précise ce qui reste inconnu hors de ces
> scénarios.

Un enseignant peut adapter ces formats à une autre discipline en remplaçant sources, étapes,
hypothèses, unités et valeurs dans la configuration ; le code du visualiseur reste commun. Une
nouvelle exécution scientifique relève du harnais ; le visualiseur affiche ensuite les résultats
capturés et trace les choix locaux.
